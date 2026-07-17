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
import { PrismaService } from "../prisma.service";
import { AddItemsDto, CreateOrderDto, OrderItemInputDto, PayDto } from "./dto";

type Tx = Prisma.TransactionClient;

interface ResolvedItem {
  id: string;
  productId: string;
  nameSnapshot: string;
  unitPriceCents: number;
  quantity: number;
  modifiersJson: { groupName: string; name: string; priceDeltaCents: number }[];
  notes: string | null;
  courseNo: number;
  station: string | null;
}

const ORDER_INCLUDE = {
  items: { orderBy: { createdAt: "asc" as const } },
  payments: { orderBy: { paidAt: "asc" as const } },
};

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- queries ----------

  async getOrder(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: ORDER_INCLUDE,
    });
    if (!order) throw new NotFoundException("Order not found");
    return order;
  }

  listOutletOrders(outletId: string, status?: OrderStatus) {
    return this.prisma.order.findMany({
      where: { outletId, ...(status ? { status } : {}) },
      orderBy: { openedAt: "desc" },
      take: 100,
      include: ORDER_INCLUDE,
    });
  }

  // ---------- commands ----------

  async createOrder(dto: CreateOrderDto) {
    if (dto.id) {
      // Offline sync replays are expected; creation is idempotent on id.
      const existing = await this.prisma.order.findUnique({
        where: { id: dto.id },
        include: ORDER_INCLUDE,
      });
      if (existing) return existing;
    }

    return this.prisma.$transaction(async (tx) => {
      const outlet = await tx.outlet.findUnique({
        where: { id: dto.outletId },
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

      return tx.order.create({
        data: {
          id: dto.id ?? randomUUID(),
          companyId: outlet.companyId,
          outletId: outlet.id,
          tableId: dto.tableId,
          staffId: dto.staffId,
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
  }

  async addItems(orderId: string, dto: AddItemsDto) {
    return this.prisma.$transaction(async (tx) => {
      const order = await this.getOpenOrder(tx, orderId);
      if (order.payments.some((p) => p.status === PaymentStatus.CAPTURED)) {
        throw new ConflictException("Cannot add items after payment has started");
      }
      const resolved = await this.resolveItems(tx, order.companyId, dto.items);
      // Idempotent on item id: skip rows already applied by a previous sync push.
      const existingIds = new Set(order.items.map((i) => i.id));
      const fresh = resolved.filter((r) => !existingIds.has(r.id));
      if (fresh.length > 0) {
        await tx.orderItem.createMany({
          data: fresh.map((r) => ({
            ...r,
            modifiersJson: r.modifiersJson as unknown as Prisma.InputJsonValue,
            orderId,
          })),
        });
      }
      return this.recomputeTotals(tx, orderId);
    });
  }

  async voidItem(orderId: string, itemId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await this.getOpenOrder(tx, orderId);
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
      return this.recomputeTotals(tx, orderId);
    });
  }

  async voidOrder(orderId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await this.getOpenOrder(tx, orderId);
      if (order.payments.some((p) => p.status === PaymentStatus.CAPTURED)) {
        throw new ConflictException(
          "Order has captured payments — refund first, then void",
        );
      }
      return tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.VOIDED, voidReason: reason, closedAt: new Date() },
        include: ORDER_INCLUDE,
      });
    });
  }

  /**
   * Records one tender. Split tender is supported: pay less than the balance
   * and the order stays OPEN. MY 5-sen rounding applies only when a cash
   * tender settles the remaining balance (BNM guideline: round the final
   * cash amount, not each payment).
   */
  async pay(orderId: string, dto: PayDto) {
    if (dto.id) {
      const existing = await this.prisma.payment.findUnique({ where: { id: dto.id } });
      if (existing) return this.paymentResult(orderId, existing.id);
    }

    const paymentId = await this.prisma.$transaction(async (tx) => {
      const order = await this.getOpenOrder(tx, orderId);
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

    return this.paymentResult(orderId, paymentId);
  }

  // ---------- internals ----------

  private async paymentResult(orderId: string, paymentId: string) {
    const order = await this.getOrder(orderId);
    const payment = order.payments.find((p) => p.id === paymentId);
    return { order, payment };
  }

  private async getOpenOrder(tx: Tx, orderId: string) {
    const order = await tx.order.findUnique({
      where: { id: orderId },
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
