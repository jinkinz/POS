import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "./db";
import { sync } from "./sync";
import type { LocalOrder } from "./types";

function localOrder(id: string): LocalOrder {
  return {
    id,
    orderNo: null,
    localNo: 1,
    type: "TAKEAWAY",
    source: "POS",
    status: "OPEN",
    tableId: null,
    guestCount: 1,
    notes: null,
    subtotalCents: 1000,
    discountCents: 0,
    serviceChargeCents: 0,
    taxCents: 0,
    roundingCents: 0,
    totalCents: 1000,
    openedAt: new Date().toISOString(),
    items: [],
    payments: [],
    syncState: "pending",
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("sync engine", () => {
  beforeEach(async () => {
    await db.outbox.clear();
    await db.orders.clear();
    sync.configure("test-token");
    vi.restoreAllMocks();
  });

  it("drains the outbox FIFO and stores server responses", async () => {
    const order = localOrder("11111111-1111-4111-8111-111111111111");
    await db.orders.put(order);
    await db.outbox.add({ kind: "createOrder", orderId: order.id, payload: { id: order.id } });
    await db.outbox.add({
      kind: "pay",
      orderId: order.id,
      payload: { id: "22222222-2222-4222-8222-222222222222", method: "CASH" },
    });

    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url.endsWith("/orders")) {
          return jsonResponse(201, { ...order, orderNo: 7, syncState: undefined });
        }
        return jsonResponse(201, {
          order: { ...order, orderNo: 7, status: "COMPLETED" },
          payment: {},
        });
      }),
    );

    await sync.drain();

    expect(calls).toEqual(["/api/orders", `/api/orders/${order.id}/payments`]);
    expect(await db.outbox.count()).toBe(0);
    const stored = await db.orders.get(order.id);
    expect(stored?.orderNo).toBe(7);
    expect(stored?.status).toBe("COMPLETED");
    expect(stored?.syncState).toBe("synced");
  });

  it("keeps ops queued on network failure", async () => {
    const order = localOrder("33333333-3333-4333-8333-333333333333");
    await db.orders.put(order);
    await db.outbox.add({ kind: "createOrder", orderId: order.id, payload: {} });

    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    await sync.drain();

    expect(await db.outbox.count()).toBe(1);
    expect((await db.orders.get(order.id))?.syncState).toBe("pending");
  });

  it("keeps ops queued on 5xx and retries later", async () => {
    const order = localOrder("44444444-4444-4444-8444-444444444444");
    await db.orders.put(order);
    await db.outbox.add({ kind: "createOrder", orderId: order.id, payload: {} });

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(503, { message: "down" })));
    await sync.drain();
    expect(await db.outbox.count()).toBe(1);

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(201, { ...order })));
    await sync.drain();
    expect(await db.outbox.count()).toBe(0);
    expect((await db.orders.get(order.id))?.syncState).toBe("synced");
  });

  it("drops 4xx-rejected ops, marks the order, and continues with the rest", async () => {
    const bad = localOrder("55555555-5555-4555-8555-555555555555");
    const good = localOrder("66666666-6666-4666-8666-666666666666");
    await db.orders.bulkPut([bad, good]);
    await db.outbox.add({ kind: "createOrder", orderId: bad.id, payload: { id: bad.id } });
    await db.outbox.add({ kind: "createOrder", orderId: good.id, payload: { id: good.id } });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}"));
        if (body.id === bad.id) {
          return jsonResponse(409, { message: "item sold out" });
        }
        return jsonResponse(201, { ...good, orderNo: 8 });
      }),
    );

    await sync.drain();

    expect(await db.outbox.count()).toBe(0);
    const storedBad = await db.orders.get(bad.id);
    expect(storedBad?.syncState).toBe("error");
    expect(storedBad?.syncError).toBe("item sold out");
    const storedGood = await db.orders.get(good.id);
    expect(storedGood?.syncState).toBe("synced");
    expect(storedGood?.orderNo).toBe(8);
  });
});
