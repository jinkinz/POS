import { useCallback, useEffect, useMemo, useState } from "react";
import { computeOrderTotals, formatCents, type TotalsConfig } from "@pos/shared";

// ---------- types (customer-visible subset) ----------

interface QrSession {
  token: string;
  table: { id: string; name: string };
  outlet: { id: string; name: string; currency: "MYR" | "SGD" };
}

interface Modifier {
  id: string;
  name: string;
  priceDeltaCents: number;
  soldOut: boolean;
}
interface ModifierGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  modifiers: Modifier[];
}
interface Product {
  id: string;
  name: string;
  priceCents: number;
  soldOut: boolean;
  imageUrl: string | null;
  modifierGroups: ModifierGroup[];
}
interface Category {
  id: string;
  name: string;
  products: Product[];
}
interface MenuData {
  outlet: TotalsConfig & { name: string; currency: "MYR" | "SGD" };
  categories: Category[];
}

interface CartLine {
  key: string;
  productId: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
  modifiers: { id: string; name: string; priceDeltaCents: number }[];
  note: string;
}

interface PlacedItem {
  id: string;
  name: string;
  quantity: number;
  status: string;
  modifiers: { name: string }[];
}
interface PlacedOrder {
  id: string;
  orderNo: number | null;
  status: string;
  notes: string | null;
  totalCents: number;
  items: PlacedItem[];
}

async function api<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  const res = await fetch("/api" + path, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const m = Array.isArray((data as { message?: unknown }).message)
      ? (data as { message: string[] }).message.join(", ")
      : ((data as { message?: string }).message ?? res.statusText);
    throw new Error(m);
  }
  return data as T;
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Sent to kitchen",
  PREPARING: "Preparing",
  READY: "Ready",
  SERVED: "Served",
};

// ---------- app ----------

