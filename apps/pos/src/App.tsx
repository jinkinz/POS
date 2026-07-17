import { useCallback, useState } from "react";
import { api } from "./api";
import SellScreen from "./Sell";
import type { Session } from "./types";

const DEVICE_TOKEN_KEY = "pos.deviceToken";
const SESSION_KEY = "pos.session";

function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [deviceToken, setDeviceToken] = useState<string | null>(
    () => localStorage.getItem(DEVICE_TOKEN_KEY),
  );
  const [session, setSession] = useState<Session | null>(loadSession);

  if (!deviceToken) {
    return (
      <SetupScreen
        onSave={(t) => {
          localStorage.setItem(DEVICE_TOKEN_KEY, t);
          setDeviceToken(t);
        }}
      />
    );
  }
  if (!session) {
    return (
      <PinScreen
        deviceToken={deviceToken}
        onSession={(s) => {
          sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
          setSession(s);
        }}
        onResetDevice={() => {
          localStorage.removeItem(DEVICE_TOKEN_KEY);
          setDeviceToken(null);
        }}
      />
    );
  }
  return (
    <SellScreen
      session={session}
      onLock={() => {
        sessionStorage.removeItem(SESSION_KEY);
        setSession(null);
      }}
    />
  );
}

function SetupScreen({ onSave }: { onSave: (token: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="center-screen">
      <div className="card">
        <h1>POS Terminal Setup</h1>
        <p>
          Register this terminal in the back office (Devices → New → kind POS)
          and paste the device token below. Done once per terminal.
        </p>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value.trim())}
          placeholder="device token"
        />
        <button
          className="btn primary"
          disabled={value.length < 32}
          onClick={() => onSave(value)}
        >
          Save device token
        </button>
      </div>
    </div>
  );
}

function PinScreen({
  deviceToken,
  onSession,
  onResetDevice,
}: {
  deviceToken: string;
  onSession: (s: Session) => void;
  onResetDevice: () => void;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = useCallback(
    async (candidate: string) => {
      setBusy(true);
      setError("");
      try {
        const session = await api<Session>(
          "POST",
          "/auth/pin-login",
          { pin: candidate },
          undefined,
          { "X-Device-Token": deviceToken },
        );
        onSession(session);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Login failed");
        setPin("");
      } finally {
        setBusy(false);
      }
    },
    [deviceToken, onSession],
  );

  return (
    <div className="center-screen">
      <div className="card">
        <h1>Enter PIN</h1>
        <div className="pin-dots">{"●".repeat(pin.length).padEnd(6, "○")}</div>
        {error && <div className="error">{error}</div>}
        <div className="pinpad">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "OK"].map(
            (key) => (
              <button
                key={key}
                className={`btn ${key === "OK" ? "primary" : ""}`}
                disabled={busy || (key === "OK" && pin.length < 4)}
                onClick={() => {
                  if (key === "C") setPin("");
                  else if (key === "OK") void submit(pin);
                  else setPin((p) => (p + key).slice(0, 6));
                }}
              >
                {key}
              </button>
            ),
          )}
        </div>
        <button className="btn link" onClick={onResetDevice}>
          Re-pair device
        </button>
      </div>
    </div>
  );
}
