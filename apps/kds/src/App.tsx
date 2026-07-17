import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { api } from "./api";
import type { Order, OrderItem, Session } from "./types";

const DEVICE_TOKEN_KEY = "kds.deviceToken";

export default function App() {
  const [deviceToken, setDeviceToken] = useState<string | null>(
    () => localStorage.getItem(DEVICE_TOKEN_KEY),
  );
  const [session, setSession] = useState<Session | null>(null);

  if (!deviceToken) {
    return (
      <SetupScreen
        onSave={(t) => {
          localStorage.setItem(DEVICE_TOKEN_KEY, t);
          setDeviceToken(t);
        }}
      />
    );
  }
  if (!session) {
    return (
      <PinScreen
        deviceToken={deviceToken}
        onSession={setSession}
        onResetDevice={() => {
          localStorage.removeItem(DEVICE_TOKEN_KEY);
          setDeviceToken(null);
        }}
      />
    );
  }
  return <KitchenScreen session={session} onLock={() => setSession(null)} />;
}

// ---------- setup: paste the device token issued at registration ----------

function SetupScreen({ onSave }: { onSave: (token: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="center-screen">
      <div className="card">
        <h1>Kitchen Display Setup</h1>
        <p>
          Register this screen in the back office (Devices → New → kind KDS)
          and paste the device token below. This is done once per screen.
        </p>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value.trim())}
          placeholder="device token"
        />
        <button
          className="btn primary"
          disabled={value.length < 32}
          onClick={() => onSave(value)}
        >
          Save device token
        </button>
      </div>
    </div>
  );
}

// ---------- PIN unlock ----------

function PinScreen({
  deviceToken,
  onSession,
  onResetDevice,
}: {
  deviceToken: string;
  onSession: (s: Session) => void;
  onResetDevice: () => void;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = useCallback(
    async (candidate: string) => {
      setBusy(true);
      setError("");
      try {
        const session = await api<Session>(
          "POST",
          "/auth/pin-login",
          { pin: candidate },
          undefined,
          { "X-Device-Token": deviceToken },
        );
        onSession(session);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Login failed");
        setPin("");
      } finally {
        setBusy(false);
      }
    },
    [deviceToken, onSession],
  );

  const press = (d: string) => {
    if (busy) return;
    const next = (pin + d).slice(0, 6);
    setPin(next);
    if (next.length >= 4 && d === "OK") return;
  };

  return (
    <div className="center-screen">
      <div className="card">
        <h1>Enter PIN</h1>
        <div className="pin-dots">{"●".repeat(pin.length).padEnd(6, "○")}</div>
        {error && <div className="error">{error}</div>}
        <div className="pinpad">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "OK"].map(
            (key) => (
              <button
                key={key}
                className={`btn ${key === "OK" ? "primary" : ""}`}
                disabled={busy || (key === "OK" && pin.length < 4)}
                onClick={() => {
                  if (key === "C") setPin("");
                  else if (key === "OK") void submit(pin);
                  else press(key);
                }}
              >
                {key}
              </button>
            ),
          )}
        </div>
        <button className="btn link" onClick={onResetDevice}>
          Re-pair device
        </button>
      </div>
    </div>
  );
}

// ---------- kitchen board ----------

const STATUS_ORDER = { PENDING: 0, PREPARING: 1, READY: 2 } as const;

