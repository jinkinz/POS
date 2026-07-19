import { useCallback, useEffect, useState } from "react";
import { formatCents } from "@pos/shared";
import { api } from "../api";
import type { Catalog, Consignor, ModifierGroup, Product } from "../types";

const fmt = (c: number) => formatCents(c, "MYR");

export default function MenuPage() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [groupEditing, setGroupEditing] = useState<ModifierGroup | "new" | null>(null);

  const reload = useCallback(
    () => api<Catalog>("GET", "/admin/catalog").then(setCatalog),
    [],
  );
  useEffect(() => {
    void reload();
  }, [reload]);

  if (!catalog) return <p className="dim">Loading…</p>;
  const catName = (id: string | null) =>
    catalog.categories.find((c) => c.id === id)?.name ?? "—";

  return (
    <div>
      <div className="page-head">
        <h1>Menu</h1>
        <div className="row-actions">
          <button
            className="btn"
            onClick={async () => {
              const name = prompt("New category name?");
              if (!name) return;
              await api("POST", "/admin/categories", { name });
              void reload();
            }}
          >
            + Category
          </button>
          <button className="btn" onClick={() => setGroupEditing("new")}>
            + Modifier group
          </button>
          <button className="btn primary" onClick={() => setEditing("new")}>
            + Product
          </button>
        </div>
      </div>

      <section className="panel">
        <h2>Products</h2>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Category</th>
              <th>Price</th>
              <th>Station</th>
              <th>Modifiers</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {catalog.products.map((p) => (
              <tr key={p.id} className={p.active ? "" : "inactive"}>
                <td>{p.name}</td>
                <td className="dim">{catName(p.categoryId)}</td>
                <td className="num">{fmt(p.basePriceCents)}</td>
                <td className="dim">{p.kitchenStation ?? "—"}</td>
                <td className="dim">
                  {p.modifierGroupIds
                    .map((id) => catalog.modifierGroups.find((g) => g.id === id)?.name)
                    .filter(Boolean)
                    .join(", ") || "—"}
                </td>
                <td>
                  <button
                    className={`chip ${p.soldOut ? "warn" : "ok"}`}
                    title="Toggle sold out"
                    onClick={async () => {
                      await api("PATCH", `/admin/products/${p.id}`, {
                        soldOut: !p.soldOut,
                      });
                      void reload();
                    }}
                  >
                    {p.soldOut ? "Sold out" : "Available"}
                  </button>
                  {!p.active && <span className="chip">inactive</span>}
                </td>
                <td>
                  <button className="btn small" onClick={() => setEditing(p)}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Modifier groups</h2>
        <div className="group-cards">
          {catalog.modifierGroups.map((g) => (
            <div key={g.id} className="group-card">
              <div className="group-head">
                <b>{g.name}</b>
                <span className="dim">
                  choose {g.minSelect}–{g.maxSelect}
                </span>
                <button className="btn small" onClick={() => setGroupEditing(g)}>
                  Edit
                </button>
              </div>
              <div className="dim">
                {g.modifiers
                  .map(
                    (m) =>
                      m.name +
                      (m.priceDeltaCents ? ` (+${fmt(m.priceDeltaCents)})` : ""),
                  )
                  .join(" · ") || "no options yet"}
              </div>
            </div>
          ))}
        </div>
      </section>

      {editing && (
        <ProductDialog
          product={editing === "new" ? null : editing}
          catalog={catalog}
          onClose={() => {
            setEditing(null);
            void reload();
          }}
        />
      )}
      {groupEditing && (
        <GroupDialog
          group={groupEditing === "new" ? null : groupEditing}
          onClose={() => {
            setGroupEditing(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}

// ---------- product editor ----------

function ProductDialog({
  product,
  catalog,
  onClose,
}: {
  product: Product | null;
  catalog: Catalog;
  onClose: () => void;
}) {
  const [name, setName] = useState(product?.name ?? "");
  const [price, setPrice] = useState(
    product ? (product.basePriceCents / 100).toFixed(2) : "",
  );
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? "");
  const [station, setStation] = useState(product?.kitchenStation ?? "");
  const [active, setActive] = useState(product?.active ?? true);
  const [sku, setSku] = useState(product?.sku ?? "");
  const [trackStock, setTrackStock] = useState(product?.trackStock ?? false);
  const [consignorId, setConsignorId] = useState(product?.consignorId ?? "");
  const [consignors, setConsignors] = useState<Consignor[]>([]);

  useEffect(() => {
    void api<Consignor[]>("GET", "/admin/consignment/consignors")
      .then((list) => setConsignors(list.filter((c) => c.active)))
      .catch(() => {});
  }, []);
  const [groups, setGroups] = useState<Set<string>>(
    new Set(product?.modifierGroupIds ?? []),
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const cents = Math.round(parseFloat(price || "0") * 100);
      const body = {
        name,
        basePriceCents: cents,
        categoryId: categoryId || undefined,
        kitchenStation: station || undefined,
        sku: sku || undefined,
      };
      let id: string;
      if (product) {
        await api("PATCH", `/admin/products/${product.id}`, {
          ...body,
          active,
          trackStock,
          consignorId: consignorId || null,
        });
        id = product.id;
      } else {
        const created = await api<Product>("POST", "/admin/products", body);
        id = created.id;
        if (trackStock || consignorId) {
          await api("PATCH", `/admin/products/${id}`, {
            trackStock,
            consignorId: consignorId || null,
          });
        }
      }
      const before = new Set(product?.modifierGroupIds ?? []);
      for (const groupId of groups) {
        if (!before.has(groupId)) {
          await api("POST", `/admin/products/${id}/modifier-groups`, { groupId });
        }
      }
      for (const groupId of before) {
        if (!groups.has(groupId)) {
          await api("DELETE", `/admin/products/${id}/modifier-groups/${groupId}`);
        }
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>{product ? "Edit product" : "New product"}</h2>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label>
          Price (RM)
          <input
            type="number"
            step="0.01"
            min="0"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </label>
        <label>
          Category
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">—</option>
            {catalog.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Kitchen station
          <input
            value={station}
            placeholder="wok / drinks / fryer…"
            onChange={(e) => setStation(e.target.value)}
          />
        </label>
        <label>
          SKU / barcode (retail scanning)
          <input value={sku} onChange={(e) => setSku(e.target.value)} />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={trackStock}
            onChange={(e) => setTrackStock(e.target.checked)}
          />
          Track per-unit stock (retail/consignment)
        </label>
        {consignors.length > 0 && (
          <label>
            Consignor
            <select value={consignorId} onChange={(e) => setConsignorId(e.target.value)}>
              <option value="">— own product —</option>
              {consignors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="check-list">
          <span className="dim">Modifier groups</span>
          {catalog.modifierGroups.map((g) => (
            <label key={g.id} className="check">
              <input
                type="checkbox"
                checked={groups.has(g.id)}
                onChange={(e) => {
                  const next = new Set(groups);
                  if (e.target.checked) next.add(g.id);
                  else next.delete(g.id);
                  setGroups(next);
                }}
              />
              {g.name}
            </label>
          ))}
        </div>
        {product && (
          <label className="check">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            Active (shown on menus)
          </label>
        )}
        {error && <div className="error">{error}</div>}
        <div className="row-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={busy || !name || !price}
            onClick={() => void save()}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- modifier group editor ----------

function GroupDialog({
  group,
  onClose,
}: {
  group: ModifierGroup | null;
  onClose: () => void;
}) {
  const [name, setName] = useState(group?.name ?? "");
  const [minSelect, setMinSelect] = useState(group?.minSelect ?? 0);
  const [maxSelect, setMaxSelect] = useState(group?.maxSelect ?? 1);
  const [saved, setSaved] = useState<ModifierGroup | null>(group);
  const [newMod, setNewMod] = useState({ name: "", delta: "" });
  const [error, setError] = useState("");

  const saveGroup = async () => {
    setError("");
    try {
      const body = { name, minSelect, maxSelect };
      const result = saved
        ? await api<ModifierGroup>("PATCH", `/admin/modifier-groups/${saved.id}`, body)
        : await api<ModifierGroup>("POST", "/admin/modifier-groups", body);
      setSaved(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  };

  const addModifier = async () => {
    if (!saved || !newMod.name) return;
    const updated = await api<unknown>("POST", `/admin/modifier-groups/${saved.id}/modifiers`, {
      name: newMod.name,
      priceDeltaCents: Math.round(parseFloat(newMod.delta || "0") * 100),
    });
    void updated;
    const fresh = await api<ModifierGroup>("PATCH", `/admin/modifier-groups/${saved.id}`, {});
    setSaved(fresh);
    setNewMod({ name: "", delta: "" });
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>{group ? "Edit modifier group" : "New modifier group"}</h2>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <div className="two-col">
          <label>
            Min select
            <input
              type="number"
              min={0}
              value={minSelect}
              onChange={(e) => setMinSelect(parseInt(e.target.value || "0", 10))}
            />
          </label>
          <label>
            Max select
            <input
              type="number"
              min={1}
              value={maxSelect}
              onChange={(e) => setMaxSelect(parseInt(e.target.value || "1", 10))}
            />
          </label>
        </div>
        <button className="btn" disabled={!name} onClick={() => void saveGroup()}>
          {saved ? "Update group" : "Create group"}
        </button>

        {saved && (
          <>
            <div className="check-list">
              <span className="dim">Options</span>
              {saved.modifiers.map((m) => (
                <div key={m.id} className="mod-row">
                  <span>
                    {m.name}
                    {m.priceDeltaCents !== 0 && (
                      <small className="dim"> +{fmt(m.priceDeltaCents)}</small>
                    )}
                  </span>
                  <button
                    className={`chip ${m.soldOut ? "warn" : "ok"}`}
                    onClick={async () => {
                      await api("PATCH", `/admin/modifiers/${m.id}`, {
                        soldOut: !m.soldOut,
                      });
                      const fresh = await api<ModifierGroup>(
                        "PATCH",
                        `/admin/modifier-groups/${saved.id}`,
                        {},
                      );
                      setSaved(fresh);
                    }}
                  >
                    {m.soldOut ? "86'd" : "OK"}
                  </button>
                </div>
              ))}
            </div>
            <div className="two-col">
              <input
                placeholder="Option name"
                value={newMod.name}
                onChange={(e) => setNewMod({ ...newMod, name: e.target.value })}
              />
              <input
                placeholder="+RM"
                type="number"
                step="0.01"
                value={newMod.delta}
                onChange={(e) => setNewMod({ ...newMod, delta: e.target.value })}
              />
            </div>
            <button className="btn" disabled={!newMod.name} onClick={() => void addModifier()}>
              + Add option
            </button>
          </>
        )}

        {error && <div className="error">{error}</div>}
        <div className="row-actions">
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
