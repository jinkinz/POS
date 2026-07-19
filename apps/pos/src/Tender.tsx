import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { applyCashRounding, formatCents } from "@pos/shared";
import { api } from "./api";
import { db } from "./db";
import { applyServerOrder, capturedCents, payOrder, remainingCents } from "./store";
import type { MemberSummary, Order, OutletConfig } from "./types";

type Method = "CASH" | "CARD" | "QR_WALLET";

interface GatewayPayment {
  id: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED" | "EXPIRED" | "CANCELED";
  qrData: string | null;
  checkoutUrl: string | null;
  amountCents: number;
  failReason: string | null;
}

export default function TenderDialog({
  orderId,
  outlet,
  online,
  token,
  onClose,
}: {
  orderId: string;
  outlet: OutletConfig;
  online: boolean;
  token: string;
  onClose: (completed: boolean) => void;
}) {
  const order = useLiveQuery(() => db.orders.get(orderId), [orderId]);
  const [method, setMethod] = useState<Method>("CASH");
  const [entry, setEntry] = useState(""); // cash tendered, in cents as typed digits
  const [changeDue, setChangeDue] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  if (!order) return null;
  const fmt = (c: number) => formatCents(c, outlet.currency);

  // A gateway confirmation (webhook -> socket/poll) completes the order
  // server-side; when the local copy flips, show the confirmation screen.
  const printReceipt = () =>
    void api("POST", `/orders/${orderId}/print`, undefined, token).catch(() => {});

  if (order.status === "COMPLETED" && changeDue === null && method === "QR_WALLET") {
    return (
      <div className="overlay">
        <div className="sheet tender">
          <h2>Payment received ✅</h2>
          <div className="change-big">{fmt(order.totalCents + order.roundingCents)}</div>
          <div className="sheet-actions">
            <button className="btn" onClick={printReceipt}>
              🖨 Receipt
            </button>
            <button className="btn primary" onClick={() => onClose(true)}>
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (changeDue !== null) {
    return (
      <div className="overlay">
        <div className="sheet tender">
          <h2>Change</h2>
          <div className="change-big">{fmt(changeDue)}</div>
          <div className="sheet-actions">
            <button className="btn" onClick={printReceipt}>
              🖨 Receipt
            </button>
            <button className="btn primary" onClick={() => onClose(true)}>
              Done
            </button>
          </div>
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
        method as "CASH" | "CARD",
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

        {online && method !== "QR_WALLET" && capturedCents(order) === 0 && (
          <VoucherRow order={order} token={token} fmt={fmt} />
        )}

        {order.memberId && online && method !== "QR_WALLET" && (
          <RedeemPane
            orderId={orderId}
            memberId={order.memberId}
            outlet={outlet}
            token={token}
            remaining={remaining}
            fmt={fmt}
          />
        )}

        {method === "QR_WALLET" && (
          <GatewayPane orderId={orderId} token={token} fmt={fmt} />
        )}

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
          {method !== "QR_WALLET" && (
            <button
              className="btn primary"
              disabled={busy || (method === "CASH" && tendered <= 0)}
              onClick={() => void confirm()}
            >
              {method === "CASH" && tendered < cashDue
                ? `Partial ${fmt(tendered)}`
                : `Charge ${fmt(method === "CASH" ? cashDue : remaining)}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Apply / remove a voucher or promo code before payment starts. */
function VoucherRow({
  order,
  token,
  fmt,
}: {
  order: { id: string; discountCents: number; voucherCode?: string | null };
  token: string;
  fmt: (c: number) => string;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (method: "POST" | "DELETE", body?: unknown) => {
    setBusy(true);
    setError("");
    try {
      const updated = await api<Order>(
        method,
        `/orders/${order.id}/voucher`,
        body,
        token,
      );
      await applyServerOrder(updated);
      setCode("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Voucher failed");
    } finally {
      setBusy(false);
    }
  };

  if (order.voucherCode) {
    return (
      <div className="redeem-row">
        <span className="dim-note">
          🎟 {order.voucherCode} · −{fmt(order.discountCents)}
        </span>
        <button className="btn" disabled={busy} onClick={() => void run("DELETE")}>
          Remove
        </button>
        {error && <div className="error">{error}</div>}
      </div>
    );
  }

  return (
    <div className="redeem-row">
      <input
        style={{ flex: 1, minWidth: 140 }}
        placeholder="Voucher / promo code"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
      />
      <button
        className="btn"
        disabled={busy || code.trim().length < 3}
        onClick={() => void run("POST", { code: code.trim() })}
      >
        Apply
      </button>
      {error && <div className="error">{error}</div>}
    </div>
  );
}

/** Pay part (or all) of the bill with the attached member's points. */
function RedeemPane({
  orderId,
  memberId,
  outlet,
  token,
  remaining,
  fmt,
}: {
  orderId: string;
  memberId: string;
  outlet: OutletConfig;
  token: string;
  remaining: number;
  fmt: (c: number) => string;
}) {
  const [member, setMember] = useState<MemberSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void api<MemberSummary>("GET", `/members/${memberId}`, undefined, token)
      .then(setMember)
      .catch(() => {});
  }, [memberId, token]);

  if (!member || member.pointsBalance <= 0) return null;
  const rate = outlet.loyaltyRedeemCentsPerPoint;
  const maxPoints = Math.min(member.pointsBalance, Math.floor(remaining / rate));
  if (maxPoints <= 0) return null;

  const redeem = async () => {
    setBusy(true);
    setError("");
    try {
      const updated = await api<Order>(
        "POST",
        `/orders/${orderId}/redeem-points`,
        { points: maxPoints },
        token,
      );
      await applyServerOrder(updated);
      const fresh = await api<MemberSummary>(
        "GET",
        `/members/${memberId}`,
        undefined,
        token,
      );
      setMember(fresh);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Redemption failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="redeem-row">
      <span className="dim-note">
        ⭐ {member.name ?? member.phone}: {member.pointsBalance} pts
      </span>
      <button className="btn" disabled={busy} onClick={() => void redeem()}>
        Redeem {maxPoints} pts (−{fmt(maxPoints * rate)})
      </button>
      {error && <div className="error">{error}</div>}
    </div>
  );
}

/**
 * Dynamic gateway QR: creates a payment intent for the remaining balance,
 * renders its QR, and polls until the webhook confirms. The socket's
 * order.updated usually wins the race; polling is the fallback.
 */
function GatewayPane({
  orderId,
  token,
  fmt,
}: {
  orderId: string;
  token: string;
  fmt: (c: number) => string;
}) {
  const [gp, setGp] = useState<GatewayPayment | null>(null);
  const [qrImg, setQrImg] = useState("");
  const [error, setError] = useState("");
  const gpRef = useRef<GatewayPayment | null>(null);
  gpRef.current = gp;

  useEffect(() => {
    let cancelled = false;
    void api<GatewayPayment>("POST", `/orders/${orderId}/gateway-payments`, {}, token)
      .then((created) => {
        if (!cancelled) setGp(created);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Gateway unavailable"));

    const timer = setInterval(async () => {
      const current = gpRef.current;
      if (!current || current.status !== "PENDING") return;
      try {
        const fresh = await api<GatewayPayment>(
          "GET",
          `/orders/${orderId}/gateway-payments/${current.id}`,
          undefined,
          token,
        );
        if (cancelled) return;
        setGp(fresh);
        if (fresh.status === "SUCCEEDED") {
          const order = await api<Order>("GET", `/orders/${orderId}`, undefined, token);
          await applyServerOrder(order);
        }
      } catch {
        /* poll again */
      }
    }, 2500);

    return () => {
      cancelled = true;
      clearInterval(timer);
      const current = gpRef.current;
      if (current && current.status === "PENDING") {
        void api(
          "POST",
          `/orders/${orderId}/gateway-payments/${current.id}/cancel`,
          {},
          token,
        ).catch(() => {});
      }
    };
  }, [orderId, token]);

  useEffect(() => {
    if (gp?.qrData) {
      void QRCode.toDataURL(gp.qrData, { width: 240, margin: 1 }).then(setQrImg);
    }
  }, [gp?.qrData]);

  if (error) return <div className="error">{error}</div>;
  if (!gp) return <div className="tendered">Contacting payment gateway…</div>;

  return (
    <div className="gateway-pane">
      {gp.status === "PENDING" && (
        <>
          {qrImg ? (
            <img className="gateway-qr" src={qrImg} alt="Payment QR" />
          ) : (
            <div className="tendered">Generating QR…</div>
          )}
          <div className="tendered">
            Ask the customer to scan · <b>{fmt(gp.amountCents)}</b>
          </div>
          <div className="dim-note">Waiting for payment confirmation…</div>
        </>
      )}
      {gp.status === "FAILED" && (
        <div className="error">Payment failed{gp.failReason ? `: ${gp.failReason}` : ""}</div>
      )}
      {gp.status === "EXPIRED" && <div className="error">QR expired — reopen to retry</div>}
    </div>
  );
}
