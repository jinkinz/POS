import { useCallback, useEffect, useState } from "react";
import { formatCents } from "@pos/shared";
import { api } from "../api";
import type { Outlet } from "../types";

interface Profile {
  name: string;
  tin: string | null;
  brn: string | null;
  sstNo: string | null;
  msicCode: string | null;
  invoiceAddress: string | null;
  providers: string[];
}

interface EInvoiceRow {
  id: string;
  type: "INDIVIDUAL" | "CONSOLIDATED";
  status: string;
  provider: string;
  orderId: string | null;
  periodStart: string | null;
  orderCount: number;
  totalCents: number;
  taxCents: number;
  longId: string | null;
  qrUrl: string | null;
  error: string | null;
  createdAt: string;
}

interface Preview {
  month: string;
  orderCount: number;
  excludedIndividuallyInvoiced: number;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}

interface RecentOrder {
  id: string;
  orderNo: number | null;
  status: string;
  totalCents: number;
  roundingCents: number;
  openedAt: string;
}

const fmt = (c: number) => formatCents(c, "MYR");

function lastMonth(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function EInvoicePage({ outlet }: { outlet: Outlet }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [rows, setRows] = useState<EInvoiceRow[]>([]);
  const [month, setMonth] = useState(lastMonth());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [issueFor, setIssueFor] = useState<RecentOrder | null>(null);
  const [recent, setRecent] = useState<RecentOrder[]>([]);
  const [message, setMessage] = useState("");

  const reload = useCallback(() => {
    void api<Profile>("GET", "/admin/einvoice/profile").then(setProfile);
    void api<EInvoiceRow[]>("GET", "/admin/einvoice").then(setRows);
  }, []);
  useEffect(() => {
    reload();
    void api<RecentOrder[]>("GET", `/outlets/${outlet.id}/orders?status=COMPLETED`).then(
      (list) => setRecent(list.slice(0, 15)),
    );
  }, [reload, outlet.id]);

  useEffect(() => {
    setPreview(null);
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    void api<Preview>("GET", `/admin/einvoice/consolidated/preview?month=${month}`)
      .then(setPreview)
      .catch(() => {});
  }, [month, rows.length]);

  const submitConsolidated = async () => {
    setMessage("");
    try {
      await api("POST", "/admin/einvoice/consolidated", { month });
      setMessage(`Consolidated e-invoice for ${month} submitted.`);
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed");
    }
  };

  const invoicedOrderIds = new Set(rows.map((r) => r.orderId).filter(Boolean));

  return (
    <div>
      <div className="page-head">
        <h1>E-Invoicing (LHDN MyInvois)</h1>
        {profile && (
          <span className="chip">
            provider: {profile.providers.includes("MYINVOIS") ? "MyInvois" : "Mock (dev)"}
          </span>
        )}
      </div>

      {profile && <ProfileForm profile={profile} onSaved={reload} />}

      <section className="panel">
        <h2>Monthly consolidated e-invoice (B2C)</h2>
        <p className="dim">
          Aggregates all completed sales for the month, excluding orders that
          received an individual e-invoice. LHDN expects this within 7 days
          after month end.
        </p>
        <div className="row-actions" style={{ margin: "10px 0" }}>
          <input
            style={{ maxWidth: 140 }}
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            placeholder="YYYY-MM"
          />
          <button
            className="btn primary"
            disabled={!preview || preview.orderCount === 0}
            onClick={() => void submitConsolidated()}
          >
            Submit consolidated
          </button>
        </div>
        {preview && (
          <p className="dim">
            {preview.orderCount} transactions · subtotal {fmt(preview.subtotalCents)} ·
            tax {fmt(preview.taxCents)} · total <b>{fmt(preview.totalCents)}</b>
            {preview.excludedIndividuallyInvoiced > 0 &&
              ` · ${preview.excludedIndividuallyInvoiced} excluded (individually invoiced)`}
          </p>
        )}
        {message && <p>{message}</p>}
      </section>

      <section className="panel">
        <h2>Issue individual e-invoice (buyer request)</h2>
        <table>
          <tbody>
            {recent.map((o) => (
              <tr key={o.id}>
                <td className="dim">{new Date(o.openedAt).toLocaleString()}</td>
                <td>#{o.orderNo ?? "—"}</td>
                <td className="num">{fmt(o.totalCents + o.roundingCents)}</td>
                <td>
                  {invoicedOrderIds.has(o.id) ? (
                    <span className="chip ok">e-invoiced</span>
                  ) : (
                    <button className="btn small" onClick={() => setIssueFor(o)}>
                      Issue e-invoice
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {recent.length === 0 && <p className="dim">No completed orders yet.</p>}
      </section>

      <section className="panel">
        <h2>Submitted documents</h2>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Type</th>
              <th>Scope</th>
              <th>Total</th>
              <th>Tax</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="dim">{new Date(r.createdAt).toLocaleString()}</td>
                <td>{r.type}</td>
                <td className="dim">
                  {r.type === "CONSOLIDATED"
                    ? `${r.periodStart?.slice(0, 7)} · ${r.orderCount} orders`
                    : "1 order"}
                </td>
                <td className="num">{fmt(r.totalCents)}</td>
                <td className="num dim">{fmt(r.taxCents)}</td>
                <td>
                  <span
                    className={`chip ${r.status === "VALID" ? "ok" : r.status === "INVALID" ? "warn" : ""}`}
                  >
                    {r.status}
                  </span>
                  {r.longId && <div className="dim" style={{ fontSize: 11 }}>{r.longId}</div>}
                </td>
                <td>
                  <span className="row-actions">
                    {r.status === "SUBMITTED" && (
                      <button
                        className="btn small"
                        onClick={async () => {
                          await api("POST", `/admin/einvoice/${r.id}/refresh`, {});
                          reload();
                        }}
                      >
                        Check status
                      </button>
                    )}
                    {r.qrUrl && (
                      <a className="btn small" href={r.qrUrl} target="_blank" rel="noreferrer">
                        Validation link
                      </a>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="dim">Nothing submitted yet.</p>}
      </section>

      {issueFor && (
        <IssueDialog
          order={issueFor}
          onClose={(done) => {
            setIssueFor(null);
            if (done) reload();
          }}
        />
      )}
    </div>
  );
}

function ProfileForm({ profile, onSaved }: { profile: Profile; onSaved: () => void }) {
  const [form, setForm] = useState({
    tin: profile.tin ?? "",
    brn: profile.brn ?? "",
    sstNo: profile.sstNo ?? "",
    msicCode: profile.msicCode ?? "",
    invoiceAddress: profile.invoiceAddress ?? "",
  });
  const [saved, setSaved] = useState(false);
  const complete = form.tin.length >= 3 && form.brn.length >= 3;

  const save = async () => {
    await api("PATCH", "/admin/einvoice/profile", {
      tin: form.tin || undefined,
      brn: form.brn || undefined,
      sstNo: form.sstNo || undefined,
      msicCode: form.msicCode || undefined,
      invoiceAddress: form.invoiceAddress || undefined,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    onSaved();
  };

  return (
    <section className="panel">
      <h2>
        Tax profile{" "}
        {!complete && <span className="chip warn">required before submitting</span>}
        {saved && <span className="chip ok">saved</span>}
      </h2>
      <div className="two-col" style={{ maxWidth: 640, marginTop: 8 }}>
        <label className="dim">
          TIN
          <input value={form.tin} onChange={(e) => setForm({ ...form, tin: e.target.value })} />
        </label>
        <label className="dim">
          Business registration no (BRN)
          <input value={form.brn} onChange={(e) => setForm({ ...form, brn: e.target.value })} />
        </label>
        <label className="dim">
          SST registration
          <input value={form.sstNo} onChange={(e) => setForm({ ...form, sstNo: e.target.value })} />
        </label>
        <label className="dim">
          MSIC code
          <input
            value={form.msicCode}
            placeholder="56103"
            maxLength={5}
            onChange={(e) => setForm({ ...form, msicCode: e.target.value.replace(/\D/g, "") })}
          />
        </label>
      </div>
      <label className="dim" style={{ display: "block", maxWidth: 640, marginTop: 8 }}>
        Registered address
        <input
          value={form.invoiceAddress}
          onChange={(e) => setForm({ ...form, invoiceAddress: e.target.value })}
        />
      </label>
      <div style={{ marginTop: 10 }}>
        <button className="btn primary" onClick={() => void save()}>
          Save profile
        </button>
      </div>
    </section>
  );
}

function IssueDialog({
  order,
  onClose,
}: {
  order: RecentOrder;
  onClose: (done: boolean) => void;
}) {
  const [form, setForm] = useState({
    name: "",
    tin: "",
    idType: "NRIC",
    idValue: "",
    email: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await api("POST", `/admin/einvoice/orders/${order.id}`, {
        buyer: {
          name: form.name,
          tin: form.tin,
          idType: form.idType,
          idValue: form.idValue,
          email: form.email || undefined,
        },
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
        <h2>
          E-invoice for order #{order.orderNo ?? "—"} ·{" "}
          {fmt(order.totalCents + order.roundingCents)}
        </h2>
        <label>
          Buyer name
          <input value={form.name} autoFocus onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label>
          Buyer TIN
          <input value={form.tin} onChange={(e) => setForm({ ...form, tin: e.target.value })} />
        </label>
        <div className="two-col">
          <label>
            ID type
            <select value={form.idType} onChange={(e) => setForm({ ...form, idType: e.target.value })}>
              {["NRIC", "BRN", "PASSPORT", "ARMY"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            ID number
            <input value={form.idValue} onChange={(e) => setForm({ ...form, idValue: e.target.value })} />
          </label>
        </div>
        <label>
          Email (optional)
          <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </label>
        {error && <div className="error">{error}</div>}
        <div className="row-actions">
          <button className="btn" onClick={() => onClose(false)}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={busy || form.name.length < 2 || form.tin.length < 3 || form.idValue.length < 3}
            onClick={() => void submit()}
          >
            Submit to LHDN
          </button>
        </div>
      </div>
    </div>
  );
}
