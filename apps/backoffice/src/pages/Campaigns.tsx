import { useCallback, useEffect, useState } from "react";
import { formatCents } from "@pos/shared";
import { api } from "../api";

interface Campaign {
  id: string;
  name: string;
  kind: "CODE" | "ISSUED";
  code: string | null;
  discountType: "AMOUNT" | "PERCENT";
  valueCents: number | null;
  valueBps: number | null;
  maxDiscountCents: number | null;
  minSpendCents: number;
  startsAt: string | null;
  endsAt: string | null;
  maxUses: number | null;
  usedCount: number;
  issuedCount: number;
  active: boolean;
}

const fmt = (c: number) => formatCents(c, "MYR");

function describeDiscount(c: Campaign): string {
  const base =
    c.discountType === "AMOUNT"
      ? `${fmt(c.valueCents ?? 0)} off`
      : `${(c.valueBps ?? 0) / 100}% off${c.maxDiscountCents ? ` (max ${fmt(c.maxDiscountCents)})` : ""}`;
  return c.minSpendCents > 0 ? `${base}, min spend ${fmt(c.minSpendCents)}` : base;
}

export default function Campaigns() {
  const [rows, setRows] = useState<Campaign[]>([]);
  const [showNew, setShowNew] = useState(false);

  const reload = useCallback(
    () => api<Campaign[]>("GET", "/admin/campaigns").then(setRows),
    [],
  );
  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div>
      <div className="page-head">
        <h1>Campaigns & vouchers</h1>
        <button className="btn primary" onClick={() => setShowNew(true)}>
          + Campaign
        </button>
      </div>

      <section className="panel">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Discount</th>
              <th>Validity</th>
              <th>Usage</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className={c.active ? "" : "inactive"}>
                <td>
                  {c.name}
                  {c.code && (
                    <div className="dim" style={{ fontSize: 12 }}>
                      code: <b>{c.code}</b>
                    </div>
                  )}
                </td>
                <td className="dim">
                  {c.kind === "CODE" ? "Promo code" : "Personal vouchers"}
                </td>
                <td>{describeDiscount(c)}</td>
                <td className="dim">
                  {c.endsAt ? `until ${new Date(c.endsAt).toLocaleDateString()}` : "no expiry"}
                </td>
                <td className="dim">
                  {c.kind === "CODE"
                    ? `${c.usedCount}${c.maxUses ? ` / ${c.maxUses}` : ""} used`
                    : `${c.issuedCount} issued`}
                </td>
                <td>
                  <span className={`chip ${c.active ? "ok" : "warn"}`}>
                    {c.active ? "active" : "inactive"}
                  </span>
                </td>
                <td>
                  <button
                    className="btn small"
                    onClick={async () => {
                      await api("PATCH", `/admin/campaigns/${c.id}`, {
                        active: !c.active,
                      });
                      void reload();
                    }}
                  >
                    {c.active ? "Deactivate" : "Activate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="dim">
            No campaigns yet. Create a promo code (e.g. MERDEKA10) or a personal
            voucher template, then issue vouchers from the Members page.
          </p>
        )}
      </section>

      {showNew && (
        <NewCampaignDialog
          onClose={(created) => {
            setShowNew(false);
            if (created) void reload();
          }}
        />
      )}
    </div>
  );
}

function NewCampaignDialog({ onClose }: { onClose: (created: boolean) => void }) {
  const [form, setForm] = useState({
    name: "",
    kind: "CODE",
    code: "",
    discountType: "PERCENT",
    value: "",
    maxDiscount: "",
    minSpend: "",
    endsAt: "",
    maxUses: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const value = parseFloat(form.value || "0");
      await api("POST", "/admin/campaigns", {
        name: form.name,
        kind: form.kind,
        code: form.kind === "CODE" ? form.code : undefined,
        discountType: form.discountType,
        valueCents:
          form.discountType === "AMOUNT" ? Math.round(value * 100) : undefined,
        valueBps:
          form.discountType === "PERCENT" ? Math.round(value * 100) : undefined,
        maxDiscountCents: form.maxDiscount
          ? Math.round(parseFloat(form.maxDiscount) * 100)
          : undefined,
        minSpendCents: form.minSpend
          ? Math.round(parseFloat(form.minSpend) * 100)
          : undefined,
        endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : undefined,
        maxUses: form.maxUses ? parseInt(form.maxUses, 10) : undefined,
      });
      onClose(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={() => onClose(false)}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>New campaign</h2>
        <label>
          Name
          <input value={form.name} autoFocus onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <div className="two-col">
          <label>
            Kind
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="CODE">Promo code (shared)</option>
              <option value="ISSUED">Personal vouchers</option>
            </select>
          </label>
          {form.kind === "CODE" && (
            <label>
              Code
              <input
                value={form.code}
                placeholder="MERDEKA10"
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              />
            </label>
          )}
        </div>
        <div className="two-col">
          <label>
            Discount type
            <select value={form.discountType} onChange={(e) => setForm({ ...form, discountType: e.target.value })}>
              <option value="PERCENT">Percent off</option>
              <option value="AMOUNT">Amount off (RM)</option>
            </select>
          </label>
          <label>
            {form.discountType === "PERCENT" ? "Percent (e.g. 10)" : "Amount (RM)"}
            <input
              type="number"
              step="0.01"
              value={form.value}
              onChange={(e) => setForm({ ...form, value: e.target.value })}
            />
          </label>
        </div>
        <div className="two-col">
          {form.discountType === "PERCENT" && (
            <label>
              Max discount (RM, optional)
              <input
                type="number"
                step="0.01"
                value={form.maxDiscount}
                onChange={(e) => setForm({ ...form, maxDiscount: e.target.value })}
              />
            </label>
          )}
          <label>
            Min spend (RM, optional)
            <input
              type="number"
              step="0.01"
              value={form.minSpend}
              onChange={(e) => setForm({ ...form, minSpend: e.target.value })}
            />
          </label>
        </div>
        <div className="two-col">
          <label>
            Ends (optional)
            <input
              type="date"
              value={form.endsAt}
              onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
            />
          </label>
          {form.kind === "CODE" && (
            <label>
              Max uses (optional)
              <input
                type="number"
                min="1"
                value={form.maxUses}
                onChange={(e) => setForm({ ...form, maxUses: e.target.value })}
              />
            </label>
          )}
        </div>
        {error && <div className="error">{error}</div>}
        <div className="row-actions">
          <button className="btn" onClick={() => onClose(false)}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={
              busy ||
              form.name.length < 2 ||
              !form.value ||
              (form.kind === "CODE" && form.code.length < 3)
            }
            onClick={() => void submit()}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
