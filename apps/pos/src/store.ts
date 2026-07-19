import {
  applyCashRounding,
  computeOrderTotals,
  type OrderLineInput,
  type TotalsConfig,
} from "@pos/shared";
import { db, kvGet, kvSet } from "./db";
import { sync } from "./sync";
import type {
  CartLine,
  LocalOrder,
  Order,
  OrderType,
  OutletConfig,
  Payment,
} from "./types";

export function totalsConfig(outlet: OutletConfig): TotalsConfig {
  return {
    serviceChargeBps: outlet.serviceChargeBps,
    taxBps: outlet.taxBps,
    taxInclusive: outlet.taxInclusive,
    serviceChargeTaxable: outlet.serviceChargeTaxable,
    cashRounding: outlet.cashRounding,
  };
}

export function cartLineInput(line: CartLine): OrderLineInput {
  return {
    unitPriceCents: line.unitPriceCents,
    quantity: line.quantity,
    modifierDeltaCents: line.modifiers.reduce((s, m) => s + m.priceDeltaCents, 0),
  };
}

async function nextLocalNo(): Promise<number> {
  const key = `localNo:${new Date().toISOString().slice(0, 10)}`;
  const current = (await kvGet<number>(key)) ?? 0;
  await kvSet(key, current + 1);
  return current + 1;
}

/**
 * Optimistically stores the order locally and queues the create for sync.
 * Totals are computed with the same shared pipeline the server uses, so the
 * offline receipt matches what the server will record.
 */
export async function createOrder(opts: {
  outlet: OutletConfig;
  type: OrderType;
  tableId?: string;
  guestCount?: number;
  staffId: string;
  memberId?: string;
  lines: CartLine[];
}): Promise<LocalOrder> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const items = opts.lines.map((line) => ({
    id: crypto.randomUUID(),
    line,
  }));
  const totals = computeOrderTotals(
    opts.lines.map(cartLineInput),
    totalsConfig(opts.outlet),
  );

  const local: LocalOrder = {
    id,
    orderNo: null,
    localNo: await nextLocalNo(),
    type: opts.type,
    source: "POS",
    status: "OPEN",
    tableId: opts.tableId ?? null,
    memberId: opts.memberId ?? null,
    discountCents: 0,
    guestCount: opts.guestCount ?? 1,
    notes: null,
    subtotalCents: totals.subtotalCents,
    serviceChargeCents: totals.serviceChargeCents,
    taxCents: totals.taxCents,
    roundingCents: 0,
    totalCents: totals.totalCents,
    openedAt: now,
    items: items.map(({ id: itemId, line }) => ({
      id: itemId,
      productId: line.productId,
      nameSnapshot: line.name,
      unitPriceCents: line.unitPriceCents,
      quantity: line.quantity,
      modifiersJson: line.modifiers.map((m) => ({
        id: m.id,
        groupName: m.groupName,
        name: m.name,
        priceDeltaCents: m.priceDeltaCents,
      })),
      notes: line.note || null,
      status: "PENDING",
      courseNo: 1,
      station: null,
    })),
    payments: [],
    syncState: "pending",
  };

  await db.orders.put(local);
  await db.outbox.add({
    kind: "createOrder",
    orderId: id,
    payload: {
      id,
      outletId: opts.outlet.id,
      type: opts.type,
      source: "POS",
      tableId: opts.tableId,
      guestCount: opts.guestCount ?? 1,
      staffId: opts.staffId,
      memberId: opts.memberId,
      items: items.map(({ id: itemId, line }) => ({
        id: itemId,
        productId: line.productId,
        quantity: line.quantity,
        modifierIds: line.modifiers.map((m) => m.id),
        notes: line.note || undefined,
      })),
    },
  });
  sync.kick();
  return local;
}

