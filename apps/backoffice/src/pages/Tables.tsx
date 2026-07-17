import QRCode from "qrcode";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { DiningTable, Outlet } from "../types";

const QR_BASE_KEY = "backoffice.qrBase";

function defaultQrBase(): string {
  return `${location.protocol}//${location.hostname}:5175/?t=`;
}

export default function Tables({ outlet }: { outlet: Outlet }) {
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [qrBase, setQrBase] = useState(
    () => localStorage.getItem(QR_BASE_KEY) ?? defaultQrBase(),
  );
  const [qrImages, setQrImages] = useState<Record<string, string>>({});

  const reload = useCallback(
    () => api<DiningTable[]>("GET", `/outlets/${outlet.id}/tables`).then(setTables),
    [outlet.id],
  );
  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    localStorage.setItem(QR_BASE_KEY, qrBase);
    let cancelled = false;
    void (async () => {
      const images: Record<string, string> = {};
      for (const t of tables) {
        images[t.id] = await QRCode.toDataURL(qrBase + t.qrToken, {
          width: 220,
          margin: 1,
        });
      }
      if (!cancelled) setQrImages(images);
    })();
    return () => {
      cancelled = true;
    };
  }, [tables, qrBase]);

  const addTable = async () => {
    const name = prompt("Table name (e.g. T5)?");
    if (!name) return;
    const zone = prompt("Zone (optional)?") ?? undefined;
    await api("POST", `/admin/outlets/${outlet.id}/tables`, {
      name,
      zone: zone || undefined,
    });
    void reload();
  };

  return (
    <div>
      <div className="page-head no-print">
        <h1>Tables & QR codes · {outlet.name}</h1>
        <div className="row-actions">
          <button className="btn" onClick={() => void addTable()}>
            + Table
          </button>
          <button className="btn primary" onClick={() => window.print()}>
            🖨 Print QR sheets
          </button>
        </div>
      </div>
      <label className="qr-base no-print">
        Ordering URL prefix (what the QR encodes)
        <input value={qrBase} onChange={(e) => setQrBase(e.target.value)} />
      </label>

      <div className="qr-grid">
        {tables.map((t) => (
          <div key={t.id} className="qr-card">
            <h2>Table {t.name}</h2>
            {t.zone && <span className="dim">{t.zone}</span>}
            {qrImages[t.id] ? (
              <img src={qrImages[t.id]} alt={`QR for table ${t.name}`} />
            ) : (
              <div className="qr-placeholder" />
            )}
            <p className="scan-hint">Scan to order 📱</p>
            <p className="dim outlet-name">{outlet.name}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
