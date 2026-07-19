import type {
  CashRoundingMode,
  OrderLineInput,
  OrderTotals,
  TotalsConfig,
} from "./types";

/** Integer half-up rounding of (amount * bps / 10000) without float drift. */
function applyBps(amountCents: number, bps: number): number {
  return Math.floor((amountCents * bps + 5000) / 10000);
}

/** Extract the tax portion contained in a tax-inclusive amount. */
function inclusiveTaxPortion(grossCents: number, taxBps: number): number {
  return Math.floor((grossCents * taxBps + (10000 + taxBps) / 2) / (10000 + taxBps));
}

export function lineTotalCents(line: OrderLineInput): number {
  const unit = line.unitPriceCents + (line.modifierDeltaCents ?? 0);
  return unit * line.quantity;
}

/**
 * Bill total pipeline shared by server and offline POS:
 * items -> subtotal -> discount -> service charge -> tax -> total.
 * Discounts apply before service charge and tax (standard MY/SG practice).
 * Cash rounding is intentionally NOT applied here — it happens at tender
 * time via applyCashRounding, and only for cash.
 */
export function computeOrderTotals(
  lines: OrderLineInput[],
  config: TotalsConfig,
  discountCents = 0,
): OrderTotals {
  const subtotalCents = lines.reduce((sum, l) => sum + lineTotalCents(l), 0);
  const discount = Math.min(Math.max(0, Math.floor(discountCents)), subtotalCents);
  const discountedCents = subtotalCents - discount;
  const serviceChargeCents = applyBps(discountedCents, config.serviceChargeBps);

  let taxCents: number;
  let totalCents: number;
  const taxBase =
    discountedCents + (config.serviceChargeTaxable ? serviceChargeCents : 0);

  if (config.taxInclusive) {
    taxCents = inclusiveTaxPortion(taxBase, config.taxBps);
    totalCents = discountedCents + serviceChargeCents;
  } else {
    taxCents = applyBps(taxBase, config.taxBps);
    totalCents = discountedCents + serviceChargeCents + taxCents;
  }

  return { subtotalCents, discountCents: discount, serviceChargeCents, taxCents, totalCents };
}

/**
 * Malaysia BNM 5-sen cash rounding: 1,2 sen round down; 3,4 up to 5;
 * 6,7 down to 5; 8,9 up to 10. Applied only to cash tenders.
 */
export function applyCashRounding(
  totalCents: number,
  mode: CashRoundingMode,
): { roundedTotalCents: number; roundingAdjustmentCents: number } {
  if (mode === "NONE") {
    return { roundedTotalCents: totalCents, roundingAdjustmentCents: 0 };
  }
  const rounded = Math.round(totalCents / 5) * 5;
  return {
    roundedTotalCents: rounded,
    roundingAdjustmentCents: rounded - totalCents,
  };
}

export function formatCents(cents: number, currency: "MYR" | "SGD"): string {
  const symbol = currency === "MYR" ? "RM" : "S$";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const units = Math.floor(abs / 100);
  const rem = String(abs % 100).padStart(2, "0");
  return `${sign}${symbol}${units.toLocaleString("en-US")}.${rem}`;
}