export async function addItemsToOrder(
  order: LocalOrder,
  outlet: OutletConfig,
  lines: CartLine[],
): Promise<LocalOrder> {
  const items = lines.map((line) => ({ id: crypto.randomUUID(), line }));
  const merged: LocalOrder = {
    ...order,
    items: [
      ...order.items,
      ...items.map(({ id, line }) => ({
        id,
        productId: line.productId,
        nameSnapshot: line.name,
        unitPriceCents: line.unitPriceCents,
        quantity: line.quantity,
        modifiersJson: line.modifiers.map((m) => ({
          id: m.id,
          groupName: m.groupName,
          name: m.name,
          priceDeltaCents: m.priceDeltaCents,
        })),
        notes: line.note || null,
        status: "PENDING",
        courseNo: 1,
        station: null,
      })),
    ],
  };
  const activeLines: OrderLineInput[] = merged.items
    .filter((i) => i.status !== "VOIDED")
    .map((i) => ({
      unitPriceCents: i.unitPriceCents,
      quantity: i.quantity,
      modifierDeltaCents: i.modifiersJson.reduce((s, m) => s + m.priceDeltaCents, 0),
    }));
  const totals = computeOrderTotals(
    activeLines,
    totalsConfig(outlet),
    order.discountCents ?? 0,
  );
  merged.subtotalCents = totals.subtotalCents;
  merged.discountCents = totals.discountCents;
  merged.serviceChargeCents = totals.serviceChargeCents;
  merged.taxCents = totals.taxCents;
  merged.totalCents = totals.totalCents;

  await db.orders.put(merged);
  await db.outbox.add({
    kind: "addItems",
    orderId: order.id,
    payload: {
      items: items.map(({ id, line }) => ({
        id,
        productId: line.productId,
        quantity: line.quantity,
        modifierIds: line.modifiers.map((m) => m.id),
        notes: line.note || undefined,
      })),
    },
  });
  sync.kick();
  return merged;
}

export function capturedCents(order: LocalOrder): number {
  return order.payments
    .filter((p) => p.status === "CAPTURED")
    .reduce((s, p) => s + p.amountCents, 0);
}

export function remainingCents(order: LocalOrder): number {
  return order.totalCents + order.roundingCents - capturedCents(order);
}

/**
 * Mirrors the server's tender logic (rounding only when cash settles the
 * bill) so the drawer opens on the right amount even offline.
 */
export async function payOrder(
  order: LocalOrder,
  outlet: OutletConfig,
  method: "CASH" | "CARD" | "QR_WALLET",
  tenderedCents?: number,
): Promise<{ order: LocalOrder; payment: Payment }> {
  const paid = capturedCents(order);
  const remaining = order.totalCents + order.roundingCents - paid;

  let amountCents: number;
  let tendered: number | null = null;
  let change: number | null = null;
  let roundingAdjustment = 0;

  if (method === "CASH") {
    const rounded = applyCashRounding(remaining, outlet.cashRounding);
    tendered = tenderedCents ?? rounded.roundedTotalCents;
    if (tendered >= rounded.roundedTotalCents) {
      amountCents = rounded.roundedTotalCents;
      change = tendered - rounded.roundedTotalCents;
      roundingAdjustment = rounded.roundingAdjustmentCents;
    } else {
      amountCents = tendered;
      change = 0;
    }
  } else {
    amountCents = remaining;
  }

  const payment: Payment = {
    id: crypto.randomUUID(),
    method,
    amountCents,
    tenderedCents: tendered,
    changeCents: change,
    status: "CAPTURED",
    paidAt: new Date().toISOString(),
  };

  const newRounding = order.roundingCents + roundingAdjustment;
  const settled = paid + amountCents >= order.totalCents + newRounding;
  const updated: LocalOrder = {
    ...order,
    payments: [...order.payments, payment],
    roundingCents: newRounding,
    status: settled ? "COMPLETED" : order.status,
  };

  await db.orders.put(updated);
  await db.outbox.add({
    kind: "pay",
    orderId: order.id,
    payload: {
      id: payment.id,
      method,
      ...(method === "CASH"
        ? { tenderedCents: tendered }
        : { amountCents }),
    },
  });
  sync.kick();
  return { order: updated, payment };
}

/** Server events echo our own syncs; only accept them once nothing local is queued. */
export async function applyServerOrder(order: Order): Promise<void> {
  const queued = await db.outbox.where("orderId").equals(order.id).count();
  if (queued > 0) return;
  const existing = await db.orders.get(order.id);
  await db.orders.put({
    ...order,
    syncState: "synced",
    localNo: existing?.localNo,
  });
}
