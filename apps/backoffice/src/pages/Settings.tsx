import { useEffect, useState } from "react";
import { api } from "../api";
import type { Outlet } from "../types";

interface Company {
  name: string;
  country: string;
  currency: string;
  timezone: string;
  loyaltyEarnPerCurrencyUnit: number;
  loyaltyRedeemCentsPerPoint: number;
}

export default function Settings({
  outlet,
  onChanged,
}: {
  outlet: Outlet;
  onChanged: () => void;
}) {
  const [company, setCompany] = useState<Company | null>(null);
  const [earn, setEarn] = useState("");
  const [redeem, setRedeem] = useState("");
  const [svc, setSvc] = useState("");
  const [tax, setTax] = useState("");
  const [taxInclusive, setTaxInclusive] = useState(outlet.taxInclusive);
  const [svcTaxable, setSvcTaxable] = useState(outlet.serviceChargeTaxable);
  const [rounding, setRounding] = useState(outlet.cashRounding);
  const [saved, setSaved] = useState("");

  useEffect(() => {
    void api<Company>("GET", "/admin/company").then((c) => {
      setCompany(c);
      setEarn(String(c.loyaltyEarnPerCurrencyUnit));
      setRedeem(String(c.loyaltyRedeemCentsPerPoint));
    });
  }, []);

  useEffect(() => {
    setSvc((outlet.serviceChargeBps / 100).toString());
    setTax((outlet.taxBps / 100).toString());
    setTaxInclusive(outlet.taxInclusive);
    setSvcTaxable(outlet.serviceChargeTaxable);
    setRounding(outlet.cashRounding);
  }, [outlet]);

  const flash = (msg: string) => {
    setSaved(msg);
    setTimeout(() => setSaved(""), 2500);
  };

  const saveCompany = async () => {
    await api("PATCH", "/admin/company", {
      loyaltyEarnPerCurrencyUnit: parseInt(earn || "1", 10),
      loyaltyRedeemCentsPerPoint: parseInt(redeem || "1", 10),
    });
    flash("Loyalty settings saved");
  };

  const saveOutlet = async () => {
    await api("PATCH", `/admin/outlets/${outlet.id}`, {
      serviceChargeBps: Math.round(parseFloat(svc || "0") * 100),
      taxBps: Math.round(parseFloat(tax || "0") * 100),
      taxInclusive,
      serviceChargeTaxable: svcTaxable,
      cashRounding: rounding,
    });
    flash("Outlet settings saved — terminals pick this up on next menu refresh");
    onChanged();
  };

  if (!company) return <p className="dim">Loading…</p>;

  return (
    <div>
      <div className="page-head">
        <h1>Settings</h1>
        {saved && <span className="chip ok">{saved}</span>}
      </div>

      <section className="panel">
        <h2>Company · {company.name}</h2>
        <p className="dim">
          {company.country} · {company.currency} · {company.timezone}
        </p>
        <div className="two-col" style={{ maxWidth: 560, marginTop: 10 }}>
          <label className="dim">
            Points earned per {company.currency === "MYR" ? "RM" : "S$"}1 spent
            <input
              type="number"
              min={0}
              value={earn}
              onChange={(e) => setEarn(e.target.value)}
            />
          </label>
          <label className="dim">
            Redemption value per point (sen/cents)
            <input
              type="number"
              min={1}
              value={redeem}
              onChange={(e) => setRedeem(e.target.value)}
            />
          </label>
        </div>
        <div style={{ marginTop: 10 }}>
          <button className="btn primary" onClick={() => void saveCompany()}>
            Save loyalty settings
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>Outlet · {outlet.name}</h2>
        <div className="two-col" style={{ maxWidth: 560, marginTop: 10 }}>
          <label className="dim">
            Service charge (%)
            <input
              type="number"
              step="0.5"
              min={0}
              value={svc}
              onChange={(e) => setSvc(e.target.value)}
            />
          </label>
          <label className="dim">
            Tax — SST/GST (%)
            <input
              type="number"
              step="0.5"
              min={0}
              value={tax}
              onChange={(e) => setTax(e.target.value)}
            />
          </label>
        </div>
        <div style={{ display: "flex", gap: 20, marginTop: 12, flexWrap: "wrap" }}>
          <label className="check">
            <input
              type="checkbox"
              checked={taxInclusive}
              onChange={(e) => setTaxInclusive(e.target.checked)}
            />
            Menu prices include tax
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={svcTaxable}
              onChange={(e) => setSvcTaxable(e.target.checked)}
            />
            Tax applies on service charge
          </label>
          <label className="check">
            Cash rounding
            <select value={rounding} onChange={(e) => setRounding(e.target.value)}>
              <option value="NONE">None</option>
              <option value="MY_5_SEN">Malaysia 5 sen</option>
            </select>
          </label>
        </div>
        <div style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={() => void saveOutlet()}>
            Save outlet settings
          </button>
        </div>
      </section>
    </div>
  );
}
