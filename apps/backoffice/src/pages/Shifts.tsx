import { useEffect, useState } from "react";
import { formatCents } from "@pos/shared";
import { api } from "../api";
import type { Outlet } from "../types";

interface ShiftRow {
  id: string;
  staffName: string;
  openedAt: string;
  closedAt: string | null;
  openingFloatCents: number;
  expectedCashCents: number | null;
  countedCashCents: number | null;
  varianceCents: number | null;
}

interface ShiftReport {
  staffName: string;
  openedAt: string;
  closedAt: string | null;
  payments: { method: string; amountCents: number; count: number }[];
  completedOrders: number;
  salesCents: number;
  voidedOrders: number;
  cash: {
    openingFloatCents: number;
    cashSalesCents: number;
    cashInCents: number;
    cashOutCents: number;
    expectedCents: number;
    countedCents: number | null;
    varianceCents: number | null;
  };
  movements: { type: string; amountCents: number; reason: string; at: string }[];
}

const fmt = (c: number) => formatCents(c, "MYR");

export default function Shifts({ outlet }: { outlet: Outlet }) {
  const [rows, setRows] = useState<ShiftRow[]>([]);
  const [detail, setDetail] = useState<ShiftReport | null>(null);

  useEffect(() => {
    void api<ShiftRow[]>("GET", `/outlets/${outlet.id}/shifts`).then(setRows);
  }, [outlet.id]);

  return (
    <div>
      <div className="page-head">
        <h1>Shifts · {outlet.name}</h1>
      </div>

      <section className="panel">
        <table>
          <thead>
            <tr>
              <th>Opened</th>
              <th>Staff</th>
              <th>Status</th>
              <th>Float</th>
              <th>Expected</th>
              <th>Counted</th>
              <th>Variance</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td className="dim">{new Date(s.openedAt).toLocaleString()}</td>
                <td>{s.staffName}</td>
                <td>
                  <span className={`chip ${s.closedAt ? "" : "ok"}`}>
                    {s.closedAt ? "closed" : "open"}
                  </span>
                </td>
                <td className="num">{fmt(s.openingFloatCents)}</td>
                <td className="num">
                  {s.expectedCashCents != null ? fmt(s.expectedCashCents) : "—"}
                </td>
                <td className="num">
                  {s.countedCashCents != null ? fmt(s.countedCashCents) : "—"}
                </td>
                <td className="num">
                  {s.varianceCents != null ? (
                    <span className={`chip ${s.varianceCents === 0 ? "ok" : "warn"}`}>
                      {fmt(s.varianceCents)}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  <button
                    className="btn small"
                    onClick={() =>
                      void api<ShiftReport>("GET", `/shifts/${s.id}/report`).then(setDetail)
                    }
                  >
                    Report
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="dim">No shifts yet.</p>}
      </section>

      {detail && (
        <div className="overlay" onClick={() => setDetail(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>
              {detail.closedAt ? "Z report" : "X report (live)"} · {detail.staffName}
            </h2>
            <table>
              <tbody>
                <Tr label="Orders completed" value={String(detail.completedOrders)} />
                <Tr label="Orders voided" value={String(detail.voidedOrders)} />
                <Tr label="Total sales" value={fmt(detail.salesCents)} />
                {detail.payments.map((p) => (
                  <Tr
                    key={p.method}
                    label={`${p.method.replace("_", " ")} (${p.count})`}
                    value={fmt(p.amountCents)}
                  />
                ))}
                <Tr label="Opening float" value={fmt(detail.cash.openingFloatCents)} />
                <Tr label="Cash in / out" value={`${fmt(detail.cash.cashInCents)} / ${fmt(-detail.cash.cashOutCents)}`} />
                <Tr label="Expected cash" value={fmt(detail.cash.expectedCents)} />
                {detail.cash.countedCents != null && (
                  <>
                    <Tr label="Counted" value={fmt(detail.cash.countedCents)} />
                    <Tr label="Variance" value={fmt(detail.cash.varianceCents ?? 0)} />
                  </>
                )}
              </tbody>
            </table>
            {detail.movements.length > 0 && (
              <>
                <h2 style={{ fontSize: 14 }}>Cash movements</h2>
                <table>
                  <tbody>
                    {detail.movements.map((m, i) => (
                      <tr key={i}>
                        <td className="dim">{new Date(m.at).toLocaleTimeString()}</td>
                        <td>{m.reason}</td>
                        <td className="num">
                          {m.type === "CASH_IN" ? "+" : "−"}
                          {fmt(m.amountCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            <div className="row-actions">
              <button className="btn primary" onClick={() => setDetail(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Tr({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td className="dim">{label}</td>
      <td className="num">{value}</td>
    </tr>
  );
}
