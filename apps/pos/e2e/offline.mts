// Offline-parity e2e: drive the real POS store + sync engine (fake IndexedDB)
// against the live API — offline math must match the server to the cent.
import "fake-indexeddb/auto";
import { api, setApiBase } from "../src/api";
import { db } from "../src/db";
import { createOrder, payOrder } from "../src/store";
import { sync } from "../src/sync";
import type { MenuData, Order } from "../src/types";

const BASE = process.env.E2E_BASE ?? "http://localhost:3000/api";
setApiBase(BASE);

let failed = false;
function check(name: string, cond: boolean, detail = "") {
  console.log((cond ? "PASS  " : "FAIL  ") + name + (cond ? "" : `  -> ${detail}`));
  if (!cond) failed = true;
}

const owner = await api<{ token: string; staff: { id: string } }>(
  "POST",
  "/auth/login",
  { email: "owner@demokopitiam.my", password: "password12345" },
);
const outlets = await api<{ id: string }[]>("GET", "/admin/outlets", undefined, owner.token);
const OUTLET = outlets[0]!.id;
const menu = await api<MenuData>("GET", `/outlets/${OUTLET}/menu`, undefined, owner.token);
const prods = Object.fromEntries(
  menu.categories.flatMap((c) => c.products.map((p) => [p.name, p])),
);
const cr = prods["Hainanese Chicken Rice"]!;
const egg = cr.modifierGroups[0]!.modifiers.find((m) => m.name === "Extra egg")!;
const teh = prods["Teh Tarik"]!;

// 1. build the order entirely "offline"
const local = await createOrder({
  outlet: menu.outlet,
  type: "TAKEAWAY",
  staffId: owner.staff.id,
  lines: [
    {
      key: "k1",
      productId: cr.id,
      name: cr.name,
      unitPriceCents: cr.priceCents,
      quantity: 1,
      modifiers: [{ id: egg.id, name: egg.name, priceDeltaCents: egg.priceDeltaCents, groupName: "Add-ons" }],
      note: "less oil",
    },
    { key: "k2", productId: teh.id, name: teh.name, unitPriceCents: teh.priceCents, quantity: 2, modifiers: [], note: "" },
  ],
});
check("offline subtotal 1990", local.subtotalCents === 1990, String(local.subtotalCents));
check("offline total 2320", local.totalCents === 2320, String(local.totalCents));

// 2. cash payment offline
const { order: paidLocal, payment } = await payOrder(local, menu.outlet, "CASH", 5000);
check("offline change 2680", payment.changeCents === 2680, String(payment.changeCents));
check("offline COMPLETED", paidLocal.status === "COMPLETED", paidLocal.status);
check("two ops queued", (await db.outbox.count()) === 2, String(await db.outbox.count()));

// 3. reconnect
sync.configure(owner.token);
await sync.drain();
check("outbox drained", (await db.outbox.count()) === 0, String(await db.outbox.count()));
const stored = (await db.orders.get(local.id))!;
check("synced with server orderNo", stored.syncState === "synced" && typeof stored.orderNo === "number", stored.syncState);

// 4. server agrees exactly
const server = await api<Order>("GET", `/orders/${local.id}`, undefined, owner.token);
check("server totals match", server.subtotalCents === 1990 && server.totalCents === 2320, `${server.subtotalCents}/${server.totalCents}`);
check("server change matches", server.payments[0]?.changeCents === 2680, String(server.payments[0]?.changeCents));
check("note survived", server.items.find((i) => i.productId === cr.id)?.notes === "less oil");

// 5. crash-replay is harmless
await db.outbox.add({ kind: "createOrder", orderId: local.id, payload: { id: local.id, outletId: OUTLET, type: "TAKEAWAY", source: "POS", items: [] } });
await db.outbox.add({ kind: "pay", orderId: local.id, payload: { id: payment.id, method: "CASH", tenderedCents: 5000 } });
await sync.drain();
const after = await api<Order>("GET", `/orders/${local.id}`, undefined, owner.token);
check("replay idempotent", after.payments.length === 1 && after.totalCents === 2320, `${after.payments.length}/${after.totalCents}`);

console.log(failed ? "\nSOME CHECKS FAILED" : "\nAll offline-parity checks passed.");
process.exit(failed ? 1 : 0);
