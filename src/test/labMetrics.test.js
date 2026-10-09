import { describe, it, expect } from "vitest";
import { dailyReturnsFromPoints, sortinoRatio, riskFromPoints, winRate, MIN_RISK_DAYS } from "../lib/labMetrics.js";

const pts = (vals) => vals.map((v, i) => ({ t: i * 86400000, v }));

describe("labMetrics", () => {
  it("daily returns skip holes and zeros", () => {
    expect(dailyReturnsFromPoints(pts([100, 110, null, 99]))).toEqual([0.10000000000000009, -0.09999999999999998]);
    expect(dailyReturnsFromPoints(null)).toEqual([]);
  });
  it("Sortino uses only the down days, and is null with none", () => {
    expect(sortinoRatio([0.01, 0.02, 0.01])).toBeNull();
    expect(sortinoRatio([0.02, -0.01, 0.02, -0.01])).toBeGreaterThan(0);
  });
  it("says NOT YET instead of a ratio from a few days", () => {
    expect(riskFromPoints(pts([100, 101, 102]))).toEqual({ ready: false, days: 2, needed: MIN_RISK_DAYS });
    const r = riskFromPoints(pts(Array.from({ length: 30 }, (_, i) => 100 * (1 + (i % 3 === 0 ? -0.004 : 0.003)) ** i)));
    expect(r.ready).toBe(true);
    expect(r.days).toBe(29);
    expect(Number.isFinite(r.sharpe)).toBe(true);
    expect(r.maxDrawdown).toBeGreaterThanOrEqual(0);
  });
  it("win rate from closed round trips, null before any close", () => {
    expect(winRate({ closed_count: 4, wins: 3, losses: 1, realized_pnl: 120.5 })).toEqual({ closed: 4, wins: 3, losses: 1, rate: 75, realized: 120.5 });
    expect(winRate({ closed_count: 0 })).toBeNull();
    expect(winRate(null)).toBeNull();
  });
});
