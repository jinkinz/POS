import { api, ApiError } from "./api";
import { db, type OutboxOp } from "./db";
import type { Order } from "./types";

/**
 * Drains the outbox FIFO against the API. Every op carries a client-generated
 * UUID, and the API is idempotent on those ids, so a request that succeeded
 * but never got its response (crash, dropped connection) is safe to replay.
 *
 * 4xx = the server permanently rejected the op (validation, business rule):
 * drop it and mark the order so staff see something is wrong. Network errors
 * and 5xx = try again later, order untouched.
 */
class SyncEngine {
  private token: string | null = null;
  private draining = false;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | undefined;

  /** Set credentials without wiring browser listeners (used by tests). */
  configure(token: string | null) {
    this.token = token;
  }

  start(token: string) {
    this.token = token;
    window.addEventListener("online", this.kick);
    this.timer = setInterval(this.kick, 5000);
    this.kick();
  }

  stop() {
    this.token = null;
    window.removeEventListener("online", this.kick);
    if (this.timer) clearInterval(this.timer);
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  kick = () => {
    void this.drain();
  };

  async pendingCount(): Promise<number> {
    return db.outbox.count();
  }

  async drain(): Promise<void> {
    if (!this.token || this.draining) return;
    // Explicit false check: some runtimes expose navigator without onLine.
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    this.draining = true;
    try {
      for (;;) {
        const op = await db.outbox.orderBy("seq").first();
        if (!op) break;
        try {
          const order = await this.push(op);
          await db.orders.put({ ...order, syncState: "synced" });
          await db.outbox.delete(op.seq!);
          this.emit();
        } catch (e) {
          if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
            const existing = await db.orders.get(op.orderId);
            if (existing) {
              await db.orders.put({
                ...existing,
                syncState: "error",
                syncError: e.message,
              });
            }
            await db.outbox.delete(op.seq!);
            this.emit();
            continue;
          }
          break; // offline or server trouble — retry on next kick
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private async push(op: OutboxOp): Promise<Order> {
    switch (op.kind) {
      case "createOrder":
        return api<Order>("POST", "/orders", op.payload, this.token!);
      case "addItems":
        return api<Order>(
          "POST",
          `/orders/${op.orderId}/items`,
          op.payload,
          this.token!,
        );
      case "pay": {
        const result = await api<{ order: Order }>(
          "POST",
          `/orders/${op.orderId}/payments`,
          op.payload,
          this.token!,
        );
        return result.order;
      }
    }
  }
}

export const sync = new SyncEngine();
