import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { applyCashRounding, formatCents } from "@pos/shared";
import { db } from "./db";
import { capturedCents, payOrder, remainingCents } from "./store";
import type { OutletConfig } from "./types";

type Method = "CASH" | "CARD" | "QR_WALLET";

export default function TenderDialog({
  orderId,
  outlet,
  online,
  onClose,
}: {
  orderId: string;
  outlet: OutletConfig;
  online: boolean;
  onClose: (completed: boolean) => void;
}) {
  const order = useLiveQuery(() => db.orders.get(orderId), [orderId]);
  const [method, setMethod] = useState<Method>("CASH");
  const [entry, setEntry] = useState(""); // cash tendered, in cents as typed digits
  const [changeDue, setChangeDue] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  if (!order) return null;
  const fmt = (c: number) => formatCents(c, outlet.currency);

  if (changeDue !== null) {
    return (
      <div className="overlay">
        <div className="sheet tender">
          <h2>Change</h2>
          <div className="change-big">{fmt(changeDue)}</div>
          <button className="btn primary" onClick={() => onClose(true)}>
            Done
          </button>
        </div>
      </div>
    );
  }

  const remaining = remainingCents(order);
  const cashDue = applyCashRounding(remaining, outlet.cashRounding).roundedTotalCents;
  const tendered = entry === "" ? cashDue : parseInt(entry, 10);
  const quickAmounts = [cashDue, 1000, 2000, 5000, 10000].filter(
    (v, i, a) => a.indexOf(v) === i && v >= cashDue,
  );

  const confirm = async () => {
    setBusy(true);
    try {
      const { order: updated, payment } = await payOrder(
        order,
        outlet,
        method,
        method === "CASH" ? tendered : undefined,
      );
      if (updated.status === "COMPLETED") {
        if ((payment.changeCents ?? 0) > 0) setChangeDue(payment.changeCents!);
        else onClose(true);
      } else {
        // Partial payment (split tender): stay open showing the new balance.
        setEntry("");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={() => onClose(false)}>
      <div className="sheet tender" onClick={(e) => e.stopPropagation()}>
        <h2>Payment</h2>
        <div className="trow big">
          <span>Due</span>
          <span>{fmt(method === "CASH" ? cashDue : remaining)}</span>
        </div>
        {method === "CASH" && cashDue !== remaining && (
          <div className="trow muted">
            <span>Rounding</span>
            <span>{fmt(cashDue - remaining)}</span>
          </div>
        )}
        {capturedCents(order) > 0 && (
          <div className="trow muted">
            <span>Paid so far</span>
            <span>{fmt(capturedCents(order))}</span>
          </div>
        )}

        <div className="methods">
          {(
            [
              ["CASH", "Cash", true],
              ["CARD", "Card", online],
              ["QR_WALLET", "QR / eWallet", online],
            ] as [Method, string, boolean][]
          ).map(([m, label, enabled]) => (
            <button
              key={m}
              className={`btn tab ${method === m ? "active" : ""}`}
              disabled={!enabled}
              onClick={() => setMethod(m)}
            >
              {label}
              {!enabled && <small> (offline)</small>}
            </button>
          ))}
        </div>

        {method === "CASH" && (
          <>
            <div className="tendered">
              Tendered: <b>{fmt(tendered)}</b>
              {tendered >= cashDue && (
                <span className="change-hint">change {fmt(tendered - cashDue)}</span>
              )}
            </div>
            <div className="quick">
              {quickAmounts.map((amt) => (
                <button key={amt} className="btn" onClick={() => setEntry(String(amt))}>
                  {amt === cashDue ? "Exact" : fmt(amt)}
                </button>
              ))}
            </div>
            <div className="pinpad">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "⌫"].map(
                (key) => (
                  <button
                    key={key}
                    className="btn"
                    onClick={() =>
                      setEntry((prev) =>
                        key === "⌫" ? prev.slice(0, -1) : (prev + key).slice(0, 8),
                      )
                    }
                  >
                    {key}
                  </button>
                ),
              )}
            </div>
          </>
        )}

        <div className="sheet-actions">
          <button className="btn" onClick={() => onClose(false)}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={busy || (method === "CASH" && tendered <= 0)}
            onClick={() => void confirm()}
          >
            {method === "CASH" && tendered < cashDue
              ? `Partial ${fmt(tendered)}`
              : `Charge ${fmt(method === "CASH" ? cashDue : remaining)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