function KitchenScreen({
  session,
  onLock,
}: {
  session: Session;
  onLock: () => void;
}) {
  const outletId = session.staff.outletId!;
  const [orders, setOrders] = useState<Map<string, Order>>(new Map());
  const [station, setStation] = useState<string>("ALL");
  const [connected, setConnected] = useState(false);
  const [toast, setToast] = useState("");
  const [, forceTick] = useState(0);
  const recallStack = useRef<{ orderId: string; itemIds: string[] }[]>([]);
  const socketRef = useRef<Socket | null>(null);

  const upsert = useCallback((order: Order) => {
    setOrders((prev) => {
      const next = new Map(prev);
      next.set(order.id, order);
      return next;
    });
  }, []);

  useEffect(() => {
    void api<Order[]>("GET", `/outlets/${outletId}/orders`, undefined, session.token).then(
      (list) => setOrders(new Map(list.map((o) => [o.id, o]))),
    );

    const socket = io("/rt", { auth: { token: session.token } });
    socketRef.current = socket;
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("order.created", upsert);
    socket.on("order.updated", upsert);
    socket.on("menu.sold_out", (p: { name: string; soldOut: boolean }) => {
      setToast(`${p.name} ${p.soldOut ? "SOLD OUT" : "back on menu"}`);
      setTimeout(() => setToast(""), 4000);
    });
    const timer = setInterval(() => forceTick((n) => n + 1), 10_000);
    return () => {
      socket.close();
      clearInterval(timer);
    };
  }, [outletId, session.token, upsert]);

  const activeItems = (o: Order): OrderItem[] =>
    o.items.filter(
      (i) =>
        i.status !== "VOIDED" &&
        i.status !== "SERVED" &&
        (station === "ALL" || i.station === station),
    );

  const tickets = useMemo(() => {
    return [...orders.values()]
      .filter((o) => o.status !== "VOIDED" && activeItems(o).length > 0)
      .sort((a, b) => a.openedAt.localeCompare(b.openedAt));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, station]);

  const stations = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders.values())
      for (const i of o.items) if (i.station) set.add(i.station);
    return ["ALL", ...[...set].sort()];
  }, [orders]);

  const allDay = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of orders.values()) {
      if (o.status === "VOIDED") continue;
      for (const i of o.items) {
        if (i.status === "PENDING" || i.status === "PREPARING") {
          counts.set(i.nameSnapshot, (counts.get(i.nameSnapshot) ?? 0) + i.quantity);
        }
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [orders]);

  const setStatus = async (orderId: string, itemIds: string[], status: string) => {
    const updated = await api<Order>(
      "POST",
      `/orders/${orderId}/items/status`,
      { itemIds, status },
      session.token,
    );
    upsert(updated);
  };

  const bump = async (order: Order) => {
    const ids = activeItems(order)
      .filter((i) => i.status !== "READY")
      .map((i) => i.id);
    const target = ids.length > 0 ? ids : activeItems(order).map((i) => i.id);
    const status = ids.length > 0 ? "READY" : "SERVED";
    await setStatus(order.id, target, status);
    if (status === "READY") {
      recallStack.current.push({ orderId: order.id, itemIds: target });
    }
  };

  const recall = async () => {
    const last = recallStack.current.pop();
    if (!last) return;
    await setStatus(last.orderId, last.itemIds, "PREPARING");
  };

  const start = async (order: Order) => {
    const ids = activeItems(order)
      .filter((i) => i.status === "PENDING")
      .map((i) => i.id);
    if (ids.length > 0) await setStatus(order.id, ids, "PREPARING");
  };

  return (
    <div className="kitchen">
      <header>
        <div className="brand">
          KDS · {session.staff.name}
          <span className={`dot ${connected ? "on" : "off"}`} />
        </div>
        <nav>
          {stations.map((s) => (
            <button
              key={s}
              className={`btn tab ${station === s ? "active" : ""}`}
              onClick={() => setStation(s)}
            >
              {s}
            </button>
          ))}
        </nav>
        <div className="header-actions">
          <button className="btn" onClick={recall}>
            ⟲ Recall
          </button>
          <button className="btn" onClick={onLock}>
            🔒 Lock
          </button>
        </div>
      </header>

      {allDay.length > 0 && (
        <div className="allday">
          {allDay.map(([name, qty]) => (
            <span key={name}>
              <b>{qty}</b> {name}
            </span>
          ))}
        </div>
      )}

      <main className="rail">
        {tickets.length === 0 && <div className="empty">No open tickets 🎉</div>}
        {tickets.map((order) => (
          <Ticket
            key={order.id}
            order={order}
            items={activeItems(order)}
            onStart={() => void start(order)}
            onBump={() => void bump(order)}
          />
        ))}
      </main>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function Ticket({
  order,
  items,
  onStart,
  onBump,
}: {
  order: Order;
  items: OrderItem[];
  onStart: () => void;
  onBump: () => void;
}) {
  const ageMin = Math.floor((Date.now() - Date.parse(order.openedAt)) / 60_000);
  const urgency = ageMin >= 10 ? "late" : ageMin >= 5 ? "warn" : "ok";
  const allReady = items.every((i) => i.status === "READY");
  const sorted = [...items].sort(
    (a, b) =>
      a.courseNo - b.courseNo ||
      STATUS_ORDER[a.status as keyof typeof STATUS_ORDER] -
        STATUS_ORDER[b.status as keyof typeof STATUS_ORDER],
  );

  return (
    <section className={`ticket ${urgency} ${allReady ? "ready" : ""}`}>
      <div className="ticket-head">
        <span className="no">#{order.orderNo ?? "—"}</span>
        <span className="meta">{order.type.replace("_", " ")}</span>
        <span className="age">{ageMin}m</span>
      </div>
      {order.notes && <div className="order-notes">“{order.notes}”</div>}
      <ul>
        {sorted.map((item) => (
          <li key={item.id} className={`item ${item.status.toLowerCase()}`}>
            <span className="qty">{item.quantity}×</span>
            <span className="name">
              {item.nameSnapshot}
              {item.modifiersJson.length > 0 && (
                <small>{item.modifiersJson.map((m) => m.name).join(", ")}</small>
              )}
              {item.notes && <small className="note">“{item.notes}”</small>}
            </span>
            <span className="state">{item.status === "READY" ? "✓" : ""}</span>
          </li>
        ))}
      </ul>
      <div className="ticket-actions">
        {sorted.some((i) => i.status === "PENDING") && (
          <button className="btn" onClick={onStart}>
            Start
          </button>
        )}
        <button className="btn primary" onClick={onBump}>
          {allReady ? "Serve" : "Bump"}
        </button>
      </div>
    </section>
  );
}
