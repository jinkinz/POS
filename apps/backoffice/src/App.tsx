import { useEffect, useState } from "react";
import { api, getToken, setToken } from "./api";
import Dashboard from "./pages/Dashboard";
import Devices from "./pages/Devices";
import Inventory from "./pages/Inventory";
import Campaigns from "./pages/Campaigns";
import ConsignmentPage from "./pages/Consignment";
import EInvoicePage from "./pages/EInvoice";
import Members from "./pages/Members";
import MenuPage from "./pages/Menu";
import Payroll from "./pages/Payroll";
import SettingsPage from "./pages/Settings";
import Shifts from "./pages/Shifts";
import StaffPage from "./pages/Staff";
import Tables from "./pages/Tables";
import type { Outlet } from "./types";

const PAGES = [
  ["dashboard", "📊 Dashboard"],
  ["shifts", "💰 Shifts"],
  ["members", "🎁 Members"],
  ["campaigns", "🎟 Campaigns"],
  ["menu", "🍜 Menu"],
  ["inventory", "📦 Inventory"],
  ["consignment", "🏷 Consignment"],
  ["tables", "🪑 Tables & QR"],
  ["devices", "📱 Devices"],
  ["staff", "👥 Staff"],
  ["payroll", "🧑‍🍳 Payroll"],
  ["einvoice", "🧾 E-Invoice"],
  ["settings", "⚙️ Settings"],
] as const;

type PageKey = (typeof PAGES)[number][0];

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [page, setPage] = useState<PageKey>(
    () => (location.hash.slice(2) as PageKey) || "dashboard",
  );
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [outletId, setOutletId] = useState<string>("");

  useEffect(() => {
    const onHash = () => setPage((location.hash.slice(2) as PageKey) || "dashboard");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (!authed) return;
    void api<Outlet[]>("GET", "/admin/outlets").then((list) => {
      setOutlets(list);
      setOutletId((cur) => cur || list[0]?.id || "");
    });
  }, [authed]);

  if (!authed) return <Login onDone={() => setAuthed(true)} />;

  const outlet = outlets.find((o) => o.id === outletId);

  return (
    <div className="shell">
      <aside>
        <div className="logo">POS Back Office</div>
        <select value={outletId} onChange={(e) => setOutletId(e.target.value)}>
          {outlets.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <nav>
          {PAGES.map(([key, label]) => (
            <a
              key={key}
              href={`#/${key}`}
              className={page === key ? "active" : ""}
            >
              {label}
            </a>
          ))}
        </nav>
        <button
          className="btn link"
          onClick={() => {
            setToken(null);
            setAuthed(false);
          }}
        >
          Sign out
        </button>
      </aside>
      <main>
        {!outlet ? (
          <p className="dim">Loading…</p>
        ) : page === "dashboard" ? (
          <Dashboard outlet={outlet} />
        ) : page === "shifts" ? (
          <Shifts outlet={outlet} />
        ) : page === "members" ? (
          <Members />
        ) : page === "campaigns" ? (
          <Campaigns />
        ) : page === "menu" ? (
          <MenuPage />
        ) : page === "inventory" ? (
          <Inventory outlet={outlet} />
        ) : page === "consignment" ? (
          <ConsignmentPage />
        ) : page === "tables" ? (
          <Tables outlet={outlet} />
        ) : page === "devices" ? (
          <Devices outlets={outlets} />
        ) : page === "payroll" ? (
          <Payroll />
        ) : page === "einvoice" ? (
          <EInvoicePage outlet={outlet} />
        ) : page === "settings" ? (
          <SettingsPage
            outlet={outlet}
            onChanged={() =>
              void api<Outlet[]>("GET", "/admin/outlets").then(setOutlets)
            }
          />
        ) : (
          <StaffPage />
        )}
      </main>
    </div>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await api<{ token: string }>("POST", "/auth/login", {
        email,
        password,
      });
      setToken(res.token);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center-screen">
      <form className="card" onSubmit={submit}>
        <h1>POS Back Office</h1>
        <input
          type="email"
          placeholder="Email"
          value={email}
          autoFocus
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div className="error">{error}</div>}
        <button className="btn primary" disabled={busy || !email || password.length < 8}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
