import { useEffect, useMemo, useState } from "react";
import { formatCents } from "@pos/shared";
import { api } from "../api";
import type { Outlet } from "../types";

interface Analytics {
  from: string;
  to: string;
  bucket: "day" | "month";
  totals: { revenueCents: number; orders: number; averageOrderCents: number };
  previous: {
    revenueCents: number;
    orders: number;
    revenueChangePct: number | null;
    ordersChangePct: number | null;
  };
  series: { bucket: string; revenueCents: number; orders: number }[];
  weekday: { weekday: number; avgRevenueCents: number; orders: number }[];
  hourly: { hour: number; revenueCents: number; orders: number }[];
  items: {
    name: string;
    quantity: number;
    salesCents: number;
    marginPct: number | null;
  }[];
  notSelling: { name: string; priceCents: number }[];
  categories: { name: string; salesCents: number }[];
  payments: { method: string; amountCents: number; count: number }[];
  sources: { source: string; revenueCents: number; orders: number }[];
}

const fmt = (c: number) => formatCents(c, "MYR");
const fmtShort = (c: number) =>
  c >= 100000 ? `RM${(c / 100000).toFixed(1)}k` : fmt(c);
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}
const today = () => daysAgo(0);

const PRESETS: [string, () => { from: string; to: string }][] = [
  ["7 days", () => ({ from: daysAgo(6), to: today() })],
  ["30 days", () => ({ from: daysAgo(29), to: today() })],
  ["90 days", () => ({ from: daysAgo(89), to: today() })],
  ["12 months", () => ({ from: daysAgo(364), to: today() })],
  ["YTD", () => ({ from: `${new Date().getFullYear()}-01-01`, to: today() })],
];

