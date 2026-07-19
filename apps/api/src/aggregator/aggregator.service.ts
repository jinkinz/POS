import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DeviceKind, OrderStatus, PaymentStatus, Prisma } from "@pos/db";
import { hashToken } from "../auth/hashing";
import { InventoryService } from "../inventory/inventory.service";
import { PrintingService } from "../printing/printing.service";
import { PrismaService } from "../prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { AggregatorItemDto, AggregatorOrderDto } from "./dto";

const ORDER_INCLUDE = {
  items: { orderBy: { createdAt: "asc" as const } },
  payments: { orderBy: { paidAt: "asc" as const } },
};

@Injectable()
export class AggregatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly inventory: InventoryService,
    private readonly printing: PrintingService,
  ) {}

  /** Webhook auth: the integration's device token identifies the outlet. */
  private async authenticate(deviceToken: string | undefined) {
    if (!deviceToken) throw new UnauthorizedException("Missing X-Device-Token");
    const device = await this.prisma.device.findUnique({
      where: { tokenHash: hashToken(deviceToken) },
    });
    if (!device || !device.active || device.kind !== DeviceKind.AGGREGATOR) {
      throw new UnauthorizedException("Unknown or revoked aggregator integration");
    }
    await this.prisma.device.update({
      where: { id: device.id },
      data: { lastSeenAt: new Date() },
    });
    return device;
  }

  /**
   * Inject a platform order. Items are matched to products by name
   * (case-insensitive) for station routing and inventory deduction;
   * unmatched items still print/display using their given name. The
   * platform collects payment, so the order arrives settled.
   */
  async ingest(deviceToken: string | undefined, dto: AggregatorOrderDto) {
    const device = await this.authenticate(deviceToken);
    const provider = dto.provider.toUpperCase();

    const existing = await this.prisma.order.findUnique({
      where: {
        aggregatorProvider_externalRef: {
          aggregatorProvider: provider,
          externalRef: dto.externalRef,
        },
      },
      include: ORDER_INCLUDE,
    });
    if (existing) return existing;

    const order = await this.prisma.$transaction(async (tx) => {
      const outlet = await tx.outlet.findUniqueOrThrow({
        where: { id: device.outletId },
        include: { company: true },
      });

      const products = await tx.product.findMany({
        where: { companyId: device.companyId, active: true },
        select: { id: true, name: true, kitchenStation: true },
      });
      const byName = new Map(products.map((p) => [p.name.toLowerCase(), p]));

      const resolved = dto.items.map((item: AggregatorItemDto) => {
        const match = byName.get(item.name.trim().toLowerCase());
        return {
          id: randomUUID(),
          productId: match?.id ?? null,
          nameSnapshot: item.name.trim(),
          unitPriceCents: item.priceCents,
          quantity: item.quantity,
          modifiersJson: [] as Prisma.InputJsonValue,
          notes: item.notes ?? null,
          status: "PENDING" as const,
          courseNo: 1,
          station: match?.kitchenStation ?? null,
        };
      });

      const subtotal = resolved.reduce(
        (s, i) => s + i.unitPriceCents * i.quantity,
        0,
      );
      const total = dto.totalCents ?? subtotal;

      const bizDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: outlet.company.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      const counter = await tx.orderCounter.upsert({
        where: { outletId_bizDate: { outletId: outlet.id, bizDate } },
        create: { outletId: outlet.id, bizDate, counter: 1 },
        update: { counter: { increment: 1 } },
      });

      const orderId = randomUUID();
      await this.inventory.applyForItems(
        tx,
        outlet.id,
        resolved
          .filter((r) => r.productId)
          .map((r) => ({
            productId: r.productId!,
            quantity: r.quantity,
            modifierIds: [],
          })),
        orderId,
        -1,
      );

      return tx.order.create({
        data: {
          id: orderId,
          companyId: device.companyId,
          outletId: outlet.id,
          orderNo: counter.counter,
          type: dto.orderType,
          source: "AGGREGATOR",
          status: OrderStatus.COMPLETED, // platform-paid
          closedAt: new Date(),
          notes: `${provider}${dto.customerName ? ` · ${dto.customerName}` : ""} · ${dto.externalRef}`,
          aggregatorProvider: provider,
          externalRef: dto.externalRef,
          customerName: dto.customerName,
          subtotalCents: subtotal,
          totalCents: total,
          items: { create: resolved },
          payments: {
            create: {
              id: randomUUID(),
              method: "OTHER",
              amountCents: total,
              gatewayRef: `${provider}:${dto.externalRef}`,
              status: PaymentStatus.CAPTURED,
            },
          },
        },
        include: ORDER_INCLUDE,
      });
    });

    this.realtime.emitToOutlet(order.outletId, "order.created", order);
    void this.printing.kitchenJobs(order).catch(() => {});
    return order;
  }

  /** Platform cancelled the order: void it and restore matched stock. */
  async cancel(
    deviceToken: string | undefined,
    provider: string,
    externalRef: string,
    reason?: string,
  ) {
    const device = await this.authenticate(deviceToken);
    const order = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: {
          aggregatorProvider_externalRef: {
            aggregatorProvider: provider.toUpperCase(),
            externalRef,
          },
        },
        include: ORDER_INCLUDE,
      });
      if (!order || order.outletId !== device.outletId) {
        throw new NotFoundException("Order not found");
      }
      if (order.status === OrderStatus.VOIDED) return order;
      if (order.items.some((i) => i.status === "SERVED")) {
        throw new ConflictException("Order already served — settle with the platform");
      }
      await this.inventory.applyForItems(
        tx,
        order.outletId,
        order.items
          .filter((i) => i.productId && i.status !== "VOIDED")
          .map((i) => ({ productId: i.productId!, quantity: i.quantity, modifierIds: [] })),
        order.id,
        1,
      );
      await tx.orderItem.updateMany({
        where: { orderId: order.id },
        data: { status: "VOIDED", voidReason: reason ?? "platform cancelled" },
      });
      return tx.order.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.VOIDED,
          voidReason: reason ?? "platform cancelled",
          closedAt: new Date(),
        },
        include: ORDER_INCLUDE,
      });
    });
    this.realtime.emitToOutlet(order.outletId, "order.updated", order);
    return { ok: true, status: order.status };
  }
}
