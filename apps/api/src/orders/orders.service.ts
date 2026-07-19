import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  applyCashRounding,
  computeOrderTotals,
  type OrderLineInput,
  type TotalsConfig,
} from "@pos/shared";
import { OrderStatus, PaymentMethod, PaymentStatus, Prisma } from "@pos/db";
import { AuthUser } from "../auth/decorators";
import { InventoryService } from "../inventory/inventory.service";
import { PrintingService } from "../printing/printing.service";
import { PrismaService } from "../prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import {
  AddItemsDto,
  CreateOrderDto,
  ItemsStatusDto,
  OrderItemInputDto,
  PayDto,
} from "./dto";

type Tx = Prisma.TransactionClient;

/** Who/where an order is being created from — staff session or QR guest. */
export interface OrderContext {
  companyId: string;
  /** Set on device and guest sessions: locks creation to this outlet. */
  outletId?: string;
  staffId?: string;
}

interface ResolvedItem {
  id: string;
  productId: string;
  nameSnapshot: string;
  unitPriceCents: number;
  quantity: number;
  modifiersJson: {
    id: string;
    groupName: string;
    name: string;
    priceDeltaCents: number;
  }[];
  notes: string | null;
  courseNo: number;
  station: string | null;
}

/** Snapshot rows carry the modifier id so voids can reverse consumption. */
function toSoldItem(item: {
  productId: string | null;
  quantity: number;
  modifiersJson: unknown;
}): { productId: string; quantity: number; modifierIds: string[] } | null {
  if (!item.productId) return null;
  const mods = (item.modifiersJson as { id?: string }[]) ?? [];
  return {
    productId: item.productId,
    quantity: item.quantity,
    modifierIds: mods.map((m) => m.id).filter((id): id is string => !!id),
  };
}

