import { describe, it, expect } from "vitest";
import { returnsFromBars, technicalFromBars, benchmarkFromBars, identityFromScreen, eventsFromCalendar } from "../../lib/ai/packetInputs.mjs";
import { buildMarketPacket } from "../../lib/ai/marketPacket.mjs";

const series = (n, f) => Array.from({ length: n }, (_, i) => ({ c: f(i) }));

describe("packetInputs — evidence the panel already holds", () => {
  it("returns over 1d/5d/1m/3m/6m/12m from daily closes", () => {
    const r = returnsFromBars(series(300, (i) => 100 + i));   // last = 399
    expect(r.d1).toBeCloseTo(((399 / 398) - 1) * 100, 2);
    expect(r.m12).toBeCloseTo(((399 / 147) - 1) * 100, 2);
    expect(returnsFromBars(series(10, (i) => 100 + i)).m1).toBeNull();
    expect(returnsFromBars([])).toBeNull();
  });
  it("technicals: SMAs and the deepest fall over a year", () => {
    const t = technicalFromBars(series(260, (i) => (i < 200 ? 100 : 80)), { momentum_252d_pct: 12 });
    expect(t.sma20).toBe(80);
    expect(t.max_drawdown_pct).toBe(-20);
    expect(t.momentum_252d_pct).toBe(12);
    expect(technicalFromBars(series(5, () => 1))).toBeNull();
  });
  it("benchmark: 12-month return and the gap to it", () => {
    const b = benchmarkFromBars(series(300, (i) => 100 + i), series(300, () => 50));
    expect(b.symbol).toBe("SPUS");
    expect(b.return_m12_pct).toBe(0);
    expect(b.relative_m12_pct).toBeCloseTo(171.43, 2);
    expect(benchmarkFromBars(series(300, () => 1), [])).toBeNull();
  });
  it("identity from the screen, null when it knows nothing", () => {
    expect(identityFromScreen({ industry: "Semiconductors" })).toMatchObject({ sector: "Semiconductors", asset_class: "us_equity" });
    expect(identityFromScreen({})).toBeNull();
    expect(identityFromScreen(null)).toBeNull();
  });
  it("events: the next earnings date, an empty window is stated, an unreachable calendar is missing", () => {
    const cal = [{ symbol: "MU", date: "2026-10-20" }, { symbol: "MU", date: "2026-09-01" }, { symbol: "AMD", date: "2026-10-12" }];
    expect(eventsFromCalendar(cal, "mu", "2026-10-09")).toEqual({ next_earnings_date: "2026-10-20", days_to_earnings: 11, earnings_window_days: 30 });
    expect(eventsFromCalendar(cal, "LRCX", "2026-10-09").note).toBe("no earnings in the next 30 days");
    expect(eventsFromCalendar(null, "MU", "2026-10-09")).toBeNull();
  });
  it("a packet built from them no longer lists those sections as NOT AVAILABLE", () => {
    const s = series(300, (i) => 100 + i);
    const p = buildMarketPacket({ symbol: "MU", asOf: "2026-10-09T13:00:00Z", sharia: { verdict: "halal" },
      returns: returnsFromBars(s), benchmark: benchmarkFromBars(s, series(300, () => 50)),
      identity: identityFromScreen({ industry: "Semiconductors" }), events: eventsFromCalendar([], "MU", "2026-10-09") });
    expect(p.ok).toBe(true);
    for (const k of ["returns", "benchmark", "identity", "events"]) expect(p.packet.missing).not.toContain(k);
  });
});