export default function AnalyticsPage({ outlet }: { outlet: Outlet }) {
  const [range, setRange] = useState(() => PRESETS[1]![1]());
  const [preset, setPreset] = useState("30 days");
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    api<Analytics>(
      "GET",
      `/admin/outlets/${outlet.id}/reports/analytics?from=${range.from}&to=${range.to}`,
    )
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [outlet.id, range]);

  return (
    <div className="viz-root">
      <div className="page-head">
        <h1>Analytics · {outlet.name}</h1>
        <div className="row-actions">
          {PRESETS.map(([label, make]) => (
            <button
              key={label}
              className={`btn ${preset === label ? "primary" : ""}`}
              onClick={() => {
                setPreset(label);
                setRange(make());
              }}
            >
              {label}
            </button>
          ))}
          <input
            type="date"
            value={range.from}
            onChange={(e) => {
              setPreset("");
              setRange({ ...range, from: e.target.value });
            }}
          />
          <input
            type="date"
            value={range.to}
            onChange={(e) => {
              setPreset("");
              setRange({ ...range, to: e.target.value });
            }}
          />
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {!data && !error && <p className="dim">Loading…</p>}
      {data && data.totals.orders === 0 && (
        <p className="dim">
          No completed sales in this range. For a demo with history, run{" "}
          <code>pnpm --filter @pos/api demo-history</code> and refresh.
        </p>
      )}
      {data && (
        <>
          <div className="stats">
            <Kpi
              label="Revenue"
              value={fmt(data.totals.revenueCents)}
              change={data.previous.revenueChangePct}
            />
            <Kpi
              label="Orders"
              value={String(data.totals.orders)}
              change={data.previous.ordersChangePct}
            />
            <Kpi label="Average order" value={fmt(data.totals.averageOrderCents)} />
            <Kpi
              label={`Previous ${preset || "period"}`}
              value={fmt(data.previous.revenueCents)}
            />
          </div>

          <section className="panel">
            <h2>Revenue {data.bucket === "day" ? "per day" : "per month"}</h2>
            <BarChart
              data={data.series.map((s) => ({
                label:
                  data.bucket === "day" ? s.bucket.slice(5) : s.bucket,
                value: s.revenueCents,
                tip: `${s.bucket} · ${fmt(s.revenueCents)} · ${s.orders} orders`,
              }))}
              height={160}
              money
            />
          </section>

          <div className="cols">
            <section className="panel">
              <h2>Average revenue by weekday</h2>
              <BarChart
                data={data.weekday.map((w) => ({
                  label: WEEKDAYS[w.weekday]!,
                  value: w.avgRevenueCents,
                  tip: `${WEEKDAYS[w.weekday]} · avg ${fmt(w.avgRevenueCents)}/day · ${w.orders} orders total`,
                }))}
                height={140}
                money
              />
            </section>
            <section className="panel">
              <h2>Revenue by hour of day</h2>
              <BarChart
                data={data.hourly
                  .filter((h) => h.hour >= 6 && h.hour <= 23)
                  .map((h) => ({
                    label: String(h.hour),
                    value: h.revenueCents,
                    tip: `${String(h.hour).padStart(2, "0")}:00 · ${fmt(h.revenueCents)} · ${h.orders} orders`,
                  }))}
                height={140}
                money
              />
            </section>
          </div>

          <div className="cols">
            <section className="panel">
              <h2>Top sellers</h2>
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Qty</th>
                    <th>Sales</th>
                    <th>Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.slice(0, 12).map((i) => (
                    <tr key={i.name}>
                      <td>{i.name}</td>
                      <td className="num dim">{i.quantity}</td>
                      <td className="num">{fmt(i.salesCents)}</td>
                      <td className="num dim">
                        {i.marginPct != null ? `${i.marginPct}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="panel">
              <h2>Not selling in this period</h2>
              {data.notSelling.length === 0 ? (
                <p className="dim">Every active menu item sold at least once. 🎉</p>
              ) : (
                <table>
                  <tbody>
                    {data.notSelling.slice(0, 12).map((p) => (
                      <tr key={p.name}>
                        <td>{p.name}</td>
                        <td className="num dim">{fmt(p.priceCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="dim" style={{ marginTop: 8 }}>
                Candidates to promote, rework, or retire.
              </p>
            </section>
          </div>

          <div className="cols">
            <MixPanel
              title="Categories"
              rows={data.categories.map((c) => ({ label: c.name, value: c.salesCents }))}
            />
            <MixPanel
              title="Payment methods"
              rows={data.payments.map((p) => ({
                label: `${p.method.replace("_", " ")} (${p.count})`,
                value: p.amountCents,
              }))}
            />
            <MixPanel
              title="Order sources"
              rows={data.sources.map((s) => ({
                label: `${s.source} (${s.orders})`,
                value: s.revenueCents,
              }))}
            />
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  change,
}: {
  label: string;
  value: string;
  change?: number | null;
}) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {change != null && (
        <span className={`kpi-delta ${change >= 0 ? "up" : "down"}`}>
          {change >= 0 ? "▲" : "▼"} {Math.abs(change)}% vs previous period
        </span>
      )}
    </div>
  );
}

/**
 * Single-series bar chart (one measure -> one hue, no legend needed).
 * Rounded data-ends, 2px gaps, per-bar hover tooltip, direct label on the peak.
 */
function BarChart({
  data,
  height,
  money,
}: {
  data: { label: string; value: number; tip: string }[];
  height: number;
  money?: boolean;
}) {
  const [tip, setTip] = useState<{ x: number; text: string } | null>(null);
  const max = useMemo(() => Math.max(1, ...data.map((d) => d.value)), [data]);
  const peakIdx = useMemo(
    () => data.findIndex((d) => d.value === max),
    [data, max],
  );
  if (data.length === 0) return <p className="dim">No data.</p>;
  const showEvery = Math.ceil(data.length / 14);

  return (
    <div className="chart-wrap" onMouseLeave={() => setTip(null)}>
      <div className="chart-bars" style={{ height }}>
        {data.map((d, i) => (
          <div
            key={i}
            className="chart-col"
            onMouseEnter={(e) =>
              setTip({
                x: (e.currentTarget as HTMLElement).offsetLeft,
                text: d.tip,
              })
            }
          >
            {i === peakIdx && d.value > 0 && (
              <span className="chart-peak">
                {money ? fmtShort(d.value) : d.value}
              </span>
            )}
            <div
              className="chart-bar"
              style={{ height: `${Math.max(d.value > 0 ? 2 : 0, (d.value / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="chart-labels">
        {data.map((d, i) => (
          <span key={i} className="chart-label">
            {i % showEvery === 0 ? d.label : ""}
          </span>
        ))}
      </div>
      {tip && (
        <div className="chart-tip" style={{ left: Math.min(tip.x, 9999) }}>
          {tip.text}
        </div>
      )}
    </div>
  );
}

/** Horizontal magnitude bars with value labels (single hue). */
function MixPanel({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; value: number }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <section className="panel">
      <h2>{title}</h2>
      {rows.length === 0 && <p className="dim">No data.</p>}
      {rows.map((r) => (
        <div key={r.label} className="mix-row">
          <span className="mix-label">{r.label}</span>
          <div className="mix-track">
            <div className="mix-fill" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
          <span className="mix-value">{fmt(r.value)}</span>
        </div>
      ))}
    </section>
  );
}
