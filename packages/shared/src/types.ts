export type Country = "MY" | "SG";
export type Currency = "MYR" | "SGD";

export type OrderType = "DINE_IN" | "TAKEAWAY" | "PICKUP" | "DELIVERY";
export type OrderSource = "POS" | "QR" | "KIOSK" | "AGGREGATOR";
export type OrderStatus = "OPEN" | "COMPLETED" | "VOIDED";
export type OrderItemStatus =
  | "PENDING"
  | "PREPARING"
  | "READY"
  | "SERVED"
  | "VOIDED";

export type PaymentMethod =
  | "CASH"
  | "CARD"
  | "QR_WALLET"
  | "GIFT_CARD"
  | "STORED_VALUE"
  | "OTHER";

export type CashRoundingMode = "NONE" | "MY_5_SEN";

/** Tax/charge configuration for an outlet. Rates in basis points (600 = 6%). */
export interface TotalsConfig {
  /** Service charge, e.g. 1000 = 10%. 0 to disable. */
  serviceChargeBps: number;
  /** SST 6%/8% (MY) or GST 9% (SG), e.g. 600 / 900. 0 to disable. */
  taxBps: number;
  /** True when menu prices already include tax (common in MY F&B). */
  taxInclusive: boolean;
  /** True when tax is charged on subtotal + service charge (standard MY/SG). */
  serviceChargeTaxable: boolean;
  /** Cash rounding applied at tender time, not on the bill total. */
  cashRounding: CashRoundingMode;
}

export interface OrderLineInput {
  unitPriceCents: number;
  quantity: number;
  /** Sum of selected modifier price deltas per unit, in cents. */
  modifierDeltaCents?: number;
}

export interface OrderTotals {
  subtotalCents: number;
  /** Discount actually applied (input clamped to [0, subtotal]). */
  discountCents: number;
  serviceChargeCents: number;
  taxCents: number;
  totalCents: number;
}
