import type { CashRoundingMode } from "@pos/shared";

export interface Session {
  token: string;
  staff: {
    id: string;
    name: string;
    role: string;
    companyId: string;
    outletId: string | null;
  };
}

export interface OutletConfig {
  id: string;
  name: string;
  currency: "MYR" | "SGD";
  serviceChargeBps: number;
  taxBps: number;
  taxInclusive: boolean;
  serviceChargeTaxable: boolean;
  cashRounding: CashRoundingMode;
  loyaltyEarnPerCurrencyUnit: number;
  loyaltyRedeemCentsPerPoint: number;
}

export interface MemberSummary {
  id: string;
  phone: string;
  name: string | null;
  pointsBalance: number;
  visits: number;
}

export interface Modifier {
  id: string;
  name: string;
  priceDeltaCents: number;
  soldOut: boolean;
}

export interface ModifierGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  modifiers: Modifier[];
}

export interface Product {
  id: string;
  name: string;
  priceCents: number;
  soldOut: boolean;
  imageUrl: string | null;
  modifierGroups: ModifierGroup[];
}

export interface Category {
  id: string;
  name: string;
  products: Product[];
}

export interface MenuData {
  outlet: OutletConfig;
  categories: Category[];
}

export interface DiningTable {
  id: string;
  name: string;
  zone: string | null;
  seats: number;
}

export interface ChosenModifier {
  id: string;
  name: string;
  priceDeltaCents: number;
  groupName: string;
}

/** A line in the not-yet-sent cart. */
export interface CartLine {
  key: string;
  productId: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
  modifiers: ChosenModifier[];
  note: string;
}

export interface OrderItem {
  id: string;
  productId: string | null;
  nameSnapshot: string;
  unitPriceCents: number;
  quantity: number;
  modifiersJson: { groupName: string; name: string; priceDeltaCents: number }[];
  notes: string | null;
  status: string;
  courseNo: number;
  station: string | null;
}

export interface Payment {
  id: string;
  method: string;
  amountCents: number;
  tenderedCents: number | null;
  changeCents: number | null;
  status: string;
  paidAt: string;
}

export type OrderType = "DINE_IN" | "TAKEAWAY" | "PICKUP" | "DELIVERY";

export interface Order {
  id: string;
  orderNo: number | null;
  type: OrderType;
  source: string;
  status: "OPEN" | "COMPLETED" | "VOIDED";
  tableId: string | null;
  memberId?: string | null;
  guestCount: number;
  notes: string | null;
  subtotalCents: number;
  serviceChargeCents: number;
  taxCents: number;
  roundingCents: number;
  totalCents: number;
  openedAt: string;
  items: OrderItem[];
  payments: Payment[];
}

/** Order as stored locally — server shape plus sync bookkeeping. */
export interface LocalOrder extends Order {
  syncState: "pending" | "synced" | "error";
  syncError?: string;
  /** Provisional per-terminal number shown until the server assigns orderNo. */
  localNo?: number;
}