const ORDER_INCLUDE = {
  items: { orderBy: { createdAt: "asc" as const } },
  payments: { orderBy: { paidAt: "asc" as const } },
};

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly inventory: InventoryService,
    private readonly printing: PrintingService,
  ) {}

  // ---------- queries ----------

  async getOrder(id: string, companyId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, companyId },
      include: ORDER_INCLUDE,
    });
    if (!order) throw new NotFoundException("Order not found");
    return order;
  }

  listOutletOrders(outletId: string, companyId: string, status?: OrderStatus) {
    return this.prisma.order.findMany({
      where: { outletId, companyId, ...(status ? { status } : {}) },
      orderBy: { openedAt: "desc" },
      take: 100,
      include: ORDER_INCLUDE,
    });
  }

  // ---------- commands ----------

  async createOrder(dto: CreateOrderDto, user: OrderContext) {
    if (dto.id) {
      // Offline sync replays are expected; creation is idempotent on id.
      const existing = await this.prisma.order.findFirst({
        where: { id: dto.id, companyId: user.companyId },
        include: ORDER_INCLUDE,
      });
      if (existing) return existing;
    }

    // Device (PIN) sessions are locked to the outlet the device is registered at.
    if (user.outletId && dto.outletId !== user.outletId) {
      throw new BadRequestException("Device can only create orders for its own outlet");
    }

    const order = await this.prisma.$transaction(async (tx) => {
      const outlet = await tx.outlet.findFirst({
        where: { id: dto.outletId, companyId: user.companyId },
        include: { company: true },
      });
      if (!outlet) throw new NotFoundException("Outlet not found");

      if (dto.tableId) {
        const table = await tx.diningTable.findFirst({
          where: { id: dto.tableId, outletId: outlet.id },
        });
        if (!table) throw new BadRequestException("Table does not belong to outlet");
      }

      const resolved = await this.resolveItems(tx, outlet.companyId, dto.items);
      const totals = computeOrderTotals(
        resolved.map(toLine),
        totalsConfig(outlet),
      );

      const counter = await tx.orderCounter.upsert({
        where: {
          outletId_bizDate: {
            outletId: outlet.id,
            bizDate: bizDate(outlet.company.timezone),
          },
        },
        create: {
          outletId: outlet.id,
          bizDate: bizDate(outlet.company.timezone),
          counter: 1,
        },
        update: { counter: { increment: 1 } },
      });

      const orderId = dto.id ?? randomUUID();
      await this.inventory.applyForItems(
        tx,
        outlet.id,
        resolved.map((r) => ({
          productId: r.productId,
          quantity: r.quantity,
          modifierIds: r.modifiersJson.map((m) => m.id),
        })),
        orderId,
        -1,
      );

      return tx.order.create({
        data: {
          id: orderId,
          companyId: outlet.companyId,
          outletId: outlet.id,
          tableId: dto.tableId,
          staffId: dto.staffId ?? user.staffId,
          orderNo: counter.counter,
          type: dto.type,
          source: dto.source,
          guestCount: dto.guestCount ?? 1,
          notes: dto.notes,
          subtotalCents: totals.subtotalCents,
          serviceChargeCents: totals.serviceChargeCents,
          taxCents: totals.taxCents,
          totalCents: totals.totalCents,
          items: { create: resolved },
        },
        include: ORDER_INCLUDE,
      });
    });
    this.realtime.emitToOutlet(order.outletId, "order.created", order);
    // Kitchen tickets are printer fallback/companion to the KDS.
    void this.printing.kitchenJobs(order).catch(() => {});
    return order;
  }

  async addItems(orderId: string, dto: AddItemsDto, companyId: string) {
    let freshIds: string[] = [];
    const order = await this.prisma.$transaction(async (tx) => {
      const order = await this.getOpenOrder(tx, orderId, companyId);
      if (order.payments.some((p) => p.status === PaymentStatus.CAPTURED)) {
        throw new ConflictException("Cannot add items after payment has started");
      }
      const resolved = await this.resolveItems(tx, order.companyId, dto.items);
      // Idempotent on item id: skip rows already applied by a previous sync push.
      const existingIds = new Set(order.items.map((i) => i.id));
      const fresh = resolved.filter((r) => !existingIds.has(r.id));
      freshIds = fresh.map((r) => r.id);
      if (fresh.length > 0) {
        await tx.orderItem.createMany({
          data: fresh.map((r) => ({
            ...r,
            modifiersJson: r.modifiersJson as unknown as Prisma.InputJsonValue,
            orderId,
          })),
        });
        await this.inventory.applyForItems(
          tx,
          order.outletId,
          fresh.map((r) => ({
            productId: r.productId,
            quantity: r.quantity,
            modifierIds: r.modifiersJson.map((m) => m.id),
          })),
          orderId,
          -1,
        );
      }
      return this.recomputeTotals(tx, orderId);
    });
    this.realtime.emitToOutlet(order.outletId, "order.updated", order);
    if (freshIds.length > 0) {
      void this.printing.kitchenJobs(order, freshIds).catch(() => {});
    }
    return order;
  }

  async voidItem(orderId: string, itemId: string, reason: string, companyId: string) {
    const order = await this.prisma.$transaction(async (tx) => {
      const order = await this.getOpenOrder(tx, orderId, companyId);
      if (order.payments.some((p) => p.status === PaymentStatus.CAPTURED)) {
        throw new ConflictException("Cannot void items after payment has started");
      }
      const item = order.items.find((i) => i.id === itemId);
      if (!item) throw new NotFoundException("Order item not found");
      if (item.status === "VOIDED") return this.recomputeTotals(tx, orderId);
      await tx.orderItem.update({
        where: { id: itemId },
        data: { status: "VOIDED", voidReason: reason },
      });
      const sold = toSoldItem(item);
      if (sold) {
        await this.inventory.applyForItems(tx, order.outletId, [sold], orderId, 1);
      }
      return this.recomputeTotals(tx, orderId);
    });
    this.realtime.emitToOutlet(order.outletId, "order.updated", order);
    return order;
  }

  async voidOrder(orderId: string, reason: string, companyId: string) {
    const order = await this.prisma.$transaction(async (tx) => {
      const open = await this.getOpenOrder(tx, orderId, companyId);
      if (open.payments.some((p) => p.status === PaymentStatus.CAPTURED)) {
        throw new ConflictException(
          "Order has captured payments — refund first, then void",
        );
      }
      const sold = open.items
        .filter((i) => i.status !== "VOIDED")
        .map(toSoldItem)
        .filter((s): s is NonNullable<typeof s> => s !== null);
      await this.inventory.applyForItems(tx, open.outletId, sold, orderId, 1);
      return tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.VOIDED, voidReason: reason, closedAt: new Date() },
        include: ORDER_INCLUDE,
      });
    });
    this.realtime.emitToOutlet(order.outletId, "order.updated", order);
    return order;
  }

  /**
   * Bulk item status change — the KDS "bump" (station done -> READY),
   * expo "serve" (READY -> SERVED) and "recall" (back to PREPARING).
   * Works on completed (paid) orders too: pay-first flows still cook after.
   */
  async setItemsStatus(orderId: string, dto: ItemsStatusDto, companyId: string) {
    const order = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.order.findFirst({
        where: { id: orderId, companyId },
        include: ORDER_INCLUDE,
      });
      if (!existing) throw new NotFoundException("Order not found");
      if (existing.status === OrderStatus.VOIDED) {
        throw new ConflictException("Order is VOIDED");
      }
      const byId = new Map(existing.items.map((i) => [i.id, i]));
      for (const itemId of dto.itemIds) {
        const item = byId.get(itemId);
        if (!item) throw new NotFoundException(`Item ${itemId} not on this order`);
        if (item.status === "VOIDED") {
          throw new ConflictException("Cannot change status of a voided item");
        }
      }
      await tx.orderItem.updateMany({
        where: { id: { in: dto.itemIds } },
        data: { status: dto.status },
      });
      return tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: ORDER_INCLUDE,
      });
    });
    this.realtime.emitToOutlet(order.outletId, "order.updated", order);
    return order;
  }

  /**
   * Records one tender. Split tender is supported: pay less than the balance
   * and the order stays OPEN. MY 5-sen rounding applies only when a cash
   * tender settles the remaining balance (BNM guideline: round the final
   * cash amount, not each payment).
   */
  async pay(orderId: string, dto: PayDto, companyId: string) {
    if (dto.id) {
      const existing = await this.prisma.payment.findFirst({
        where: { id: dto.id, order: { companyId } },
      });
      if (existing) return this.paymentResult(orderId, existing.id, companyId);
    }

    const paymentId = await this.prisma.$transaction(async (tx) => {
      const order = await this.getOpenOrder(tx, orderId, companyId);
      const outlet = await tx.outlet.findUniqueOrThrow({ where: { id: order.outletId } });

      const paid = order.payments
        .filter((p) => p.status === PaymentStatus.CAPTURED)
        .reduce((s, p) => s + p.amountCents, 0);
      const remaining = order.totalCents + order.roundingCents - paid;
      if (remaining <= 0) throw new ConflictException("Order is already fully paid");

      let amountCents: number;
      let tenderedCents: number | null = null;
      let changeCents: number | null = null;
      let roundingAdjustment = 0;

      if (dto.method === PaymentMethod.CASH) {
        const rounded = applyCashRounding(remaining, outlet.cashRounding);
        tenderedCents = dto.tenderedCents ?? rounded.roundedTotalCents;
        if (tenderedCents >= rounded.roundedTotalCents) {
          // Settles the bill: rounding kicks in, change returned.
          amountCents = rounded.roundedTotalCents;
          changeCents = tenderedCents - rounded.roundedTotalCents;
          roundingAdjustment = rounded.roundingAdjustmentCents;
        } else {
          // Partial cash payment: no rounding yet.
          amountCents = tenderedCents;
          changeCents = 0;
        }
      } else {
        amountCents = Math.min(dto.amountCents ?? remaining, remaining);
      }

      const payment = await tx.payment.create({
        data: {
          id: dto.id ?? randomUUID(),
          orderId,
          method: dto.method,
          amountCents,
          tenderedCents,
          changeCents,
          gatewayRef: dto.gatewayRef,
          status: PaymentStatus.CAPTURED,
        },
      });

      const newRounding = order.roundingCents + roundingAdjustment;
      const settled = paid + amountCents >= order.totalCents + newRounding;
      await tx.order.update({
        where: { id: orderId },
        data: {
          roundingCents: newRounding,
          ...(settled
            ? { status: OrderStatus.COMPLETED, closedAt: new Date() }
            : {}),
        },
      });

      return payment.id;
    });

    const result = await this.paymentResult(orderId, paymentId, companyId);
    this.realtime.emitToOutlet(result.order.outletId, "order.updated", result.order);
    return result;
  }

  // ---------- internals ----------

  private async paymentResult(orderId: string, paymentId: string, companyId: string) {
    const order = await this.getOrder(orderId, companyId);
    const payment = order.payments.find((p) => p.id === paymentId);
    return { order, payment };
  }

  private async getOpenOrder(tx: Tx, orderId: string, companyId: string) {
    const order = await tx.order.findFirst({
      where: { id: orderId, companyId },
      include: ORDER_INCLUDE,
    });
    if (!order) throw new NotFoundException("Order not found");
    if (order.status !== OrderStatus.OPEN) {
      throw new ConflictException(`Order is ${order.status}`);
    }
    return order;
  }

  private async resolveItems(
    tx: Tx,
    companyId: string,
    inputs: OrderItemInputDto[],
  ): Promise<ResolvedItem[]> {
    if (inputs.length === 0) return [];
    const products = await tx.product.findMany({
      where: { id: { in: inputs.map((i) => i.productId) }, companyId },
      include: {
        modifierGroups: { include: { group: { include: { modifiers: true } } } },
      },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    return inputs.map((input) => {
      const product = byId.get(input.productId);
      if (!product) throw new BadRequestException(`Unknown product ${input.productId}`);
      if (!product.active || product.soldOut) {
        throw new ConflictException(`"${product.name}" is not available`);
      }

      const allowed = new Map(
        product.modifierGroups.flatMap((pg) =>
          pg.group.modifiers.map((m) => [m.id, { groupName: pg.group.name, m }] as const),
        ),
      );
      const modifiers = (input.modifierIds ?? []).map((id) => {
        const hit = allowed.get(id);
        if (!hit) {
          throw new BadRequestException(
            `Modifier ${id} is not valid for "${product.name}"`,
          );
        }
        if (hit.m.soldOut) {
          throw new ConflictException(`Modifier "${hit.m.name}" is not available`);
        }
        return {
          id: hit.m.id,
          groupName: hit.groupName,
          name: hit.m.name,
          priceDeltaCents: hit.m.priceDeltaCents,
        };
      });

      return {
        id: input.id ?? randomUUID(),
        productId: product.id,
        nameSnapshot: product.name,
        unitPriceCents: product.basePriceCents,
        quantity: input.quantity,
        modifiersJson: modifiers,
        notes: input.notes ?? null,
        courseNo: input.courseNo ?? 1,
        station: product.kitchenStation,
      };
    });
  }

  private async recomputeTotals(tx: Tx, orderId: string) {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true, outlet: true },
    });
    const lines: OrderLineInput[] = order.items
      .filter((i) => i.status !== "VOIDED")
      .map((i) => ({
        unitPriceCents: i.unitPriceCents,
        quantity: i.quantity,
        modifierDeltaCents: (
          i.modifiersJson as { priceDeltaCents: number }[]
        ).reduce((s, m) => s + m.priceDeltaCents, 0),
      }));
    const totals = computeOrderTotals(lines, totalsConfig(order.outlet));
    return tx.order.update({
      where: { id: orderId },
      data: {
        subtotalCents: totals.subtotalCents,
        serviceChargeCents: totals.serviceChargeCents,
        taxCents: totals.taxCents,
        totalCents: totals.totalCents,
      },
      include: ORDER_INCLUDE,
    });
  }
}

function toLine(item: ResolvedItem): OrderLineInput {
  return {
    unitPriceCents: item.unitPriceCents,
    quantity: item.quantity,
    modifierDeltaCents: item.modifiersJson.reduce((s, m) => s + m.priceDeltaCents, 0),
  };
}

function totalsConfig(outlet: {
  serviceChargeBps: number;
  taxBps: number;
  taxInclusive: boolean;
  serviceChargeTaxable: boolean;
  cashRounding: string;
}): TotalsConfig {
  return {
    serviceChargeBps: outlet.serviceChargeBps,
    taxBps: outlet.taxBps,
    taxInclusive: outlet.taxInclusive,
    serviceChargeTaxable: outlet.serviceChargeTaxable,
    cashRounding: outlet.cashRounding as TotalsConfig["cashRounding"],
  };
}

/** Calendar date in the outlet's timezone, e.g. "2026-07-17". */
function bizDate(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
