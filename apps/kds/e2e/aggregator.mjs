// Aggregator webhook e2e: ingest, station routing, KDS push, cancel/restore.
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

const [, reg] = await call("POST", "/devices", { outletId: OUTLET, name: `AggLink ${Date.now()}`, kind: "AGGREGATOR" }, OWNER);
const AGG = reg.deviceToken;

// Find the rice ingredient actually on the chicken-rice recipe (reruns of the
// inventory suite create fresh ingredients each time).
const [, menuForRecipe] = await call("GET", `/outlets/${OUTLET}/menu`, undefined, OWNER);
const chickenRice = menuForRecipe.categories
  .flatMap((c) => c.products)
  .find((p) => p.name === "Hainanese Chicken Rice");
const [, recipe] = await call("GET", `/admin/products/${chickenRice.id}/recipe`, undefined, OWNER);
const riceIngredientId = recipe.items?.find((i) => i.name.startsWith("Rice"))?.ingredientId ?? null;
const [, stockBefore] = await call("GET", `/admin/outlets/${OUTLET}/stock`, undefined, OWNER);

const socket = io(RT, { auth: { token: OWNER } });
await waitFor(socket, "connect");
socket.emit("subscribe", { outletId: OUTLET });
await new Promise((r) => setTimeout(r, 300));

const [s0] = await call("POST", "/aggregator/orders", { provider: "MOCK", externalRef: "x123456", orderType: "DELIVERY", items: [{ name: "Kopi O", quantity: 1, priceCents: 500 }] }, undefined, { "X-Device-Token": "nope" });
check("bad token rejected 401", s0 === 401, s0);

const ref = "GF-" + Math.floor(Math.random() * 1e9);
const createdPromise = waitFor(socket, "order.created");
const [s1, order] = await call("POST", "/aggregator/orders", {
  provider: "GrabFood",
  externalRef: ref,
  orderType: "DELIVERY",
  customerName: "Aina",
  items: [
    { name: "Hainanese Chicken Rice", quantity: 2, priceCents: 1500 },
    { name: "Mystery Platform Combo", quantity: 1, priceCents: 2000, notes: "no cutlery" },
  ],
}, undefined, { "X-Device-Token": AGG });
check("order ingested", s1 === 201, JSON.stringify(order));
check("source AGGREGATOR + settled", order.source === "AGGREGATOR" && order.status === "COMPLETED", `${order.source}/${order.status}`);
check("totals from platform prices", order.subtotalCents === 5000 && order.totalCents === 5000, order.totalCents);
check("platform payment ref", order.payments[0]?.gatewayRef === `GRABFOOD:${ref}`, JSON.stringify(order.payments));
const matched = order.items.find((i) => i.nameSnapshot === "Hainanese Chicken Rice");
const unmatched = order.items.find((i) => i.nameSnapshot === "Mystery Platform Combo");
check("matched item routed to station", matched?.station === "wok", matched?.station);
check("unmatched item null product", unmatched && unmatched.productId === null, JSON.stringify(unmatched));
const kds = await createdPromise;
check("KDS received order", kds.id === order.id, kds.id);

const [, dup] = await call("POST", "/aggregator/orders", { provider: "GRABFOOD", externalRef: ref, orderType: "DELIVERY", items: [{ name: "Kopi O", quantity: 9, priceCents: 1 }] }, undefined, { "X-Device-Token": AGG });
check("replay idempotent", dup.id === order.id && dup.totalCents === 5000, dup.totalCents);

const [, stockAfter] = await call("GET", `/admin/outlets/${OUTLET}/stock`, undefined, OWNER);
const riceBefore = riceIngredientId
  ? stockBefore.find((r) => r.ingredientId === riceIngredientId)
  : null;
if (riceBefore) {
  const riceAfter = stockAfter.find((r) => r.ingredientId === riceBefore.ingredientId);
  check("inventory deducted for matched items", parseFloat(riceAfter.onHandQty) === parseFloat(riceBefore.onHandQty) - 400, `${riceBefore.onHandQty} -> ${riceAfter.onHandQty}`);
} else {
  console.log("SKIP  inventory check (no recipes present)");
}

const [s2, cancel] = await call("POST", "/aggregator/orders/cancel", { provider: "grabfood", externalRef: ref, reason: "rider unavailable" }, undefined, { "X-Device-Token": AGG });
check("cancel accepted", s2 === 201 && cancel.status === "VOIDED", JSON.stringify(cancel));
if (riceBefore) {
  const [, stockFinal] = await call("GET", `/admin/outlets/${OUTLET}/stock`, undefined, OWNER);
  const riceFinal = stockFinal.find((r) => r.ingredientId === riceBefore.ingredientId);
  check("cancel restored stock", parseFloat(riceFinal.onHandQty) === parseFloat(riceBefore.onHandQty), riceFinal.onHandQty);
}
const [, again] = await call("POST", "/aggregator/orders/cancel", { provider: "GRABFOOD", externalRef: ref }, undefined, { "X-Device-Token": AGG });
check("cancel idempotent", again.status === "VOIDED", JSON.stringify(again));

socket.close();
console.log(failed ? "\nSOME CHECKS FAILED" : "\nAll aggregator e2e checks passed.");
process.exit(failed ? 1 : 0);
