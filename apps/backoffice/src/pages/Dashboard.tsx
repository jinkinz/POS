import { useEffect, useState } from "react";
import { formatCents } from "@pos/shared";
import { api } from "../api";
import type { DailyReport, Outlet } from "../types";

function todayLocal(): string {
  const d = new Date();
  const tz = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return tz.format(d);
}

export default function Dashboard({ outlet }: { outlet: Outlet }) {
  const [date, setDate] = useState(todayLocal());
  const [report, setReport] = useState<DailyReport | null>(null);
  const [error, setError] = useState("");
  const currency = "MYR" as const;
  const fmt = (c: number) => formatCents(c, currency);

  useEffect(() => {
    setReport(null);
    setError("");
    api<DailyReport>("GET", `/admin/outlets/${outlet.id}/reports/daily?date=${date}`)
      .then(setReport)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [outlet.id, date]);

  return (
    <div>
      <div className="page-head">
        <h1>Daily sales · {outlet.name}</h1>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      {error && <p className="error">{error}</p>}
      {!report && !error && <p className="dim">Loading…</p>}
      {report && (
        <>
          <div className="stats">
            <div className="stat">
              <span className="stat-label">Revenue (completed)</span>
              <span className="stat-value">{fmt(report.revenueCents)}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Orders</span>
              <span className="stat-value">{report.orderCount}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Average order</span>
              <span className="stat-value">{fmt(report.averageOrderCents)}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Open now</span>
              <span className="stat-value">{report.openCount}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Voided</span>
              <span className="stat-value">
                {report.voidedCount} orders · {report.voidedItems} items
              </span>
            </div>
          </div>

          <div className="cols">
            <section className="panel">
              <h2>Payments</h2>
              {report.byPayment.length === 0 && <p className="dim">No payments yet.</p>}
              <table>
                <tbody>
                  {report.byPayment.map((p) => (
                    <tr key={p.method}>
                      <td>{p.method.replace("_", " ")}</td>
                      <td className="dim">{p.count}×</td>
                      <td className="num">{fmt(p.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="panel">
              <h2>Top items</h2>
              {report.topItems.length === 0 && <p className="dim">Nothing sold yet.</p>}
              <table>
                <tbody>
                  {report.topItems.map((i) => (
                    <tr key={i.name}>
                      <td>{i.name}</td>
                      <td className="dim">{i.quantity}×</td>
                      <td className="num">{fmt(i.salesCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="panel">
              <h2>Order sources</h2>
              <table>
                <tbody>
                  {Object.entries(report.bySource).map(([source, count]) => (
                    <tr key={source}>
                      <td>{source}</td>
                      <td className="num">{count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
