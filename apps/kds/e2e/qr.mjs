// QR ordering e2e: guest session, menu, order -> KDS socket, status, guards.
import { io } from "socket.io-client";

const API = process.env.E2E_BASE ?? "http://localhost:3000/api";
const RT = API.replace(/\/api$/, "") + "/rt";
let failed = false;
const check = (n, c, d = "") => {
  console.log((c ? "PASS  " : "FAIL  ") + n + (c ? "" : `  -> ${d}`));
  if (!c) failed = true;
};
async function call(m, p, b, t, h = {}) {
  const r = await fetch(API + p, {
    method: m,
    headers: {
      ...(b !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
      ...h,
    },
    body: b !== undefined ? JSON.stringify(b) : undefined,
  });
  return [r.status, await r.json().catch(() => ({}))];
}
const waitFor = (s, ev, ms = 5000) =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("timeout " + ev)), ms);
    s.once(ev, (p) => (clearTimeout(t), res(p)));
  });

const [, owner] = await call("POST", "/auth/login", { email: "owner@demokopitiam.my", password: "password12345" });
const OWNER = owner.token;
const [, outlets] = await call("GET", "/admin/outlets", undefined, OWNER);
const OUTLET = outlets[0].id;

const [, tables] = await call("GET", `/outlets/${OUTLET}/tables`, undefined, OWNER);
const table = tables[0];
check("staff sees table qrToken", typeof table?.qrToken === "string", JSON.stringify(table));

const [badStatus] = await call("POST", "/qr/session", { qrToken: "0000000000-nope" });
check("bad qr token rejected 404", badStatus === 404, badStatus);

const [sessStatus, sess] = await call("POST", "/qr/session", { qrToken: table.qrToken });
check("guest session created", sessStatus === 201, sessStatus);
const GUEST = sess.token;

const [menuStatus, menu] = await call("GET", "/qr/menu", undefined, GUEST);
check("guest reads menu", menuStatus === 200 && menu.categories.length > 0, menuStatus);
const [staffEp] = await call("GET", `/outlets/${OUTLET}/orders`, undefined, GUEST);
check("guest blocked from staff endpoint 403", staffEp === 403, staffEp);
const [noAuth] = await call("GET", "/qr/orders");
check("qr endpoints need session 401", noAuth === 401, noAuth);

const prods = Object.fromEntries(menu.categories.flatMap((c) => c.products.map((p) => [p.name, p])));
const nasi = prods["Nasi Lemak Ayam"];
const kopi = prods["Kopi O"];

const socket = io(RT, { auth: { token: OWNER } });
await waitFor(socket, "connect");
socket.emit("subscribe", { outletId: OUTLET });
await new Promise((r) => setTimeout(r, 300));

const createdPromise = waitFor(socket, "order.created");
const orderId = crypto.randomUUID();
const [placeStatus, placed] = await call("POST", "/qr/orders", {
  id: orderId,
  guestName: "Mei Ling",
  items: [
    { productId: nasi.id, quantity: 1 },
    { productId: kopi.id, quantity: 2, notes: "no ice" },
  ],
}, GUEST);
check("guest places order", placeStatus === 201, JSON.stringify(placed));
check("guest name recorded", placed.notes === "Guest: Mei Ling", placed.notes);
check("no staff internals leaked", placed.staffId === undefined && placed.payments === undefined, JSON.stringify(Object.keys(placed)));
const kds = await createdPromise;
check("QR order hit KDS socket", kds.id === orderId && kds.source === "QR", kds.source);

const [, dup] = await call("POST", "/qr/orders", { id: orderId, items: [{ productId: nasi.id, quantity: 9 }] }, GUEST);
check("retry does not double-order", dup.id === orderId && dup.items.length === 2, dup.items?.length);

const drinkIds = kds.items.filter((i) => i.station === "drinks").map((i) => i.id);
if (drinkIds.length > 0) {
  await call("POST", `/orders/${orderId}/items/status`, { itemIds: drinkIds, status: "READY" }, OWNER);
}
const [, mine] = await call("GET", "/qr/orders", undefined, GUEST);
const myOrder = mine.find((o) => o.id === orderId);
check("guest sees own order", !!myOrder, JSON.stringify(mine.map((o) => o.id)));
if (drinkIds.length > 0) {
  check("guest sees READY after bump", myOrder.items.some((i) => i.status === "READY"), JSON.stringify(myOrder.items.map((i) => i.status)));
}

await call("PATCH", `/products/${nasi.id}/sold-out`, { soldOut: true }, OWNER);
const [soldStatus] = await call("POST", "/qr/orders", { items: [{ productId: nasi.id, quantity: 1 }] }, GUEST);
check("sold-out rejected for guest 409", soldStatus === 409, soldStatus);
await call("PATCH", `/products/${nasi.id}/sold-out`, { soldOut: false }, OWNER);

socket.close();
console.log(failed ? "\nSOME CHECKS FAILED" : "\nAll QR e2e checks passed.");
process.exit(failed ? 1 : 0);
