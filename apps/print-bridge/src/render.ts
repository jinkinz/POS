import { EscPos, padLine, wrapText } from "./escpos";

const WIDTH = 42; // characters on 80mm paper at default font

export interface ReceiptPayload {
  kind: "receipt";
  outletName: string;
  address: string | null;
  currency: "MYR" | "SGD";
  orderNo: number | null;
  orderType: string;
  tableName: string | null;
  at: string;
  items: {
    quantity: number;
    name: string;
    modifiers: string[];
    amountCents: number;
  }[];
  subtotalCents: number;
  serviceChargeCents: number;
  taxCents: number;
  roundingCents: number;
  totalCents: number;
  payments: {
    method: string;
    amountCents: number;
    tenderedCents: number | null;
    changeCents: number | null;
  }[];
}

export interface KitchenPayload {
  kind: "kitchen";
  station: string;
  orderNo: number | null;
  orderType: string;
  source: string;
  tableName: string | null;
  orderNotes: string | null;
  at: string;
  items: {
    quantity: number;
    name: string;
    modifiers: string[];
    notes: string | null;
  }[];
}

export interface ZReportPayload {
  kind: "zreport";
  shiftId: string;
  reportKind?: "X" | "Z";
  kindLabel?: string;
  outletName: string;
  staffName: string;
  openedAt: string;
  closedAt: string | null;
  currency: "MYR" | "SGD";
  payments: { method: string; amountCents: number; count: number }[];
  completedOrders: number;
  salesCents: number;
  voidedOrders: number;
  cash: {
    openingFloatCents: number;
    cashSalesCents: number;
    cashInCents: number;
    cashOutCents: number;
    expectedCents: number;
    countedCents: number | null;
    varianceCents: number | null;
  };
  movements: { type: string; amountCents: number; reason: string; at: string }[];
}

function money(cents: number, currency: "MYR" | "SGD"): string {
  const symbol = currency === "MYR" ? "RM" : "S$";
  const sign = cents < 0 ? "-" : "";
  return `${sign}${symbol}${(Math.abs(cents) / 100).toFixed(2)}`;
}

export function renderReceipt(p: ReceiptPayload): Buffer {
  const e = new EscPos().init();
  const fmt = (c: number) => money(c, p.currency);

  e.align("center").bold(true).line(p.outletName).bold(false);
  if (p.address) for (const l of wrapText(p.address, WIDTH)) e.line(l);
  e.line("-".repeat(WIDTH));
  e.align("left");
  e.line(
    `Order ${p.orderNo != null ? "#" + p.orderNo : ""}  ${p.orderType.replace("_", " ")}` +
      (p.tableName ? `  Table ${p.tableName}` : ""),
  );
  e.line(new Date(p.at).toLocaleString("en-MY"));
  e.line("-".repeat(WIDTH));

  for (const item of p.items) {
    e.line(padLine(`${item.quantity}x ${item.name}`, fmt(item.amountCents), WIDTH));
    for (const mod of item.modifiers) e.line(`   + ${mod}`);
  }

  e.line("-".repeat(WIDTH));
  e.line(padLine("Subtotal", fmt(p.subtotalCents), WIDTH));
  if (p.serviceChargeCents > 0) {
    e.line(padLine("Service charge", fmt(p.serviceChargeCents), WIDTH));
  }
  if (p.taxCents > 0) e.line(padLine("Tax", fmt(p.taxCents), WIDTH));
  if (p.roundingCents !== 0) e.line(padLine("Rounding", fmt(p.roundingCents), WIDTH));
  e.bold(true).line(padLine("TOTAL", fmt(p.totalCents), WIDTH)).bold(false);

  for (const pay of p.payments) {
    e.line(padLine(pay.method.replace("_", " "), fmt(pay.amountCents), WIDTH));
    if (pay.tenderedCents != null && pay.tenderedCents !== pay.amountCents) {
      e.line(padLine("  tendered", fmt(pay.tenderedCents), WIDTH));
    }
    if (pay.changeCents) e.line(padLine("  change", fmt(pay.changeCents), WIDTH));
  }

  e.line("-".repeat(WIDTH));
  e.align("center").line("Thank you! Terima kasih!").feed(3).cut();
  return e.build();
}

