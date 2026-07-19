import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { DeviceKind, PrintJobStatus, PrintJobType, Prisma } from "@pos/db";
import { hashToken } from "../auth/hashing";
import { PrismaService } from "../prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { BridgeSession } from "./bridge.guard";

const DEFAULT_STATION = "kitchen";

@Injectable()
export class PrintingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly realtime: RealtimeGateway,
  ) {}

  // ---------- bridge session ----------

  /** Headless bridges exchange their device token for a session JWT. */
  async bridgeSession(deviceToken: string) {
    const device = await this.prisma.device.findUnique({
      where: { tokenHash: hashToken(deviceToken) },
    });
    if (!device || !device.active || device.kind !== DeviceKind.PRINT_BRIDGE) {
      throw new UnauthorizedException("Unknown or revoked print-bridge device");
    }
    await this.prisma.device.update({
      where: { id: device.id },
      data: { lastSeenAt: new Date() },
    });
    const payload: BridgeSession = {
      kind: "bridge",
      companyId: device.companyId,
      outletId: device.outletId,
      deviceId: device.id,
    };
    return {
      token: await this.jwt.signAsync({ ...payload }, { expiresIn: "24h" }),
      outletId: device.outletId,
    };
  }

  pendingJobs(bridge: BridgeSession) {
    return this.prisma.printJob.findMany({
      where: { outletId: bridge.outletId, status: PrintJobStatus.PENDING },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
  }

  async ackJob(bridge: BridgeSession, jobId: string, ok: boolean, error?: string) {
    const job = await this.prisma.printJob.findFirst({
      where: { id: jobId, outletId: bridge.outletId },
    });
    if (!job) throw new NotFoundException("Print job not found");
    return this.prisma.printJob.update({
      where: { id: jobId },
      data: {
        status: ok ? PrintJobStatus.PRINTED : PrintJobStatus.FAILED,
        error: ok ? null : (error ?? "unknown error"),
        printedAt: ok ? new Date() : null,
      },
    });
  }

  // ---------- job creation ----------

  /** Customer receipt for a (usually paid) order. */
  async receiptJob(orderId: string, companyId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, companyId },
      include: {
        items: { orderBy: { createdAt: "asc" } },
        payments: { orderBy: { paidAt: "asc" } },
        table: true,
        outlet: { include: { company: true } },
      },
    });
    if (!order) throw new NotFoundException("Order not found");

    const payload = {
      kind: "receipt",
      outletName: order.outlet.name,
      address: order.outlet.address,
      currency: order.outlet.company.currency,
      orderNo: order.orderNo,
      orderType: order.type,
      tableName: order.table?.name ?? null,
      at: order.closedAt ?? order.openedAt,
      items: order.items
        .filter((i) => i.status !== "VOIDED")
        .map((i) => ({
          quantity: i.quantity,
          name: i.nameSnapshot,
          modifiers: (i.modifiersJson as { name: string }[]).map((m) => m.name),
          amountCents:
            (i.unitPriceCents +
              (i.modifiersJson as { priceDeltaCents: number }[]).reduce(
                (s, m) => s + m.priceDeltaCents,
                0,
              )) *
            i.quantity,
        })),
      subtotalCents: order.subtotalCents,
      serviceChargeCents: order.serviceChargeCents,
      taxCents: order.taxCents,
      roundingCents: order.roundingCents,
      totalCents: order.totalCents + order.roundingCents,
      payments: order.payments
        .filter((p) => p.status === "CAPTURED")
        .map((p) => ({
          method: p.method,
          amountCents: p.amountCents,
          tenderedCents: p.tenderedCents,
          changeCents: p.changeCents,
        })),
    };

    return this.createJob({
      companyId,
      outletId: order.outletId,
      orderId: order.id,
      type: PrintJobType.RECEIPT,
      station: null,
      payload,
    });
  }

  /**
   * Kitchen tickets for an order's items, one job per station. Called after
   * order create / item add; itemIds limits to the newly added rows.
   */
  async kitchenJobs(
    order: {
      id: string;
      companyId: string;
      outletId: string;
      orderNo: number | null;
      type: string;
      source: string;
      tableId: string | null;
      notes: string | null;
      items: {
        id: string;
        nameSnapshot: string;
        quantity: number;
        modifiersJson: Prisma.JsonValue;
        notes: string | null;
        status: string;
        station: string | null;
      }[];
    },
    itemIds?: string[],
  ) {
    const items = order.items.filter(
      (i) => i.status !== "VOIDED" && (!itemIds || itemIds.includes(i.id)),
    );
    if (items.length === 0) return [];

    const table = order.tableId
      ? await this.prisma.diningTable.findUnique({ where: { id: order.tableId } })
      : null;

    const byStation = new Map<string, typeof items>();
    for (const item of items) {
      const station = item.station ?? DEFAULT_STATION;
      byStation.set(station, [...(byStation.get(station) ?? []), item]);
    }

    const jobs = [];
    for (const [station, stationItems] of byStation) {
      jobs.push(
        await this.createJob({
          companyId: order.companyId,
          outletId: order.outletId,
          orderId: order.id,
          type: PrintJobType.KITCHEN,
          station,
          payload: {
            kind: "kitchen",
            station,
            orderNo: order.orderNo,
            orderType: order.type,
            source: order.source,
            tableName: table?.name ?? null,
            orderNotes: order.notes,
            at: new Date(),
            items: stationItems.map((i) => ({
              quantity: i.quantity,
              name: i.nameSnapshot,
              modifiers: (i.modifiersJson as { name: string }[]).map((m) => m.name),
              notes: i.notes,
            })),
          },
        }),
      );
    }
    return jobs;
  }

  private async createJob(data: {
    companyId: string;
    outletId: string;
    orderId: string | null;
    type: PrintJobType;
    station: string | null;
    payload: unknown;
  }) {
    const job = await this.prisma.printJob.create({
      data: { ...data, payload: data.payload as Prisma.InputJsonValue },
    });
    this.realtime.emitToOutlet(job.outletId, "print.job", {
      id: job.id,
      type: job.type,
      station: job.station,
      payload: job.payload,
    });
    return job;
  }
}
