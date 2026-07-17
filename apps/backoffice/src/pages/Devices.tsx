import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { Device, Outlet } from "../types";

export default function Devices({ outlets }: { outlets: Outlet[] }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [freshToken, setFreshToken] = useState<{ name: string; token: string } | null>(
    null,
  );

  const reload = useCallback(() => api<Device[]>("GET", "/devices").then(setDevices), []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const outletName = (id: string) => outlets.find((o) => o.id === id)?.name ?? "—";

  return (
    <div>
      <div className="page-head">
        <h1>Devices</h1>
        <button className="btn primary" onClick={() => setShowNew(true)}>
          + Register device
        </button>
      </div>

      <section className="panel">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Kind</th>
              <th>Outlet</th>
              <th>Last seen</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.id} className={d.active ? "" : "inactive"}>
                <td>{d.name}</td>
                <td className="dim">{d.kind}</td>
                <td className="dim">{outletName(d.outletId)}</td>
                <td className="dim">
                  {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : "never"}
                </td>
                <td>
                  <span className={`chip ${d.active ? "ok" : "warn"}`}>
                    {d.active ? "active" : "revoked"}
                  </span>
                </td>
                <td>
                  {d.active && (
                    <button
                      className="btn small"
                      onClick={async () => {
                        if (!confirm(`Revoke "${d.name}"? Its logins stop working.`))
                          return;
                        await api("POST", `/devices/${d.id}/revoke`, {});
                        void reload();
                      }}
                    >
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {showNew && (
        <NewDeviceDialog
          outlets={outlets}
          onClose={(token, name) => {
            setShowNew(false);
            if (token && name) setFreshToken({ token, name });
            void reload();
          }}
        />
      )}

      {freshToken && (
        <div className="overlay">
          <div className="dialog">
            <h2>Device token for “{freshToken.name}”</h2>
            <p className="dim">
              Paste this into the terminal's setup screen. It is shown{" "}
              <b>only once</b>.
            </p>
            <code className="token">{freshToken.token}</code>
            <div className="row-actions">
              <button
                className="btn"
                onClick={() => void navigator.clipboard.writeText(freshToken.token)}
              >
                Copy
              </button>
              <button className="btn primary" onClick={() => setFreshToken(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NewDeviceDialog({
  outlets,
  onClose,
}: {
  outlets: Outlet[];
  onClose: (token?: string, name?: string) => void;
}) {
  const [name, setName] = useState("");
  const [outletId, setOutletId] = useState(outlets[0]?.id ?? "");
  const [kind, setKind] = useState("POS");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await api<{ deviceToken: string }>("POST", "/devices", {
        outletId,
        name,
        kind,
      });
      onClose(res.deviceToken, name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={() => onClose()}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Register device</h2>
        <label>
          Name
          <input
            value={name}
            placeholder="Counter iPad 1"
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Outlet
          <select value={outletId} onChange={(e) => setOutletId(e.target.value)}>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Kind
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="POS">POS terminal</option>
            <option value="KDS">Kitchen display</option>
            <option value="PRINT_BRIDGE">Print bridge</option>
          </select>
        </label>
        {error && <div className="error">{error}</div>}
        <div className="row-actions">
          <button className="btn" onClick={() => onClose()}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={busy || name.length < 2}
            onClick={() => void submit()}
          >
            Register
          </button>
        </div>
      </div>
    </div>
  );
}
