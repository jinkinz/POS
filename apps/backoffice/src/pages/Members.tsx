import { useCallback, useEffect, useState } from "react";
import { formatCents } from "@pos/shared";
import { api } from "../api";

interface Member {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  active: boolean;
  pointsBalance: number;
  lifetimeSpendCents: number;
  visits: number;
  lastVisitAt: string | null;
  createdAt: string;
}

interface MemberDetail extends Member {
  transactions: {
    id: string;
    type: string;
    points: number;
    reason: string | null;
    createdAt: string;
  }[];
  orders: {
    id: string;
    orderNo: number | null;
    status: string;
    totalCents: number;
    roundingCents: number;
    openedAt: string;
  }[];
}

const fmt = (c: number) => formatCents(c, "MYR");

export default function Members() {
  const [rows, setRows] = useState<Member[]>([]);
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<MemberDetail | null>(null);

  const reload = useCallback(
    () =>
      api<Member[]>(
        "GET",
        `/admin/members${search ? `?search=${encodeURIComponent(search)}` : ""}`,
      ).then(setRows),
    [search],
  );
  useEffect(() => {
    const t = setTimeout(() => void reload(), 250);
    return () => clearTimeout(t);
  }, [reload]);

  const adjust = async (m: Member) => {
    const raw = prompt(`Adjust points for ${m.name ?? m.phone} (e.g. 100 or -50)?`);
    if (!raw) return;
    const points = parseInt(raw, 10);
    if (!Number.isFinite(points) || points === 0) return;
    const reason = prompt("Reason?");
    if (!reason) return;
    try {
      await api("POST", `/admin/members/${m.id}/points-adjust`, { points, reason });
      void reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <div>
      <div className="page-head">
        <h1>Members</h1>
        <input
          style={{ maxWidth: 260 }}
          placeholder="Search name or phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <section className="panel">
        <table>
          <thead>
            <tr>
              <th>Member</th>
              <th>Phone</th>
              <th>Points</th>
              <th>Visits</th>
              <th>Lifetime spend</th>
              <th>Last visit</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} className={m.active ? "" : "inactive"}>
                <td>{m.name ?? <span className="dim">—</span>}</td>
                <td className="dim">{m.phone}</td>
                <td className="num">
                  <b>{m.pointsBalance.toLocaleString()}</b>
                </td>
                <td className="num dim">{m.visits}</td>
                <td className="num">{fmt(m.lifetimeSpendCents)}</td>
                <td className="dim">
                  {m.lastVisitAt ? new Date(m.lastVisitAt).toLocaleDateString() : "—"}
                </td>
                <td>
                  <span className="row-actions">
                    <button
                      className="btn small"
                      onClick={() =>
                        void api<MemberDetail>("GET", `/members/${m.id}`).then(setDetail)
                      }
                    >
                      View
                    </button>
                    <button className="btn small" onClick={() => void adjust(m)}>
                      ± Points
                    </button>
                    <button
                      className="btn small"
                      onClick={async () => {
                        await api("PATCH", `/admin/members/${m.id}`, {
                          active: !m.active,
                        });
                        void reload();
                      }}
                    >
                      {m.active ? "Deactivate" : "Activate"}
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="dim">No members yet.</p>}
      </section>

      {detail && (
        <div className="overlay" onClick={() => setDetail(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>
              {detail.name ?? "Member"} · {detail.phone}
            </h2>
            <p className="dim">
              ⭐ {detail.pointsBalance} pts · {detail.visits} visits ·{" "}
              {fmt(detail.lifetimeSpendCents)} lifetime · joined{" "}
              {new Date(detail.createdAt).toLocaleDateString()}
            </p>
            <h2 style={{ fontSize: 14 }}>Points history</h2>
            <table>
              <tbody>
                {detail.transactions.map((t) => (
                  <tr key={t.id}>
                    <td className="dim">{new Date(t.createdAt).toLocaleString()}</td>
                    <td>
                      {t.type} {t.reason ? `· ${t.reason}` : ""}
                    </td>
                    <td className="num">
                      <b>{t.points > 0 ? `+${t.points}` : t.points}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h2 style={{ fontSize: 14 }}>Recent orders</h2>
            <table>
              <tbody>
                {detail.orders.map((o) => (
                  <tr key={o.id}>
                    <td className="dim">{new Date(o.openedAt).toLocaleString()}</td>
                    <td>#{o.orderNo ?? "—"}</td>
                    <td className="dim">{o.status}</td>
                    <td className="num">{fmt(o.totalCents + o.roundingCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
