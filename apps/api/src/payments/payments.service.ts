import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  GatewayPaymentStatus,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from "@pos/db";
import { PrismaService } from "../prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { HitPayAdapter } from "./hitpay.adapter";
import { MockGatewayAdapter } from "./mock.adapter";
import { PaymentGatewayAdapter } from "./gateway.interface";

@Injectable()
export class PaymentsService {
  private readonly adapters = new Map<string, PaymentGatewayAdapter>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {
    const isProd = process.env.NODE_ENV === "production";
    const mockEnabled = process.env.MOCK_GATEWAY_ENABLED
      ? process.env.MOCK_GATEWAY_ENABLED === "true"
      : !isProd;
    if (mockEnabled) this.register(new MockGatewayAdapter());

    if (process.env.HITPAY_API_KEY && process.env.HITPAY_SALT) {
      this.register(
        new HitPayAdapter(
          process.env.HITPAY_API_KEY,
          process.env.HITPAY_SALT,
          process.env.HITPAY_SANDBOX !== "false",
          `${process.env.PUBLIC_API_URL ?? "http://localhost:3000"}/api/webhooks/hitpay`,
        ),
      );
    }
  }

  private register(adapter: PaymentGatewayAdapter) {
    this.adapters.set(adapter.provider, adapter);
  }

  providers(): { provider: string }[] {
    return [...this.adapters.keys()].map((provider) => ({ provider }));
  }

  /** Start a gateway payment for the order's remaining balance. */
  async create(orderId: string, companyId: string, provider?: string) {
    const adapter = this.adapters.get(provider ?? this.defaultProvider());
    if (!adapter) throw new BadRequestException("Payment provider not available");

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, companyId },
      include: { payments: true, outlet: { include: { company: true } } },
    });
    if (!order) throw new NotFoundException("Order not found");
    if (order.status !== OrderStatus.OPEN) {
      throw new ConflictException(`Order is ${order.status}`);
    }
    const paid = order.payments
      .filter((p) => p.status === PaymentStatus.CAPTURED)
      .reduce((s, p) => s + p.amountCents, 0);
    const remaining = order.totalCents + order.roundingCents - paid;
    if (remaining <= 0) throw new ConflictException("Order is already fully paid");

    // Reuse an existing live intent instead of stacking QRs for one bill.
    const existing = await this.prisma.gatewayPayment.findFirst({
      where: {
        orderId,
        provider: adapter.provider,
        status: GatewayPaymentStatus.PENDING,
        amountCents: remaining,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    if (existing) return existing;

    const id = crypto.randomUUID();
    const created = await adapter.createPayment({
      amountCents: remaining,
      currency: order.outlet.company.currency,
      referenceId: id,
      description: `Order #${order.orderNo ?? ""} ${order.outlet.name}`.trim(),
    });

    return this.prisma.gatewayPayment.create({
      data: {
        id,
        companyId,
        outletId: order.outletId,
        orderId,
        provider: adapter.provider,
        providerRef: created.providerRef,
        amountCents: remaining,
        currency: order.outlet.company.currency,
        qrData: created.qrData,
        checkoutUrl: created.checkoutUrl,
        expiresAt: created.expiresAt,
      },
    });
  }

  async get(orderId: string, gatewayPaymentId: string, companyId: string) {
    const gp = await this.prisma.gatewayPayment.findFirst({
      where: { id: gatewayPaymentId, orderId, companyId },
    });
    if (!gp) throw new NotFoundException("Gateway payment not found");
    if (
      gp.status === GatewayPaymentStatus.PENDING &&
      gp.expiresAt &&
      gp.expiresAt < new Date()
    ) {
      return this.prisma.gatewayPayment.update({
        where: { id: gp.id },
        data: { status: GatewayPaymentStatus.EXPIRED },
      });
    }
    return gp;
  }

  async cancel(orderId: string, gatewayPaymentId: string, companyId: string) {
    const gp = await this.prisma.gatewayPayment.findFirst({
      where: { id: gatewayPaymentId, orderId, companyId },
    });
    if (!gp) throw new NotFoundException("Gateway payment not found");
    if (gp.status !== GatewayPaymentStatus.PENDING) {
      throw new ConflictException(`Payment is ${gp.status}`);
    }
    return this.prisma.gatewayPayment.update({
      where: { id: gp.id },
      data: { status: GatewayPaymentStatus.CANCELED },
    });
  }

  /** Gateway webhook: verify with the adapter, then settle idempotently. */
  async handleWebhook(
    provider: string,
    body: Record<string, unknown>,
    headers: Record<string, string | string[] | undefined>,
  ) {
    const adapter = this.adapters.get(provider.toUpperCase());
    if (!adapter) throw new NotFoundException("Unknown provider");
    const event = await adapter.verifyWebhook(body, headers);

    const result = await this.prisma.$transaction(async (tx) => {
      const gp = await tx.gatewayPayment.findUnique({
        where: {
          provider_providerRef: {
            provider: adapter.provider,
            providerRef: event.providerRef,
          },
        },
        include: { order: { include: { payments: true } } },
      });
      if (!gp) throw new NotFoundException("Unknown payment reference");
      // Replay of a webhook we already processed — fine, gateways retry.
      if (gp.status !== GatewayPaymentStatus.PENDING) return { gp, settled: false };

      if (event.status === "FAILED") {
        const updated = await tx.gatewayPayment.update({
          where: { id: gp.id },
          data: {
            status: GatewayPaymentStatus.FAILED,
            failReason: event.failReason,
          },
        });
        return { gp: updated, settled: false };
      }

      const payment = await tx.payment.create({
        data: {
          id: crypto.randomUUID(),
          orderId: gp.orderId,
          method: PaymentMethod.QR_WALLET,
          amountCents: gp.amountCents,
          gatewayRef: `${gp.provider}:${event.providerRef}`,
          status: PaymentStatus.CAPTURED,
        },
      });
      const updated = await tx.gatewayPayment.update({
        where: { id: gp.id },
        data: { status: GatewayPaymentStatus.SUCCEEDED, paymentId: payment.id },
      });

      const paid = gp.order.payments
        .filter((p) => p.status === PaymentStatus.CAPTURED)
        .reduce((s, p) => s + p.amountCents, 0);
      const settled =
        paid + gp.amountCents >= gp.order.totalCents + gp.order.roundingCents;
      if (settled) {
        await tx.order.update({
          where: { id: gp.orderId },
          data: { status: OrderStatus.COMPLETED, closedAt: new Date() },
        });
      }
      return { gp: updated, settled: true };
    });

    // Wake up the POS tender screen and everything else in the outlet room.
    const order = await this.prisma.order.findUnique({
      where: { id: result.gp.orderId },
      include: {
        items: { orderBy: { createdAt: "asc" } },
        payments: { orderBy: { paidAt: "asc" } },
      },
    });
    if (order) {
      this.realtime.emitToOutlet(order.outletId, "order.updated", order);
      this.realtime.emitToOutlet(order.outletId, "gateway_payment.updated", {
        id: result.gp.id,
        orderId: result.gp.orderId,
        status: result.gp.status,
      });
    }
    return { ok: true, status: result.gp.status };
  }

  private defaultProvider(): string {
    if (this.adapters.has("HITPAY")) return "HITPAY";
    return "MOCK";
  }
}