export function renderZReport(p: ZReportPayload & { kind_?: string }): Buffer {
  const e = new EscPos().init();
  const fmt = (c: number) => money(c, p.currency);
  const label = p.closedAt ? "Z REPORT" : "X REPORT";

  e.align("center").size(2).bold(true).line(label).bold(false).size(1);
  e.line(p.outletName);
  e.align("left").line("-".repeat(WIDTH));
  e.line(`Staff: ${p.staffName}`);
  e.line(`Open : ${new Date(p.openedAt).toLocaleString("en-MY")}`);
  if (p.closedAt) e.line(`Close: ${new Date(p.closedAt).toLocaleString("en-MY")}`);
  e.line("-".repeat(WIDTH));

  e.bold(true).line("SALES").bold(false);
  e.line(padLine(`Orders completed`, String(p.completedOrders), WIDTH));
  e.line(padLine(`Orders voided`, String(p.voidedOrders), WIDTH));
  e.line(padLine(`Total sales`, fmt(p.salesCents), WIDTH));
  for (const pay of p.payments) {
    e.line(
      padLine(`  ${pay.method.replace("_", " ")} (${pay.count})`, fmt(pay.amountCents), WIDTH),
    );
  }
  e.line("-".repeat(WIDTH));

  e.bold(true).line("CASH DRAWER").bold(false);
  e.line(padLine("Opening float", fmt(p.cash.openingFloatCents), WIDTH));
  e.line(padLine("Cash sales", fmt(p.cash.cashSalesCents), WIDTH));
  e.line(padLine("Cash in", fmt(p.cash.cashInCents), WIDTH));
  e.line(padLine("Cash out", fmt(-p.cash.cashOutCents), WIDTH));
  e.bold(true).line(padLine("Expected", fmt(p.cash.expectedCents), WIDTH)).bold(false);
  if (p.cash.countedCents != null) {
    e.line(padLine("Counted", fmt(p.cash.countedCents), WIDTH));
    e.bold(true)
      .line(padLine("VARIANCE", fmt(p.cash.varianceCents ?? 0), WIDTH))
      .bold(false);
  }

  if (p.movements.length > 0) {
    e.line("-".repeat(WIDTH));
    for (const m of p.movements) {
      e.line(
        padLine(
          `${m.type === "CASH_IN" ? "+" : "-"} ${m.reason}`.slice(0, WIDTH - 10),
          fmt(m.amountCents),
          WIDTH,
        ),
      );
    }
  }
  e.feed(3).cut();
  return e.build();
}

export function renderKitchen(p: KitchenPayload): Buffer {
  const e = new EscPos().init();
  e.align("center").size(2).bold(true);
  e.line(`${p.station.toUpperCase()}  ${p.orderNo != null ? "#" + p.orderNo : ""}`);
  e.bold(false).size(1);
  e.line(
    `${p.orderType.replace("_", " ")}  ${p.source}` +
      (p.tableName ? `  Table ${p.tableName}` : ""),
  );
  e.line(new Date(p.at).toLocaleTimeString("en-MY"));
  e.align("left").line("-".repeat(WIDTH));

  e.size(2);
  for (const item of p.items) {
    for (const l of wrapText(`${item.quantity}x ${item.name}`, WIDTH / 2)) e.line(l);
    e.size(1);
    for (const mod of item.modifiers) e.line(`   + ${mod}`);
    if (item.notes) for (const l of wrapText(`   "${item.notes}"`, WIDTH)) e.line(l);
    e.size(2);
  }
  e.size(1);

  if (p.orderNotes) {
    e.line("-".repeat(WIDTH));
    for (const l of wrapText(p.orderNotes, WIDTH)) e.line(l);
  }
  e.feed(3).cut();
  return e.build();
}
