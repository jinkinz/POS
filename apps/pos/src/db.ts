import Dexie, { type Table } from "dexie";
import type { LocalOrder } from "./types";

/** One queued offline mutation. Drained strictly in seq order. */
export interface OutboxOp {
  seq?: number;
  kind: "createOrder" | "addItems" | "pay";
  orderId: string;
  payload: unknown;
}

export interface KVEntry {
  key: string;
  value: unknown;
}

class PosDatabase extends Dexie {
  kv!: Table<KVEntry, string>;
  outbox!: Table<OutboxOp, number>;
  orders!: Table<LocalOrder, string>;

  constructor() {
    super("pos-terminal");
    this.version(1).stores({
      kv: "key",
      outbox: "++seq, orderId",
      orders: "id, status, openedAt",
    });
  }
}

export const db = new PosDatabase();

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const row = await db.kv.get(key);
  return row?.value as T | undefined;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await db.kv.put({ key, value });
}
