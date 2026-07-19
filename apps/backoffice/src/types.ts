export interface Staff {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  active: boolean;
  hasPin: boolean;
  hasPassword: boolean;
  salaryType: "MONTHLY" | "HOURLY" | null;
  monthlySalaryCents: number | null;
  hourlyRateCents: number | null;
}

export interface Outlet {
  id: string;
  name: string;
  address: string | null;
  active: boolean;
  serviceChargeBps: number;
  taxBps: number;
  taxInclusive: boolean;
  serviceChargeTaxable: boolean;
  cashRounding: string;
}

export interface Category {
  id: string;
  name: string;
  sortOrder: number;
  active: boolean;
}

export interface Product {
  id: string;
  name: string;
  basePriceCents: number;
  categoryId: string | null;
  kitchenStation: string | null;
  sku: string | null;
  active: boolean;
  soldOut: boolean;
  modifierGroupIds: string[];
}

export interface Modifier {
  id: string;
  name: string;
  priceDeltaCents: number;
  soldOut: boolean;
  sortOrder: number;
}

export interface ModifierGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  modifiers: Modifier[];
}

export interface Catalog {
  categories: Category[];
  products: Product[];
  modifierGroups: ModifierGroup[];
}

export interface DiningTable {
  id: string;
  name: string;
  zone: string | null;
  seats: number;
  qrToken: string;
}

export interface Device {
  id: string;
  outletId: string;
  name: string;
  kind: string;
  active: boolean;
  lastSeenAt: string | null;
}

export interface DailyReport {
  date: string;
  revenueCents: number;
  orderCount: number;
  openCount: number;
  voidedCount: number;
  voidedItems: number;
  averageOrderCents: number;
  byPayment: { method: string; amountCents: number; count: number }[];
  topItems: { name: string; quantity: number; salesCents: number }[];
  bySource: Record<string, number>;
}
