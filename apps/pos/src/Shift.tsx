import { useCallback, useEffect, useState } from "react";
import { formatCents } from "@pos/shared";
import { api } from "./api";
import type { Session } from "./types";

interface ShiftReport {
  shiftId: string;
  kind: "X" | "Z";
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
}

interface CurrentShift {
  shift: { id: string } | null;
  report: ShiftReport | null;
}

/** RM string -> cents, rejecting garbage. */
function rm(value: string): number | null {
  const n = parseFloat(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

export default function ShiftDialog({
  session,
  currency,
  onClose,
}: {
  session: Session;
  currency: "MYR" | "SGD";
  onClose: () => void;
}) {
  const outletId = session.staff.outletId!;
  const [view, setView] = useState<"loading" | "none" | "open" | "count" | "done">(
    "loading",
  );
  const [report, setReport] = useState<ShiftReport | null>(null);
  const [floatInput, setFloatInput] = useState("");
  const [countInput, setCountInput] = useState("");
  const [movement, setMovement] = useState<{ type: "CASH_IN" | "CASH_OUT" } | null>(null);
  const [moveAmount, setMoveAmount] = useState("");
  const [moveReason, setMoveReason] = useState("");
  const [error, setError] = useState("");
  const fmt = (c: number) => formatCents(c, currency);

  const refresh = useCallback(async () => {
    try {
      const current = await api<CurrentShift>(
        "GET",
        `/outlets/${outletId}/shifts/current`,
        undefined,
        session.token,
      );
      if (current.shift && current.report) {
        setReport(current.report);
        setView("open");
      } else {
        setView("none");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load shift");
      setView("none");
    }
  }, [outletId, session.token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openShift = async () => {
    const cents = rm(floatInput);
    if (cents == null) return;
    setError("");
    try {
      await api("POST", `/outlets/${outletId}/shifts`, { openingFloatCents: cents }, session.token);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open shift");
    }
  };

  const submitMovement = async () => {
    if (!report || !movement) return;
    const cents = rm(moveAmount);
    if (cents == null || cents === 0 || moveReason.trim().length < 3) return;
    setError("");
    try {
      const updated = await api<ShiftReport>(
        "POST",
        `/shifts/${report.shiftId}/cash-movements`,
        { type: movement.type, amountCents: cents, reason: moveReason.trim() },
        session.token,
      );
      setReport(updated);
      setMovement(null);
      setMoveAmount("");
      setMoveReason("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  };

  const closeShift = async () => {
    if (!report) return;
    const cents = rm(countInput);
    if (cents == null) return;
    setError("");
    try {
      const z = await api<ShiftReport>(
        "POST",
        `/shifts/${report.shiftId}/close`,
        { countedCashCents: cents, print: true },
        session.token,
      );
      setReport(z);
      setView("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not close shift");
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        {view === "loading" && <h2>Loading shift…</h2>}

        {view === "none" && (
          <>
            <h2>Open shift</h2>
            <p className="dim-note">Count the drawer float to start the day.</p>
            <input
              inputMode="decimal"
              placeholder="Opening float (RM)"
              value={floatInput}
              autoFocus
              onChange={(e) => setFloatInput(e.target.value)}
            />
            {error && <div className="error">{error}</div>}
            <div className="sheet-actions">
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={rm(floatInput) == null}
                onClick={() => void openShift()}
              >
                Open shift
              </button>
            </div>
          </>
        )}

        {(view === "open" || view === "done") && report && (
          <>
            <h2>
              {view === "done" ? "Shift closed — Z report" : "Shift (X report)"}
            </h2>
            <div className="shift-grid">
              <Row label="Staff" value={report.staffName} />
              <Row label="Orders" value={String(report.completedOrders)} />
              <Row label="Voided" value={String(report.voidedOrders)} />
              <Row label="Total sales" value={fmt(report.salesCents)} />
              {report.payments.map((p) => (
                <Row
                  key={p.method}
                  label={`  ${p.method.replace("_", " ")} (${p.count})`}
                  value={fmt(p.amountCents)}
                />
              ))}
              <Row label="Opening float" value={fmt(report.cash.openingFloatCents)} />
              <Row label="Cash sales" value={fmt(report.cash.cashSalesCents)} />
              <Row label="Cash in" value={fmt(report.cash.cashInCents)} />
              <Row label="Cash out" value={fmt(-report.cash.cashOutCents)} />
              <Row bold label="Expected in drawer" value={fmt(report.cash.expectedCents)} />
              {report.cash.countedCents != null && (
                <>
                  <Row label="Counted" value={fmt(report.cash.countedCents)} />
                  <Row
                    bold
                    label="VARIANCE"
                    value={fmt(report.cash.varianceCents ?? 0)}
                  />
                </>
              )}
            </div>
            {error && <div className="error">{error}</div>}

            {view === "open" && !movement && (
              <div className="sheet-actions">
                <button className="btn" onClick={() => setMovement({ type: "CASH_IN" })}>
                  + Cash in
                </button>
                <button className="btn" onClick={() => setMovement({ type: "CASH_OUT" })}>
                  − Cash out
                </button>
                <button className="btn primary" onClick={() => setView("count")}>
                  Close shift
                </button>
              </div>
            )}
            {view === "open" && movement && (
              <>
                <input
                  inputMode="decimal"
                  placeholder={`${movement.type === "CASH_IN" ? "Cash in" : "Cash out"} amount (RM)`}
                  value={moveAmount}
                  autoFocus
                  onChange={(e) => setMoveAmount(e.target.value)}
                />
                <input
                  placeholder="Reason"
                  value={moveReason}
                  onChange={(e) => setMoveReason(e.target.value)}
                />
                <div className="sheet-actions">
                  <button className="btn" onClick={() => setMovement(null)}>
                    Back
                  </button>
                  <button
                    className="btn primary"
                    disabled={rm(moveAmount) == null || moveReason.trim().length < 3}
                    onClick={() => void submitMovement()}
                  >
                    Save
                  </button>
                </div>
              </>
            )}
            {view === "done" && (
              <div className="sheet-actions">
                <button className="btn primary" onClick={onClose}>
                  Done
                </button>
              </div>
            )}
          </>
        )}

        {view === "count" && report && (
          <>
            <h2>Close shift — count the drawer</h2>
            <p className="dim-note">
              Count all cash without peeking at the expected amount (blind count).
            </p>
            <input
              inputMode="decimal"
              placeholder="Counted cash (RM)"
              value={countInput}
              autoFocus
              onChange={(e) => setCountInput(e.target.value)}
            />
            {error && <div className="error">{error}</div>}
            <div className="sheet-actions">
              <button className="btn" onClick={() => setView("open")}>
                Back
              </button>
              <button
                className="btn primary"
                disabled={rm(countInput) == null}
                onClick={() => void closeShift()}
              >
                Close & print Z
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`trow ${bold ? "big" : ""}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
