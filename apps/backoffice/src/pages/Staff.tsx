import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { Staff } from "../types";

const ROLES = ["OWNER", "MANAGER", "CASHIER", "WAITER", "KITCHEN"];

export default function StaffPage() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [editing, setEditing] = useState<Staff | "new" | null>(null);

  const reload = useCallback(() => api<Staff[]>("GET", "/admin/staff").then(setStaff), []);
  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div>
      <div className="page-head">
        <h1>Staff</h1>
        <button className="btn primary" onClick={() => setEditing("new")}>
          + Staff member
        </button>
      </div>

      <section className="panel">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Email</th>
              <th>Login</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id} className={s.active ? "" : "inactive"}>
                <td>{s.name}</td>
                <td className="dim">{s.role}</td>
                <td className="dim">{s.email ?? "—"}</td>
                <td className="dim">
                  {[s.hasPin && "PIN", s.hasPassword && "password"]
                    .filter(Boolean)
                    .join(" + ") || "none"}
                </td>
                <td>
                  <span className={`chip ${s.active ? "ok" : "warn"}`}>
                    {s.active ? "active" : "inactive"}
                  </span>
                </td>
                <td>
                  <button className="btn small" onClick={() => setEditing(s)}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {editing && (
        <StaffDialog
          member={editing === "new" ? null : editing}
          onClose={() => {
            setEditing(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}

function StaffDialog({ member, onClose }: { member: Staff | null; onClose: () => void }) {
  const [name, setName] = useState(member?.name ?? "");
  const [role, setRole] = useState(member?.role ?? "CASHIER");
  const [email, setEmail] = useState(member?.email ?? "");
  const [pin, setPin] = useState("");
  const [password, setPassword] = useState("");
  const [active, setActive] = useState(member?.active ?? true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      if (member) {
        await api("PATCH", `/admin/staff/${member.id}`, {
          name,
          role,
          active,
          pin: pin || undefined,
          password: password || undefined,
        });
      } else {
        await api("POST", "/staff", {
          name,
          role,
          email: email || undefined,
          pin: pin || undefined,
          password: password || undefined,
        });
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>{member ? `Edit ${member.name}` : "New staff member"}</h2>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label>
          Role
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        {!member && (
          <label>
            Email (for back-office login)
            <input value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
        )}
        <label>
          {member ? "New PIN (leave blank to keep)" : "POS PIN (4-6 digits)"}
          <input
            value={pin}
            inputMode="numeric"
            maxLength={6}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          />
        </label>
        <label>
          {member ? "New password (leave blank to keep)" : "Password (optional, min 8)"}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {member && (
          <label className="check">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            Active (can log in)
          </label>
        )}
        {error && <div className="error">{error}</div>}
        <div className="row-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={busy || name.length < 2}
            onClick={() => void save()}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
