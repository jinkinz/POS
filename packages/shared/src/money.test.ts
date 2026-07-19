import { describe, expect, it } from "vitest";
import {
  applyCashRounding,
  computeOrderTotals,
  formatCents,
  lineTotalCents,
} from "./money";
import type { TotalsConfig } from "./types";

const myConfig: TotalsConfig = {
  serviceChargeBps: 1000, // 10%
  taxBps: 600, // SST 6% (MY F&B service tax)
  taxInclusive: false,
  serviceChargeTaxable: true,
  cashRounding: "MY_5_SEN",
};

const sgConfig: TotalsConfig = {
  serviceChargeBps: 1000,
  taxBps: 900, // GST 9%
  taxInclusive: false,
  serviceChargeTaxable: true,
  cashRounding: "NONE",
};

describe("lineTotalCents", () => {
  it("multiplies unit price plus modifiers by quantity", () => {
    expect(
      lineTotalCents({ unitPriceCents: 1000, quantity: 2, modifierDeltaCents: 150 }),
    ).toBe(2300);
  });
});

describe("computeOrderTotals — MY (SST 6%, exclusive)", () => {
  it("RM10.00 item: +10% svc, 6% tax on 11.00", () => {
    const t = computeOrderTotals([{ unitPriceCents: 1000, quantity: 1 }], myConfig);
    expect(t.subtotalCents).toBe(1000);
    expect(t.serviceChargeCents).toBe(100);
    expect(t.taxCents).toBe(66);
    expect(t.totalCents).toBe(1166);
  });

  it("no service charge when disabled", () => {
    const t = computeOrderTotals(
      [{ unitPriceCents: 1000, quantity: 1 }],
      { ...myConfig, serviceChargeBps: 0 },
    );
    expect(t.serviceChargeCents).toBe(0);
    expect(t.taxCents).toBe(60);
    expect(t.totalCents).toBe(1060);
  });
});

describe("computeOrderTotals — SG (GST 9%, exclusive)", () => {
  it("S$25.50: +10% svc = 28.05, GST 9% = 2.52(.45 rounds up)", () => {
    const t = computeOrderTotals([{ unitPriceCents: 2550, quantity: 1 }], sgConfig);
    expect(t.serviceChargeCents).toBe(255);
    expect(t.taxCents).toBe(252); // 2805 * 9% = 252.45 -> 252
    expect(t.totalCents).toBe(3057);
  });
});

describe("computeOrderTotals — discounts (pre-tax)", () => {
  it("RM24 subtotal, RM2.40 off: svc and tax on discounted base", () => {
    const t = computeOrderTotals(
      [{ unitPriceCents: 1200, quantity: 2 }],
      myConfig,
      240,
    );
    expect(t.subtotalCents).toBe(2400);
    expect(t.discountCents).toBe(240);
    expect(t.serviceChargeCents).toBe(216); // 10% of 21.60
    expect(t.taxCents).toBe(143); // 6% of 23.76 = 1.4256 -> 143
    expect(t.totalCents).toBe(2519); // 21.60 + 2.16 + 1.43
  });

  it("discount clamps to subtotal and never below zero", () => {
    const big = computeOrderTotals(
      [{ unitPriceCents: 500, quantity: 1 }],
      myConfig,
      99999,
    );
    expect(big.discountCents).toBe(500);
    expect(big.totalCents).toBe(0);
    const neg = computeOrderTotals(
      [{ unitPriceCents: 500, quantity: 1 }],
      myConfig,
      -100,
    );
    expect(neg.discountCents).toBe(0);
  });
});

describe("computeOrderTotals — tax inclusive", () => {
  it("extracts GST portion without changing the total", () => {
    const t = computeOrderTotals([{ unitPriceCents: 1090, quantity: 1 }], {
      ...sgConfig,
      serviceChargeBps: 0,
      taxInclusive: true,
    });
    expect(t.totalCents).toBe(1090);
    expect(t.taxCents).toBe(90); // 10.90 gross contains 0.90 GST at 9%
  });
});

describe("applyCashRounding — MY 5 sen", () => {
  it.each([
    [1001, 1000, -1],
    [1002, 1000, -2],
    [1003, 1005, 2],
    [1004, 1005, 1],
    [1005, 1005, 0],
    [1006, 1005, -1],
    [1007, 1005, -2],
    [1008, 1010, 2],
    [1009, 1010, 1],
  ])("%i sen -> %i (adj %i)", (input, rounded, adj) => {
    const r = applyCashRounding(input, "MY_5_SEN");
    expect(r.roundedTotalCents).toBe(rounded);
    expect(r.roundingAdjustmentCents).toBe(adj);
  });

  it("NONE mode is a no-op", () => {
    expect(applyCashRounding(1002, "NONE")).toEqual({
      roundedTotalCents: 1002,
      roundingAdjustmentCents: 0,
    });
  });
});

describe("formatCents", () => {
  it("formats MYR and SGD", () => {
    expect(formatCents(1234567, "MYR")).toBe("RM12,345.67");
    expect(formatCents(905, "SGD")).toBe("S$9.05");
    expect(formatCents(-250, "MYR")).toBe("-RM2.50");
  });
});
