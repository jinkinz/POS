import { useCallback, useEffect, useState } from "react";
import { formatCents } from "@pos/shared";
import { api } from "../api";
import type { Catalog, Outlet } from "../types";

interface StockRow {
  ingredientId: string;
  name: string;
  unit: string;
  costCents: string;
  onHandQty: string;
  lowThresholdQty: string | null;
  lowStock: boolean;
}

interface Movement {
  id: string;
  type: string;
  qtyDelta: string;
  reason: string | null;
  createdAt: string;
  ingredient: { name: string; unit: string };
}

interface RecipeLine {
  ingredientId: string;
  qty: string;
}

const UNITS = ["G", "ML", "PCS"];

export default function Inventory({ outlet }: { outlet: Outlet }) {
  const [tab, setTab] = useState<"stock" | "recipes" | "movements">("stock");
  const [stock, setStock] = useState<StockRow[]>([]);
  const [counting, setCounting] = useState<Record<string, string> | null>(null);

  const reload = useCallback(
    () => api<StockRow[]>("GET", `/admin/outlets/${outlet.id}/stock`).then(setStock),
    [outlet.id],
  );
  useEffect(() => {
    void reload();
  }, [reload]);

  const askNumber = (label: string): number | null => {
    const raw = prompt(label);
    if (!raw) return null;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : null;
  };

  const receive = async (row: StockRow) => {
    const qty = askNumber(`Receive how much ${row.name} (${row.unit})?`);
    if (qty == null || qty <= 0) return;
    await api("POST", `/admin/outlets/${outlet.id}/stock/receive`, {
      ingredientId: row.ingredientId,
      qty,
    });
    void reload();
  };

  const waste = async (row: StockRow) => {
    const qty = askNumber(`Waste how much ${row.name} (${row.unit})?`);
    if (qty == null || qty <= 0) return;
    const reason = prompt("Reason (e.g. spoiled, dropped)?");
    if (!reason) return;
    await api("POST", `/admin/outlets/${outlet.id}/stock/wastage`, {
      ingredientId: row.ingredientId,
      qty,
      reason,
    });
    void reload();
  };

  const adjust = async (row: StockRow) => {
    const qtyDelta = askNumber(
      `Adjust ${row.name} by how much (${row.unit}, negative to reduce)?`,
    );
    if (qtyDelta == null || qtyDelta === 0) return;
    const reason = prompt("Reason?");
    if (!reason) return;
    await api("POST", `/admin/outlets/${outlet.id}/stock/adjust`, {
      ingredientId: row.ingredientId,
      qtyDelta,
      reason,
    });
    void reload();
  };

  const setThreshold = async (row: StockRow) => {
    const qty = askNumber(`Low-stock alert threshold for ${row.name} (${row.unit})?`);
    if (qty == null) return;
    await api("POST", `/admin/outlets/${outlet.id}/stock/low-threshold`, {
      ingredientId: row.ingredientId,
      lowThresholdQty: qty,
    });
    void reload();
  };

  const addIngredient = async () => {
    const name = prompt("Ingredient name?");
    if (!name) return;
    const unit = (prompt("Unit — G, ML or PCS?") ?? "").toUpperCase();
    if (!UNITS.includes(unit)) {
      alert("Unit must be G, ML or PCS");
      return;
    }
    const cost = askNumber(`Cost in sen per ${unit} (e.g. 0.8)?`) ?? 0;
    await api("POST", "/admin/ingredients", { name, unit, costCents: cost });
    void reload();
  };

  const commitStocktake = async () => {
    if (!counting) return;
    const counts = Object.entries(counting)
      .filter(([, v]) => v !== "")
      .map(([ingredientId, v]) => ({ ingredientId, countedQty: parseFloat(v) }))
      .filter((c) => Number.isFinite(c.countedQty));
    if (counts.length === 0) {
      setCounting(null);
      return;
    }
    const res = await api<{ results: { ingredientId: string; varianceQty: string }[] }>(
      "POST",
      `/admin/outlets/${outlet.id}/stocktake`,
      { counts },
    );
    const lines = res.results
      .map((r) => {
        const row = stock.find((s) => s.ingredientId === r.ingredientId);
        return `${row?.name ?? r.ingredientId}: variance ${r.varianceQty} ${row?.unit ?? ""}`;
      })
      .join("\n");
    alert(`Stocktake committed.\n\n${lines}`);
    setCounting(null);
    void reload();
  };

  return (
    <div>
      <div className="page-head">
        <h1>Inventory · {outlet.name}</h1>
        <div className="row-actions">
          {["stock", "recipes", "movements"].map((t) => (
            <button
              key={t}
              className={`btn ${tab === t ? "primary" : ""}`}
              onClick={() => setTab(t as typeof tab)}
            >
              {t[0]!.toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {tab === "stock" && (
        <section className="panel">
          <div className="page-head">
            <h2>Stock on hand</h2>
            <div className="row-actions">
              <button className="btn" onClick={() => void addIngredient()}>
                + Ingredient
              </button>
              {counting ? (
                <>
                  <button className="btn" onClick={() => setCounting(null)}>
                    Cancel count
                  </button>
                  <button className="btn primary" onClick={() => void commitStocktake()}>
                    Commit stocktake
                  </button>
                </>
              ) : (
                <button className="btn" onClick={() => setCounting({})}>
                  🔢 Stocktake
                </button>
              )}
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Ingredient</th>
                <th>Unit</th>
                <th>Cost/unit</th>
                <th>On hand</th>
                <th>{counting ? "Counted" : "Alert below"}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {stock.map((row) => (
                <tr key={row.ingredientId}>
                  <td>
                    {row.name}{" "}
                    {row.lowStock && <span className="chip warn">LOW</span>}
                  </td>
                  <td className="dim">{row.unit}</td>
                  <td className="num dim">{parseFloat(row.costCents).toFixed(2)}¢</td>
                  <td className="num">
                    <b>{parseFloat(row.onHandQty).toLocaleString()}</b>
                  </td>
                  <td className="num">
                    {counting ? (
                      <input
                        style={{ width: 90 }}
                        inputMode="decimal"
                        placeholder={parseFloat(row.onHandQty).toString()}
                        value={counting[row.ingredientId] ?? ""}
                        onChange={(e) =>
                          setCounting({ ...counting, [row.ingredientId]: e.target.value })
                        }
                      />
                    ) : (
                      <button className="btn small" onClick={() => void setThreshold(row)}>
                        {row.lowThresholdQty
                          ? parseFloat(row.lowThresholdQty).toLocaleString()
                          : "set"}
                      </button>
                    )}
                  </td>
                  <td>
                    {!counting && (
                      <span className="row-actions">
                        <button className="btn small" onClick={() => void receive(row)}>
                          Receive
                        </button>
                        <button className="btn small" onClick={() => void adjust(row)}>
                          Adjust
                        </button>
                        <button className="btn small" onClick={() => void waste(row)}>
                          Waste
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {stock.length === 0 && <p className="dim">No ingredients yet — add one.</p>}
        </section>
      )}

      {tab === "recipes" && <RecipeEditor stock={stock} />}
      {tab === "movements" && <Movements outletId={outlet.id} />}
    </div>
  );
}

// ---------- recipes ----------

function RecipeEditor({ stock }: { stock: StockRow[] }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [productId, setProductId] = useState("");
  const [lines, setLines] = useState<RecipeLine[]>([]);
  const [cost, setCost] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void api<Catalog>("GET", "/admin/catalog").then(setCatalog);
  }, []);

  useEffect(() => {
    if (!productId) return;
    setSaved(false);
    void api<{ items: { ingredientId: string; qty: string }[]; theoreticalCostCents: string }>(
      "GET",
      `/admin/products/${productId}/recipe`,
    ).then((r) => {
      setLines(r.items.map((i) => ({ ingredientId: i.ingredientId, qty: String(parseFloat(i.qty)) })));
      setCost(r.theoreticalCostCents);
    });
  }, [productId]);

  const save = async () => {
    const items = lines
      .filter((l) => l.ingredientId && parseFloat(l.qty) > 0)
      .map((l) => ({ ingredientId: l.ingredientId, qty: parseFloat(l.qty) }));
    const r = await api<{ theoreticalCostCents: string }>(
      "PUT",
      `/admin/products/${productId}/recipe`,
      { items },
    );
    setCost(r.theoreticalCostCents);
    setSaved(true);
  };

  const product = catalog?.products.find((p) => p.id === productId);

  return (
    <section className="panel">
      <h2>Product recipes (BOM)</h2>
      <p className="dim">
        Each sale automatically deducts these quantities from stock — including
        modifier add-ons if you give modifiers their own recipes via the API.
      </p>
      <div className="two-col" style={{ maxWidth: 560, marginTop: 10 }}>
        <select value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">Choose product…</option>
          {catalog?.products
            .filter((p) => p.active)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
      </div>

      {productId && (
        <div style={{ marginTop: 14, maxWidth: 560 }}>
          {lines.map((line, idx) => (
            <div key={idx} className="two-col" style={{ marginBottom: 8 }}>
              <select
                value={line.ingredientId}
                onChange={(e) => {
                  const next = [...lines];
                  next[idx] = { ...line, ingredientId: e.target.value };
                  setLines(next);
                }}
              >
                <option value="">Ingredient…</option>
                {stock.map((s) => (
                  <option key={s.ingredientId} value={s.ingredientId}>
                    {s.name} ({s.unit})
                  </option>
                ))}
              </select>
              <input
                inputMode="decimal"
                placeholder="qty"
                value={line.qty}
                onChange={(e) => {
                  const next = [...lines];
                  next[idx] = { ...line, qty: e.target.value };
                  setLines(next);
                }}
              />
            </div>
          ))}
          <div className="row-actions" style={{ marginTop: 8 }}>
            <button
              className="btn"
              onClick={() => setLines([...lines, { ingredientId: "", qty: "" }])}
            >
              + Line
            </button>
            <button className="btn primary" onClick={() => void save()}>
              Save recipe
            </button>
          </div>
          {cost != null && product && (
            <p style={{ marginTop: 10 }}>
              Theoretical cost: <b>{formatCents(Math.round(parseFloat(cost)), "MYR")}</b>{" "}
              · Price {formatCents(product.basePriceCents, "MYR")} · Margin{" "}
              <b>
                {product.basePriceCents > 0
                  ? Math.round(
                      (1 - parseFloat(cost) / product.basePriceCents) * 100,
                    )
                  : 0}
                %
              </b>
              {saved && <span className="chip ok" style={{ marginLeft: 8 }}>saved</span>}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

// ---------- movements ledger ----------

function Movements({ outletId }: { outletId: string }) {
  const [rows, setRows] = useState<Movement[]>([]);

  useEffect(() => {
    void api<Movement[]>("GET", `/admin/outlets/${outletId}/stock/movements?days=7`).then(
      setRows,
    );
  }, [outletId]);

  return (
    <section className="panel">
      <h2>Movements (7 days)</h2>
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Ingredient</th>
            <th>Type</th>
            <th>Qty</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id}>
              <td className="dim">{new Date(m.createdAt).toLocaleString()}</td>
              <td>{m.ingredient.name}</td>
              <td className="dim">{m.type.replace("_", " ")}</td>
              <td className={`num ${parseFloat(m.qtyDelta) < 0 ? "" : "dim"}`}>
                {parseFloat(m.qtyDelta) > 0 ? "+" : ""}
                {parseFloat(m.qtyDelta).toLocaleString()} {m.ingredient.unit}
              </td>
              <td className="dim">{m.reason ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="dim">No movements in the last 7 days.</p>}
    </section>
  );
}
