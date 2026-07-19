import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { computeOrderTotals, formatCents } from "@pos/shared";
import { api } from "./api";
import { db, kvGet, kvSet } from "./db";
import {
  addItemsToOrder,
  applyServerOrder,
  cartLineInput,
  createOrder,
  remainingCents,
  totalsConfig,
} from "./store";
import ClockDialog from "./Clock";
import MemberDialog from "./Member";
import ShiftDialog from "./Shift";
import { sync } from "./sync";
import TenderDialog from "./Tender";
import type {
  CartLine,
  ChosenModifier,
  DiningTable,
  LocalOrder,
  MemberSummary,
  MenuData,
  Order,
  OrderType,
  Product,
  Session,
} from "./types";

export default function SellScreen({
  session,
  onLock,
}: {
  session: Session;
  onLock: () => void;
}) {
  const outletId = session.staff.outletId!;
  const [menu, setMenu] = useState<MenuData | null>(null);
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [catId, setCatId] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<OrderType>("DINE_IN");
  const [tableId, setTableId] = useState<string | undefined>();
  const [modifierProduct, setModifierProduct] = useState<Product | null>(null);
  const [search, setSearch] = useState("");
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [showOrders, setShowOrders] = useState(false);
  const [showTables, setShowTables] = useState(false);
  const [tenderOrderId, setTenderOrderId] = useState<string | null>(null);
  const [showShift, setShowShift] = useState(false);
  const [member, setMember] = useState<MemberSummary | null>(null);
  const [showMember, setShowMember] = useState(false);
  const [showClock, setShowClock] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [pendingOps, setPendingOps] = useState(0);
  const [toast, setToast] = useState("");

  const openOrders = useLiveQuery(
    () => db.orders.where("status").equals("OPEN").toArray(),
    [],
    [] as LocalOrder[],
  );
  const activeOrder = useLiveQuery(
    () => (activeOrderId ? db.orders.get(activeOrderId) : undefined),
    [activeOrderId],
  );

  const say = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }, []);

  const refreshPending = useCallback(() => {
    void sync.pendingCount().then(setPendingOps);
  }, []);

  useEffect(() => {
    const menuKey = `menu:${outletId}`;
    const tablesKey = `tables:${outletId}`;

    // Cache-first so the terminal works offline from the second launch on.
    void kvGet<MenuData>(menuKey).then((cached) => {
      if (cached) {
        setMenu(cached);
        setCatId((c) => c ?? cached.categories[0]?.id ?? null);
      }
    });
    void kvGet<DiningTable[]>(tablesKey).then((cached) => {
      if (cached) setTables(cached);
    });
    void api<MenuData>("GET", `/outlets/${outletId}/menu`, undefined, session.token)
      .then((fresh) => {
        setMenu(fresh);
        setCatId((c) => c ?? fresh.categories[0]?.id ?? null);
        void kvSet(menuKey, fresh);
      })
      .catch(() => {});
    void api<DiningTable[]>("GET", `/outlets/${outletId}/tables`, undefined, session.token)
      .then((fresh) => {
        setTables(fresh);
        void kvSet(tablesKey, fresh);
      })
      .catch(() => {});
    void api<Order[]>("GET", `/outlets/${outletId}/orders?status=OPEN`, undefined, session.token)
      .then(async (list) => {
        for (const o of list) await applyServerOrder(o);
      })
      .catch(() => {});

    sync.start(session.token);
    const unsub = sync.onChange(refreshPending);
    refreshPending();

    const socket = io("/rt", { auth: { token: session.token } });
    const onOrder = (o: Order) => void applyServerOrder(o);
    socket.on("order.created", onOrder);
    socket.on("order.updated", onOrder);
    socket.on(
      "menu.sold_out",
      (p: { productId: string; name: string; soldOut: boolean }) => {
        setMenu((m) => {
          if (!m) return m;
          const next: MenuData = {
            ...m,
            categories: m.categories.map((c) => ({
              ...c,
              products: c.products.map((prod) =>
                prod.id === p.productId ? { ...prod, soldOut: p.soldOut } : prod,
              ),
            })),
          };
          void kvSet(menuKey, next);
          return next;
        });
        say(`${p.name} ${p.soldOut ? "SOLD OUT" : "back on menu"}`);
      },
    );

    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      socket.close();
      sync.stop();
      unsub();
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [outletId, session.token, refreshPending, say]);

  const category = menu?.categories.find((c) => c.id === catId) ?? null;
  const allProducts = useMemo(
    () => (menu ? menu.categories.flatMap((c) => c.products) : []),
    [menu],
  );
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    return allProducts
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.sku ?? "").toLowerCase() === q,
      )
      .slice(0, 30);
  }, [search, allProducts]);

  /** Barcode scanners type the code and send Enter — exact SKU adds instantly. */
  const scanSubmit = () => {
    const q = search.trim().toLowerCase();
    if (!q) return;
    const exact = allProducts.find((p) => (p.sku ?? "").toLowerCase() === q);
    if (exact && !exact.soldOut) {
      addLine(exact, [], 1, "");
      setSearch("");
    }
  };

  const addLine = (
    product: Product,
    modifiers: ChosenModifier[],
    quantity: number,
    note: string,
  ) => {
    setCart((prev) => {
      if (modifiers.length === 0 && !note) {
        const idx = prev.findIndex(
          (l) => l.productId === product.id && l.modifiers.length === 0 && !l.note,
        );
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx]!, quantity: next[idx]!.quantity + quantity };
          return next;
        }
      }
      return [
        ...prev,
        {
          key: crypto.randomUUID(),
          productId: product.id,
          name: product.name,
          unitPriceCents: product.priceCents,
          quantity,
          modifiers,
          note,
        },
      ];
    });
  };

  const tapProduct = (product: Product) => {
    if (product.soldOut) return;
    if (product.modifierGroups.length > 0) setModifierProduct(product);
    else addLine(product, [], 1, "");
  };

  const totals = useMemo(() => {
    if (!menu) return null;
    return computeOrderTotals(cart.map(cartLineInput), totalsConfig(menu.outlet));
  }, [cart, menu]);

  const send = async (thenPay: boolean) => {
    if (!menu || cart.length === 0) return;
    if (activeOrder) {
      const updated = await addItemsToOrder(activeOrder, menu.outlet, cart);
      setCart([]);
      say(`Added to order ${orderLabel(updated)}`);
      if (thenPay) setTenderOrderId(updated.id);
      return;
    }
    const order = await createOrder({
      outlet: menu.outlet,
      type: orderType,
      tableId: orderType === "DINE_IN" ? tableId : undefined,
      staffId: session.staff.id,
      memberId: member?.id,
      lines: cart,
    });
    setCart([]);
    setTableId(undefined);
    setMember(null);
    if (thenPay) setTenderOrderId(order.id);
    else say(`Sent ${orderLabel(order)}`);
  };

  const occupiedTables = useMemo(() => {
    const set = new Set<string>();
    for (const o of openOrders) if (o.tableId) set.add(o.tableId);
    return set;
  }, [openOrders]);

  if (!menu) {
    return (
      <div className="center-screen">
        <div className="card">
          <h1>Loading menu…</h1>
          <p>First launch needs a connection to cache the menu.</p>
        </div>
      </div>
    );
  }

  const currency = menu.outlet.currency;
  const fmt = (c: number) => formatCents(c, currency);

  return (
    <div className="pos">
      <header>
        <div className="brand">
          {menu.outlet.name} · {session.staff.name}
          <span className={`dot ${online ? "on" : "off"}`} />
          {pendingOps > 0 && <span className="badge">{pendingOps} unsynced</span>}
        </div>
        <div className="header-actions">
          <button className="btn" onClick={() => setShowOrders(true)}>
            Orders ({openOrders.length})
          </button>
          <button className="btn" disabled={!online} onClick={() => setShowShift(true)}>
            💰
          </button>
          <button className="btn" disabled={!online} onClick={() => setShowClock(true)}>
            🕐
          </button>
          <button className="btn" onClick={onLock}>
            🔒
          </button>
        </div>
      </header>

      <div className="pos-body">
        <div className="menu-side">
          <nav className="cats">
            <input
              className="scan-box"
              placeholder="🔍 Search / scan barcode"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") scanSubmit();
              }}
            />
            {menu.categories.map((c) => (
              <button
                key={c.id}
                className={`btn tab ${c.id === catId ? "active" : ""}`}
                onClick={() => setCatId(c.id)}
              >
                {c.name}
              </button>
            ))}
          </nav>
          <div className="grid">
            {(searchResults ?? category?.products ?? []).map((p) => (
              <button
                key={p.id}
                className={`tile ${p.soldOut ? "soldout" : ""}`}
                onClick={() => tapProduct(p)}
              >
                <span className="tile-name">{p.name}</span>
                <span className="tile-price">{fmt(p.priceCents)}</span>
                {p.soldOut && <span className="tile-86">SOLD OUT</span>}
              </button>
            ))}
          </div>
        </div>

        <aside className="cart-side">
          {activeOrder ? (
            <div className="cart-head">
              <b>Order {orderLabel(activeOrder)}</b>
              <button className="btn" onClick={() => setShowMember(true)}>
                {activeOrder.memberId ? "⭐" : "☆"}
              </button>
              <button
                className="btn link"
                onClick={() => {
                  setActiveOrderId(null);
                  setCart([]);
                }}
              >
                ← New sale
              </button>
            </div>
          ) : (
            <div className="cart-head">
              <div className="order-type">
                {(["DINE_IN", "TAKEAWAY"] as OrderType[]).map((t) => (
                  <button
                    key={t}
                    className={`btn tab ${orderType === t ? "active" : ""}`}
                    onClick={() => setOrderType(t)}
                  >
                    {t === "DINE_IN" ? "Dine-in" : "Takeaway"}
                  </button>
                ))}
              </div>
              {orderType === "DINE_IN" && (
                <button className="btn" onClick={() => setShowTables(true)}>
                  {tableId
                    ? `Table ${tables.find((t) => t.id === tableId)?.name ?? ""}`
                    : "Select table"}
                </button>
              )}
              <button className="btn" onClick={() => setShowMember(true)}>
                {member ? `⭐ ${member.name ?? member.phone}` : "☆ Member"}
              </button>
            </div>
          )}

          <div className="cart-lines">
            {activeOrder &&
              activeOrder.items
                .filter((i) => i.status !== "VOIDED")
                .map((i) => (
                  <div key={i.id} className="line existing">
                    <span className="qty">{i.quantity}×</span>
                    <span className="name">
                      {i.nameSnapshot}
                      {i.modifiersJson.length > 0 && (
                        <small>{i.modifiersJson.map((m) => m.name).join(", ")}</small>
                      )}
                    </span>
                    <span className="amt">
                      {fmt(
                        (i.unitPriceCents +
                          i.modifiersJson.reduce((s, m) => s + m.priceDeltaCents, 0)) *
                          i.quantity,
                      )}
                    </span>
                  </div>
                ))}
            {cart.map((line) => (
              <div key={line.key} className="line">
                <span className="qty">
                  <button
                    className="mini"
                    onClick={() =>
                      setCart((prev) =>
                        prev
                          .map((l) =>
                            l.key === line.key ? { ...l, quantity: l.quantity - 1 } : l,
                          )
                          .filter((l) => l.quantity > 0),
                      )
                    }
                  >
                    −
                  </button>
                  {line.quantity}
                  <button
                    className="mini"
                    onClick={() =>
                      setCart((prev) =>
                        prev.map((l) =>
                          l.key === line.key ? { ...l, quantity: l.quantity + 1 } : l,
                        ),
                      )
                    }
                  >
                    +
                  </button>
                </span>
                <span className="name">
                  {line.name}
                  {line.modifiers.length > 0 && (
                    <small>{line.modifiers.map((m) => m.name).join(", ")}</small>
                  )}
                  {line.note && <small className="note">“{line.note}”</small>}
                </span>
                <span className="amt">
                  {fmt(
                    (line.unitPriceCents +
                      line.modifiers.reduce((s, m) => s + m.priceDeltaCents, 0)) *
                      line.quantity,
                  )}
                </span>
              </div>
            ))}
            {cart.length === 0 && !activeOrder && (
              <div className="empty">Tap products to add</div>
            )}
          </div>

          <div className="cart-totals">
            {activeOrder && cart.length === 0 ? (
              <>
                <Row label="Subtotal" value={fmt(activeOrder.subtotalCents)} />
                {activeOrder.discountCents > 0 && (
                  <Row
                    label={`Voucher ${activeOrder.voucherCode ?? ""}`}
                    value={`−${fmt(activeOrder.discountCents)}`}
                  />
                )}
                {activeOrder.serviceChargeCents > 0 && (
                  <Row label="Service charge" value={fmt(activeOrder.serviceChargeCents)} />
                )}
                {activeOrder.taxCents > 0 && (
                  <Row label="Tax" value={fmt(activeOrder.taxCents)} />
                )}
                <Row big label="Due" value={fmt(remainingCents(activeOrder))} />
              </>
            ) : (
              totals && (
                <>
                  <Row label="Subtotal" value={fmt(totals.subtotalCents)} />
                  {totals.serviceChargeCents > 0 && (
                    <Row label="Service charge" value={fmt(totals.serviceChargeCents)} />
                  )}
                  {totals.taxCents > 0 && <Row label="Tax" value={fmt(totals.taxCents)} />}
                  <Row big label="Total" value={fmt(totals.totalCents)} />
                </>
              )
            )}
          </div>

          <div className="cart-actions">
            {activeOrder ? (
              <>
                {cart.length > 0 && (
                  <button className="btn" onClick={() => void send(false)}>
                    Add to order
                  </button>
                )}
                <button
                  className="btn primary"
                  onClick={() => {
                    if (cart.length > 0) void send(true);
                    else setTenderOrderId(activeOrder.id);
                  }}
                >
                  Pay
                </button>
              </>
            ) : (
              <>
                <button
                  className="btn"
                  disabled={cart.length === 0}
                  onClick={() => void send(false)}
                >
                  Send
                </button>
                <button
                  className="btn primary"
                  disabled={cart.length === 0}
                  onClick={() => void send(true)}
                >
                  Pay
                </button>
              </>
            )}
          </div>
        </aside>
      </div>

      {modifierProduct && (
        <ModifierDialog
          product={modifierProduct}
          currency={currency}
          onCancel={() => setModifierProduct(null)}
          onAdd={(mods, qty, note) => {
            addLine(modifierProduct, mods, qty, note);
            setModifierProduct(null);
          }}
        />
      )}

      {showTables && (
        <div className="overlay" onClick={() => setShowTables(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h2>Select table</h2>
            <div className="table-grid">
              {tables.map((t) => (
                <button
                  key={t.id}
                  className={`tile ${occupiedTables.has(t.id) ? "occupied" : ""}`}
                  onClick={() => {
                    setTableId(t.id);
                    setShowTables(false);
                  }}
                >
                  <span className="tile-name">{t.name}</span>
                  <span className="tile-price">
                    {t.zone ?? ""} {occupiedTables.has(t.id) ? "· occupied" : ""}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {showOrders && (
        <div className="overlay" onClick={() => setShowOrders(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h2>Open orders</h2>
            {openOrders.length === 0 && <p className="empty">No open orders</p>}
            {[...openOrders]
              .sort((a, b) => b.openedAt.localeCompare(a.openedAt))
              .map((o) => (
                <button
                  key={o.id}
                  className="order-row"
                  onClick={() => {
                    setActiveOrderId(o.id);
                    setCart([]);
                    setShowOrders(false);
                  }}
                >
                  <b>{orderLabel(o)}</b>
                  <span>
                    {o.type === "DINE_IN"
                      ? `Table ${tables.find((t) => t.id === o.tableId)?.name ?? "—"}`
                      : o.type}
                  </span>
                  <span className={`sync ${o.syncState}`}>
                    {o.syncState === "pending" ? "⏳" : o.syncState === "error" ? "⚠️" : ""}
                  </span>
                  <span className="amt">{fmt(o.totalCents)}</span>
                </button>
              ))}
          </div>
        </div>
      )}

      {tenderOrderId && (
        <TenderDialog
          orderId={tenderOrderId}
          outlet={menu.outlet}
          online={online}
          token={session.token}
          onClose={(completed) => {
            setTenderOrderId(null);
            if (completed) {
              setActiveOrderId(null);
              say("Payment complete");
            }
          }}
        />
      )}

      {showShift && (
        <ShiftDialog
          session={session}
          currency={currency}
          onClose={() => setShowShift(false)}
        />
      )}

      {showClock && (
        <ClockDialog session={session} onClose={() => setShowClock(false)} />
      )}

      {showMember && (
        <MemberDialog
          token={session.token}
          online={online}
          onSelect={async (m) => {
            if (activeOrder) {
              const updated = await api<Order>(
                "POST",
                `/orders/${activeOrder.id}/member`,
                { memberId: m.id },
                session.token,
              );
              await applyServerOrder(updated);
              say(`Member attached to ${orderLabel(activeOrder)}`);
            } else {
              setMember(m);
            }
            setShowMember(false);
          }}
          onClose={() => setShowMember(false)}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function Row({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className={`trow ${big ? "big" : ""}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

export function orderLabel(o: LocalOrder): string {
  return o.orderNo != null ? `#${o.orderNo}` : `L-${o.localNo ?? "?"}`;
}

// ---------- modifier picker ----------

function ModifierDialog({
  product,
  currency,
  onCancel,
  onAdd,
}: {
  product: Product;
  currency: "MYR" | "SGD";
  onCancel: () => void;
  onAdd: (mods: ChosenModifier[], qty: number, note: string) => void;
}) {
  const [chosen, setChosen] = useState<Map<string, ChosenModifier>>(new Map());
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");

  const toggle = (groupName: string, maxSelect: number, groupId: string, m: Product["modifierGroups"][number]["modifiers"][number]) => {
    setChosen((prev) => {
      const next = new Map(prev);
      if (next.has(m.id)) {
        next.delete(m.id);
        return next;
      }
      const group = product.modifierGroups.find((g) => g.id === groupId)!;
      const inGroup = [...next.values()].filter((c) =>
        group.modifiers.some((gm) => gm.id === c.id),
      );
      if (maxSelect === 1 && inGroup.length === 1) {
        next.delete(inGroup[0]!.id);
      } else if (inGroup.length >= maxSelect) {
        return next;
      }
      next.set(m.id, {
        id: m.id,
        name: m.name,
        priceDeltaCents: m.priceDeltaCents,
        groupName,
      });
      return next;
    });
  };

  const valid = product.modifierGroups.every((g) => {
    const count = [...chosen.values()].filter((c) =>
      g.modifiers.some((m) => m.id === c.id),
    ).length;
    return count >= g.minSelect && count <= g.maxSelect;
  });

  return (
    <div className="overlay" onClick={onCancel}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>{product.name}</h2>
        {product.modifierGroups.map((g) => (
          <div key={g.id} className="mod-group">
            <h3>
              {g.name}
              <small>
                {g.minSelect > 0 ? ` (choose ${g.minSelect}–${g.maxSelect})` : ""}
              </small>
            </h3>
            <div className="mod-options">
              {g.modifiers.map((m) => (
                <button
                  key={m.id}
                  disabled={m.soldOut}
                  className={`btn opt ${chosen.has(m.id) ? "active" : ""}`}
                  onClick={() => toggle(g.name, g.maxSelect, g.id, m)}
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
          placeholder="Note (e.g. no onions)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="qty-row">
          <button className="btn" onClick={() => setQty((q) => Math.max(1, q - 1))}>
            −
          </button>
          <b>{qty}</b>
          <button className="btn" onClick={() => setQty((q) => q + 1)}>
            +
          </button>
        </div>
        <div className="sheet-actions">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!valid}
            onClick={() => onAdd([...chosen.values()], qty, note.trim())}
          >
            Add {qty}
          </button>
        </div>
      </div>
    </div>
  );
}
