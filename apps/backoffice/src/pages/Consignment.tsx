import { useCallback, useEffect, useState } from "react";
import { formatCents } from "@pos/shared";
import { api } from "../api";
import type { Consignor } from "../types";

interface Settlement {
  id: string;
  consignor: { name: string };
  periodStart: string;
  unitsSold: number;
  salesCents: number;
  commissionCents: number;
  payoutCents: number;
  status: "DRAFT" | "PAID";
  createdAt: string;
}

interface Preview {
  month: string;
  unitsSold: number;
  salesCents: number;
  commissionCents: number;
  payoutCents: number;
  commissionBps: number;
  lines: { name: string; quantity: number; amountCents: number }[];
}

const fmt = (c: number) => formatCents(c, "MYR");

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function ConsignmentPage() {
  const [consignors, setConsignors] = useState<Consignor[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [month, setMonth] = useState(thisMonth());
  const [preview, setPreview] = useState<(Preview & { consignorId: string }) | null>(null);
  const [message, setMessage] = useState("");

  const reload = useCallback(async () => {
    setConsignors(await api<Consignor[]>("GET", "/admin/consignment/consignors"));
    setSettlements(await api<Settlement[]>("GET", "/admin/consignment/settlements"));
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const addConsignor = async () => {
    const name = prompt("Consignor name?");
    if (!name) return;
    const pct = prompt("Store commission % (e.g. 20)?", "20");
    if (pct == null) return;
    await api("POST", "/admin/consignment/consignors", {
      name,
      commissionBps: Math.round(parseFloat(pct || "20") * 100),
    });
    void reload();
  };

  const showPreview = async (c: Consignor) => {
    setMessage("");
    try {
      const p = await api<Preview>(
        "GET",
        `/admin/consignment/consignors/${c.id}/settlements/preview?month=${month}`,
      );
      setPreview({ ...p, consignorId: c.id });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed");
    }
  };

  const generate = async () => {
    if (!preview) return;
    setMessage("");
    try {
      await api("POST", `/admin/consignment/consignors/${preview.consignorId}/settlements`, {
        month: preview.month,
      });
      setPreview(null);
      void reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <div>
      <div className="page-head">
        <h1>Consignment</h1>
        <div className="row-actions">
          <input
            style={{ maxWidth: 120 }}
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            placeholder="YYYY-MM"
          />
          <button className="btn primary" onClick={() => void addConsignor()}>
            + Consignor
          </button>
        </div>
      </div>
      {message && <p className="error">{message}</p>}

      <section className="panel">
        <h2>Consignors</h2>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Commission</th>
              <th>Products</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {consignors.map((c) => (
              <tr key={c.id} className={c.active ? "" : "inactive"}>
                <td>{c.name}</td>
                <td className="dim">{(c.commissionBps / 100).toFixed(1)}%</td>
                <td className="dim">{c.productCount ?? 0}</td>
                <td>
                  <span className={`chip ${c.active ? "ok" : "warn"}`}>
                    {c.active ? "active" : "inactive"}
                  </span>
                </td>
                <td>
                  <span className="row-actions">
                    <button className="btn small" onClick={() => void showPreview(c)}>
                      Settle {month}
                    </button>
                    <button
                      className="btn small"
                      onClick={async () => {
                        await api("PATCH", `/admin/consignment/consignors/${c.id}`, {
                          active: !c.active,
                        });
                        void reload();
                      }}
                    >
                      {c.active ? "Deactivate" : "Activate"}
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {consignors.length === 0 && (
          <p className="dim">
            No consignors yet. Add one, then assign their products in the Menu
            page (consignor dropdown + track stock).
          </p>
        )}
      </section>

      <section className="panel">
        <h2>Settlement statements</h2>
        <table>
          <thead>
            <tr>
              <th>Consignor</th>
              <th>Period</th>
              <th>Units</th>
              <th>Sales</th>
              <th>Commission</th>
              <th>Payout</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {settlements.map((s) => (
              <tr key={s.id}>
                <td>{s.consignor.name}</td>
                <td className="dim">{s.periodStart.slice(0, 7)}</td>
                <td className="num dim">{s.unitsSold}</td>
                <td className="num">{fmt(s.salesCents)}</td>
                <td className="num dim">{fmt(s.commissionCents)}</td>
                <td className="num">
                  <b>{fmt(s.payoutCents)}</b>
                </td>
                <td>
                  <span className={`chip ${s.status === "PAID" ? "ok" : "warn"}`}>
                    {s.status}
                  </span>
                </td>
                <td>
                  {s.status === "DRAFT" && (
                    <button
                      className="btn small"
                      onClick={async () => {
                        await api("POST", `/admin/consignment/settlements/${s.id}/paid`, {});
                        void reload();
                      }}
                    >
                      Mark paid
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {settlements.length === 0 && <p className="dim">No settlements yet.</p>}
      </section>

      {preview && (
        <div className="overlay" onClick={() => setPreview(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Settlement preview · {preview.month}</h2>
            <table>
              <tbody>
                {preview.lines.map((l) => (
                  <tr key={l.name}>
                    <td>{l.name}</td>
                    <td className="num dim">{l.quantity}×</td>
                    <td className="num">{fmt(l.amountCents)}</td>
                  </tr>
                ))}
                <tr>
                  <td>
                    <b>Sales</b>
                  </td>
                  <td className="num dim">{preview.unitsSold}×</td>
                  <td className="num">
                    <b>{fmt(preview.salesCents)}</b>
                  </td>
                </tr>
                <tr>
                  <td className="dim">
                    Commission ({(preview.commissionBps / 100).toFixed(1)}%)
                  </td>
                  <td />
                  <td className="num dim">−{fmt(preview.commissionCents)}</td>
                </tr>
                <tr>
                  <td>
                    <b>Payout to consignor</b>
                  </td>
                  <td />
                  <td className="num">
                    <b>{fmt(preview.payoutCents)}</b>
                  </td>
                </tr>
              </tbody>
            </table>
            {message && <div className="error">{message}</div>}
            <div className="row-actions">
              <button className="btn" onClick={() => setPreview(null)}>
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={preview.unitsSold === 0}
                onClick={() => void generate()}
              >
                Generate statement
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
