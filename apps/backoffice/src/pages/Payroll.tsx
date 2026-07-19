import { useCallback, useEffect, useState } from "react";
import { formatCents } from "@pos/shared";
import { api } from "../api";

interface PayrollItem {
  staffId: string;
  staffName: string;
  salaryType: "MONTHLY" | "HOURLY";
  hoursWorked: string | null;
  grossCents: number;
  epfEmployeeCents: number;
  epfEmployerCents: number;
  socsoEmployeeCents: number;
  socsoEmployerCents: number;
  eisEmployeeCents: number;
  eisEmployerCents: number;
  netCents: number;
}

interface PayrollRun {
  id: string;
  month: string;
  status: "DRAFT" | "FINALIZED";
  items: PayrollItem[];
  totals: { grossCents: number; netCents: number; employerCostCents: number };
}

interface AttendanceRow {
  staffId: string;
  name: string;
  role: string;
  salaryType: string | null;
  totalHours: number;
  entries: { id: string; clockIn: string; clockOut: string | null; manual: boolean }[];
}

const fmt = (c: number) => formatCents(c, "MYR");

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function Payroll() {
  const [month, setMonth] = useState(thisMonth());
  const [run, setRun] = useState<PayrollRun | null>(null);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [message, setMessage] = useState("");

  const loadExisting = useCallback(async () => {
    const runs = await api<{ id: string; month: string }[]>("GET", "/admin/payroll/runs");
    const match = runs.find((r) => r.month === month);
    setRun(match ? await api<PayrollRun>("GET", `/admin/payroll/runs/${match.id}`) : null);
    setAttendance(await api<AttendanceRow[]>("GET", `/admin/attendance?month=${month}`));
  }, [month]);
  useEffect(() => {
    setMessage("");
    void loadExisting().catch(() => {});
  }, [loadExisting]);

  const compute = async () => {
    setMessage("");
    try {
      setRun(await api<PayrollRun>("POST", "/admin/payroll/runs", { month }));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed");
    }
  };

  const finalize = async () => {
    if (!run) return;
    if (!confirm(`Finalize ${run.month} payroll? It can no longer be recomputed.`)) return;
    setRun(await api<PayrollRun>("POST", `/admin/payroll/runs/${run.id}/finalize`, {}));
  };

  return (
    <div>
      <div className="page-head">
        <h1>Payroll (Malaysia)</h1>
        <div className="row-actions">
          <input
            style={{ maxWidth: 130 }}
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            placeholder="YYYY-MM"
          />
          <button className="btn primary" onClick={() => void compute()}>
            {run ? "Recompute" : "Compute payroll"}
          </button>
          {run && run.status === "DRAFT" && (
            <button className="btn" onClick={() => void finalize()}>
              Finalize
            </button>
          )}
        </div>
      </div>
      <p className="dim">
        EPF 11%/13%, SOCSO and EIS with RM6,000 ceiling — simplified percentage
        model; PCB not computed. Set salaries on the Staff page.
      </p>
      {message && <p className="error">{message}</p>}

      {run && (
        <section className="panel">
          <h2>
            {run.month} ·{" "}
            <span className={`chip ${run.status === "FINALIZED" ? "ok" : "warn"}`}>
              {run.status}
            </span>
          </h2>
          <table>
            <thead>
              <tr>
                <th>Staff</th>
                <th>Type</th>
                <th>Hours</th>
                <th>Gross</th>
                <th>EPF (ee/er)</th>
                <th>SOCSO (ee/er)</th>
                <th>EIS (ee/er)</th>
                <th>Net pay</th>
              </tr>
            </thead>
            <tbody>
              {run.items.map((i) => (
                <tr key={i.staffId}>
                  <td>{i.staffName}</td>
                  <td className="dim">{i.salaryType}</td>
                  <td className="num dim">
                    {i.hoursWorked != null ? parseFloat(i.hoursWorked).toFixed(2) : "—"}
                  </td>
                  <td className="num">{fmt(i.grossCents)}</td>
                  <td className="num dim">
                    {fmt(i.epfEmployeeCents)} / {fmt(i.epfEmployerCents)}
                  </td>
                  <td className="num dim">
                    {fmt(i.socsoEmployeeCents)} / {fmt(i.socsoEmployerCents)}
                  </td>
                  <td className="num dim">
                    {fmt(i.eisEmployeeCents)} / {fmt(i.eisEmployerCents)}
                  </td>
                  <td className="num">
                    <b>{fmt(i.netCents)}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ marginTop: 10 }}>
            Total gross <b>{fmt(run.totals.grossCents)}</b> · total net{" "}
            <b>{fmt(run.totals.netCents)}</b> · employer cost incl. contributions{" "}
            <b>{fmt(run.totals.employerCostCents)}</b>
          </p>
        </section>
      )}

      <section className="panel">
        <h2>Attendance · {month}</h2>
        <table>
          <thead>
            <tr>
              <th>Staff</th>
              <th>Role</th>
              <th>Salary type</th>
              <th>Hours (closed entries)</th>
              <th>Entries</th>
            </tr>
          </thead>
          <tbody>
            {attendance.map((a) => (
              <tr key={a.staffId}>
                <td>{a.name}</td>
                <td className="dim">{a.role}</td>
                <td className="dim">{a.salaryType ?? "—"}</td>
                <td className="num">
                  <b>{a.totalHours.toFixed(2)}</b>
                </td>
                <td className="dim">
                  {a.entries.length}
                  {a.entries.some((e) => !e.clockOut) && (
                    <span className="chip ok" style={{ marginLeft: 6 }}>
                      on clock
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {attendance.length === 0 && <p className="dim">No attendance this month.</p>}
      </section>
    </div>
  );
}