export default function App() {
  const qrToken = useMemo(
    () => new URLSearchParams(location.search).get("t") ?? "",
    [],
  );
  const [session, setSession] = useState<QrSession | null>(null);
  const [menu, setMenu] = useState<MenuData | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<"menu" | "orders">("menu");
  const [catId, setCatId] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [sheet, setSheet] = useState<Product | null>(null);
  const [showCart, setShowCart] = useState(false);
  const [orders, setOrders] = useState<PlacedOrder[]>([]);
  const [guestName, setGuestName] = useState("");
  const [placing, setPlacing] = useState(false);
  const [justPlaced, setJustPlaced] = useState<PlacedOrder | null>(null);

  useEffect(() => {
    if (!qrToken) {
      setError("This link is missing its table code. Please rescan the QR on your table.");
      return;
    }
    api<QrSession>("POST", "/qr/session", { qrToken })
      .then(async (s) => {
        setSession(s);
        const m = await api<MenuData>("GET", "/qr/menu", undefined, s.token);
        setMenu(m);
        setCatId(m.categories[0]?.id ?? null);
      })
      .catch(() =>
        setError("Could not start your table session. Please rescan the QR code."),
      );
  }, [qrToken]);

  const refreshOrders = useCallback(async () => {
    if (!session) return;
    try {
      setOrders(await api<PlacedOrder[]>("GET", "/qr/orders", undefined, session.token));
    } catch {
      /* keep last known */
    }
  }, [session]);

  useEffect(() => {
    if (view !== "orders") return;
    void refreshOrders();
    const t = setInterval(() => void refreshOrders(), 10_000);
    return () => clearInterval(t);
  }, [view, refreshOrders]);

  if (error) {
    return (
      <div className="splash">
        <h1>😕</h1>
        <p>{error}</p>
      </div>
    );
  }
  if (!session || !menu) {
    return (
      <div className="splash">
        <h1>🍜</h1>
        <p>Setting your table…</p>
      </div>
    );
  }

  const currency = session.outlet.currency;
  const fmt = (c: number) => formatCents(c, currency);
  const totals = computeOrderTotals(
    cart.map((l) => ({
      unitPriceCents: l.unitPriceCents,
      quantity: l.quantity,
      modifierDeltaCents: l.modifiers.reduce((s, m) => s + m.priceDeltaCents, 0),
    })),
    menu.outlet,
  );
  const cartCount = cart.reduce((s, l) => s + l.quantity, 0);
  const category = menu.categories.find((c) => c.id === catId);

  const addLine = (p: Product, mods: CartLine["modifiers"], qty: number, note: string) =>
    setCart((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        productId: p.id,
        name: p.name,
        unitPriceCents: p.priceCents,
        quantity: qty,
        modifiers: mods,
        note,
      },
    ]);

  const placeOrder = async () => {
    if (cart.length === 0 || placing) return;
    setPlacing(true);
    try {
      const placed = await api<PlacedOrder>(
        "POST",
        "/qr/orders",
        {
          id: crypto.randomUUID(),
          guestName: guestName.trim() || undefined,
          items: cart.map((l) => ({
            id: crypto.randomUUID(),
            productId: l.productId,
            quantity: l.quantity,
            modifierIds: l.modifiers.map((m) => m.id),
            notes: l.note || undefined,
          })),
        },
        session.token,
      );
      setCart([]);
      setShowCart(false);
      setJustPlaced(placed);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not place order");
    } finally {
      setPlacing(false);
    }
  };

  return (
    <div className="qr-app">
      <header>
        <div>
          <b>{session.outlet.name}</b>
          <span className="table-chip">Table {session.table.name}</span>
        </div>
        <nav>
          <button
            className={view === "menu" ? "active" : ""}
            onClick={() => setView("menu")}
          >
            Menu
          </button>
          <button
            className={view === "orders" ? "active" : ""}
            onClick={() => setView("orders")}
          >
            My orders
          </button>
        </nav>
      </header>

      {view === "menu" && (
        <>
          <div className="cats">
            {menu.categories.map((c) => (
              <button
                key={c.id}
                className={c.id === catId ? "active" : ""}
                onClick={() => setCatId(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>
          <main className="items">
            {category?.products.map((p) => (
              <button
                key={p.id}
                className="item-card"
                disabled={p.soldOut}
                onClick={() =>
                  p.modifierGroups.length > 0 ? setSheet(p) : addLine(p, [], 1, "")
                }
              >
                <div className="item-info">
                  <b>{p.name}</b>
                  <span>{fmt(p.priceCents)}</span>
                </div>
                <span className={`add ${p.soldOut ? "so" : ""}`}>
                  {p.soldOut ? "Sold out" : "+"}
                </span>
              </button>
            ))}
          </main>
          {cartCount > 0 && (
            <button className="cart-bar" onClick={() => setShowCart(true)}>
              <span className="count">{cartCount}</span>
              View order
              <span>{fmt(totals.totalCents)}</span>
            </button>
          )}
        </>
      )}

      {view === "orders" && (
        <main className="orders">
          {orders.length === 0 && <p className="dim">Nothing ordered yet.</p>}
          {orders.map((o) => (
            <div key={o.id} className="placed">
              <div className="placed-head">
                <b>Order {o.orderNo != null ? `#${o.orderNo}` : ""}</b>
                {o.notes && <span className="dim">{o.notes}</span>}
                <span>{fmt(o.totalCents)}</span>
              </div>
              {o.items.map((i) => (
                <div key={i.id} className="placed-item">
                  <span>
                    {i.quantity}× {i.name}
                    {i.modifiers.length > 0 && (
                      <small> · {i.modifiers.map((m) => m.name).join(", ")}</small>
                    )}
                  </span>
                  <span className={`st ${i.status.toLowerCase()}`}>
                    {STATUS_LABEL[i.status] ?? i.status}
                  </span>
                </div>
              ))}
            </div>
          ))}
          <p className="dim pay-note">Please pay at the counter when you're done. 🙏</p>
        </main>
      )}

      {sheet && (
        <ModifierSheet
          product={sheet}
          currency={currency}
          onClose={() => setSheet(null)}
          onAdd={(mods, qty, note) => {
            addLine(sheet, mods, qty, note);
            setSheet(null);
          }}
        />
      )}

      {showCart && (
        <div className="overlay" onClick={() => setShowCart(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h2>Your order · Table {session.table.name}</h2>
            {cart.map((l) => (
              <div key={l.key} className="cart-line">
                <span className="q">
                  <button onClick={() => setCart((p) => p.map((x) => x.key === l.key ? { ...x, quantity: x.quantity - 1 } : x).filter((x) => x.quantity > 0))}>−</button>
                  {l.quantity}
                  <button onClick={() => setCart((p) => p.map((x) => x.key === l.key ? { ...x, quantity: x.quantity + 1 } : x))}>+</button>
                </span>
                <span className="n">
                  {l.name}
                  {l.modifiers.length > 0 && <small>{l.modifiers.map((m) => m.name).join(", ")}</small>}
                  {l.note && <small>“{l.note}”</small>}
                </span>
                <span>{fmt((l.unitPriceCents + l.modifiers.reduce((s, m) => s + m.priceDeltaCents, 0)) * l.quantity)}</span>
              </div>
            ))}
            <div className="tot">
              <span>Subtotal</span>
              <span>{fmt(totals.subtotalCents)}</span>
            </div>
            {totals.serviceChargeCents > 0 && (
              <div className="tot">
                <span>Service charge</span>
                <span>{fmt(totals.serviceChargeCents)}</span>
              </div>
            )}
            {totals.taxCents > 0 && (
              <div className="tot">
                <span>Tax</span>
                <span>{fmt(totals.taxCents)}</span>
              </div>
            )}
            <div className="tot big">
              <span>Total</span>
              <span>{fmt(totals.totalCents)}</span>
            </div>
            <input
              placeholder="Your name (optional)"
              value={guestName}
              maxLength={40}
              onChange={(e) => setGuestName(e.target.value)}
            />
            <button className="cta" disabled={placing} onClick={() => void placeOrder()}>
              {placing ? "Sending…" : `Place order · ${fmt(totals.totalCents)}`}
            </button>
          </div>
        </div>
      )}

      {justPlaced && (
        <div className="overlay">
          <div className="sheet center">
            <h1>✅</h1>
            <h2>Order sent to the kitchen!</h2>
            <p className="dim">
              {justPlaced.orderNo != null ? `Order #${justPlaced.orderNo} · ` : ""}
              Track it under “My orders”. Pay at the counter when you're done.
            </p>
            <button
              className="cta"
              onClick={() => {
                setJustPlaced(null);
                setView("orders");
              }}
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- modifier bottom sheet ----------

function ModifierSheet({
  product,
  currency,
  onClose,
  onAdd,
}: {
  product: Product;
  currency: "MYR" | "SGD";
  onClose: () => void;
  onAdd: (mods: CartLine["modifiers"], qty: number, note: string) => void;
}) {
  const [chosen, setChosen] = useState<Map<string, Modifier & { groupId: string }>>(new Map());
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");

  const toggle = (g: ModifierGroup, m: Modifier) => {
    setChosen((prev) => {
      const next = new Map(prev);
      if (next.has(m.id)) {
        next.delete(m.id);
        return next;
      }
      const inGroup = [...next.values()].filter((c) => c.groupId === g.id);
      if (g.maxSelect === 1 && inGroup.length === 1) next.delete(inGroup[0]!.id);
      else if (inGroup.length >= g.maxSelect) return next;
      next.set(m.id, { ...m, groupId: g.id });
      return next;
    });
  };

  const valid = product.modifierGroups.every((g) => {
    const n = [...chosen.values()].filter((c) => c.groupId === g.id).length;
    return n >= g.minSelect && n <= g.maxSelect;
  });

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>{product.name}</h2>
        {product.modifierGroups.map((g) => (
          <div key={g.id} className="group">
            <h3>
              {g.name}
              {g.minSelect > 0 && <small> · required</small>}
            </h3>
            <div className="opts">
              {g.modifiers.map((m) => (
                <button
                  key={m.id}
                  disabled={m.soldOut}
                  className={chosen.has(m.id) ? "active" : ""}
                  onClick={() => toggle(g, m)}
                >
                  {m.name}
                  {m.priceDeltaCents !== 0 && (
                    <small> +{formatCents(m.priceDeltaCents, currency)}</small>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}
        <input
          placeholder="Note for the kitchen (optional)"
          value={note}
          maxLength={80}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="qty">
          <button onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
          <b>{qty}</b>
          <button onClick={() => setQty((q) => q + 1)}>+</button>
        </div>
        <button
          className="cta"
          disabled={!valid}
          onClick={() =>
            onAdd(
              [...chosen.values()].map((m) => ({
                id: m.id,
                name: m.name,
                priceDeltaCents: m.priceDeltaCents,
              })),
              qty,
              note.trim(),
            )
          }
        >
          Add to order
        </button>
      </div>
    </div>
  );
}
