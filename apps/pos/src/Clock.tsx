import { useEffect, useState } from "react";
import { api } from "./api";
import type { Session } from "./types";

interface ClockStatus {
  clockedIn: boolean;
  since: string | null;
  todayHours: number;
}

/** Staff attendance clock — uses the PIN session's identity. */
export default function ClockDialog({
  session,
  onClose,
}: {
  session: Session;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<ClockStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = () =>
    api<ClockStatus>("GET", "/attendance/me", undefined, session.token)
      .then(setStatus)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = async () => {
    setBusy(true);
    setError("");
    try {
      await api("POST", "/attendance/clock", {}, session.token);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>🕐 {session.staff.name}</h2>
        {status && (
          <>
            <div className="change-big" style={{ fontSize: 30, padding: "8px 0" }}>
              {status.clockedIn
                ? `On the clock since ${new Date(status.since!).toLocaleTimeString()}`
                : "Off the clock"}
            </div>
            <p className="dim-note" style={{ textAlign: "center" }}>
              {status.todayHours.toFixed(2)} hours today
            </p>
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => void toggle()}
            >
              {status.clockedIn ? "Clock out" : "Clock in"}
            </button>
          </>
        )}
        {error && <div className="error">{error}</div>}
        <button className="btn link" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
