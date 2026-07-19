import { useState } from "react";
import { api } from "./api";
import type { MemberSummary } from "./types";

/** Phone-first member lookup with instant registration for walk-ins. */
export default function MemberDialog({
  token,
  online,
  onSelect,
  onClose,
}: {
  token: string;
  online: boolean;
  onSelect: (member: MemberSummary) => void | Promise<void>;
  onClose: () => void;
}) {
  const [phone, setPhone] = useState("");
  const [found, setFound] = useState<MemberSummary | null | "none">(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const search = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await api<{ member: MemberSummary | null }>(
        "GET",
        `/members?phone=${encodeURIComponent(phone)}`,
        undefined,
        token,
      );
      setFound(res.member ?? "none");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lookup failed");
    } finally {
      setBusy(false);
    }
  };

  const register = async () => {
    setBusy(true);
    setError("");
    try {
      const member = await api<MemberSummary>(
        "POST",
        "/members",
        { phone, name: name.trim() || undefined },
        token,
      );
      await onSelect(member);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Registration failed");
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>Member</h2>
        {!online && <div className="error">Member lookup needs a connection.</div>}
        <input
          inputMode="tel"
          placeholder="Phone number"
          value={phone}
          autoFocus
          onChange={(e) => {
            setPhone(e.target.value);
            setFound(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && phone.length >= 7) void search();
          }}
        />
        {found === null && (
          <button
            className="btn primary"
            disabled={busy || !online || phone.replace(/\D/g, "").length < 7}
            onClick={() => void search()}
          >
            Search
          </button>
        )}

        {found && found !== "none" && (
          <>
            <div className="member-card">
              <b>{found.name ?? "Member"}</b>
              <span className="dim-note">{found.phone}</span>
              <span className="dim-note">
                ⭐ {found.pointsBalance} pts · {found.visits} visits
              </span>
            </div>
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => void onSelect(found)}
            >
              Use this member
            </button>
          </>
        )}

        {found === "none" && (
          <>
            <p className="dim-note">Not a member yet — register in one tap.</p>
            <input
              placeholder="Name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button
              className="btn primary"
              disabled={busy || !online}
              onClick={() => void register()}
            >
              Register & attach
            </button>
          </>
        )}

        {error && <div className="error">{error}</div>}
        <button className="btn link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
