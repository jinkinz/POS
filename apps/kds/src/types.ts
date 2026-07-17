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

export interface OrderItem {
  id: string;
  nameSnapshot: string;
  quantity: number;
  modifiersJson: { groupName: string; name: string; priceDeltaCents: number }[];
  notes: string | null;
  status: "PENDING" | "PREPARING" | "READY" | "SERVED" | "VOIDED";
  courseNo: number;
  station: string | null;
}

export interface Order {
  id: string;
  orderNo: number | null;
  type: string;
  source: string;
  status: "OPEN" | "COMPLETED" | "VOIDED";
  tableId: string | null;
  notes: string | null;
  openedAt: string;
  items: OrderItem[];
}
