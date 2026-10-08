import { describe, it, expect } from "vitest";
import { strategyCurve, closeOn } from "../../lib/trading/curve.mjs";

const days = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"];
const closes = {
  SPUS: { "2026-10-05": 50, "2026-10-06": 51, "2026-10-07": 50.5, "2026-10-08": 52 },
  AAA: { "2026-10-06": 10, "2026-10-07": 11, "2026-10-08": 12 },
};

describe("strategyCurve", () => {
  it("rebuilds daily return from the ledger, with SPUS from the close before the first fill", () => {
    const ledger = [{ side: "buy", qty: 100, suggested_price: 10, status: "executed", ticker: "AAA", day: "2026-10-06" }];
    const { startedOn, points } = strategyCurve({ capital: 10000, ledger, closes, days });
    expect(startedOn).toBe("2026-10-06");
    expect(points[0]).toEqual({ day: "2026-10-05", returnPct: 0, benchPct: 0 });
    // 9,000 cash + 100 × 11 = 10,100 → +1%
    expect(points.find((p) => p.day === "2026-10-07")).toEqual({ day: "2026-10-07", returnPct: 1, benchPct: 1 });
    expect(points.at(-1)).toEqual({ day: "2026-10-08", returnPct: 2, benchPct: 4 });
  });

  it("books a sale's proceeds into cash and stops holding the name", () => {
    const ledger = [
      { side: "buy", qty: 100, suggested_price: 10, status: "executed", ticker: "AAA", day: "2026-10-06" },
      { side: "sell", qty: 100, suggested_price: 11, status: "executed", ticker: "AAA", day: "2026-10-07" },
    ];
    const { points } = strategyCurve({ capital: 10000, ledger, closes, days });
    expect(points.at(-1).returnPct).toBe(1); // cash 10,100, nothing held on Oct 8
  });

  it("omits a day a held name has no close, instead of valuing it at zero", () => {
    const ledger = [{ side: "buy", qty: 10, suggested_price: 5, status: "executed", ticker: "ZZZ", day: "2026-10-07" }];
    const c = { ...closes, ZZZ: { "2026-10-08": 6 } };
    const { points } = strategyCurve({ capital: 1000, ledger, closes: c, days });
    expect(points.map((p) => p.day)).toEqual(["2026-10-06", "2026-10-08"]);
  });

  it("is empty before the first fill and for an unfunded strategy", () => {
    expect(strategyCurve({ capital: 1000, ledger: [], closes, days }).points).toEqual([]);
    const ledger = [{ side: "buy", qty: 1, suggested_price: 10, status: "executed", ticker: "AAA", day: "2026-10-06" }];
    expect(strategyCurve({ capital: 0, ledger, closes, days }).points).toEqual([]);
  });

  it("counts a submitted order's cash but not its shares, as strategyScore does", () => {
    const ledger = [
      { side: "buy", qty: 1, suggested_price: 10, status: "executed", ticker: "AAA", day: "2026-10-06" },
      { side: "buy", qty: 50, suggested_price: 10, status: "submitted", ticker: "AAA", day: "2026-10-08" },
    ];
    const { points } = strategyCurve({ capital: 1000, ledger, closes, days });
    // cash 1000 − 10 − 500 = 490, plus 1 × 12 → −49.8%
    expect(points.at(-1).returnPct).toBe(-49.8);
  });

  it("survives junk input", () => {
    expect(strategyCurve(null)).toEqual({ startedOn: null, points: [] });
    expect(strategyCurve({ capital: "x", ledger: {}, closes: null, days: "no" }).points).toEqual([]);
    expect(closeOn(null, "A", "2026-10-08")).toBeNull();
  });
});
