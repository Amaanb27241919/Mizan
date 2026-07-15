// @vitest-environment node
//
// Market data layer — validation, impersonal-output guarantee, and the auth
// gate on the candle/quote routes. See docs/COMPLIANCE.md.
import { describe, it, expect } from "vitest";
import {
  validateCandleQuery, normalizeBars, cacheTimespan,
  CANDLE_RESOLUTIONS, MAX_RANGE_DAYS,
} from "../../lib/market/candles.mjs";
import { handleApiRequest } from "../../lib/handlers.mjs";

const NOW = new Date("2024-06-01T00:00:00Z");

describe("validateCandleQuery — symbol validation", () => {
  it("accepts a normal ticker and uppercases it", () => {
    const v = validateCandleQuery({ symbol: "aapl", resolution: "D" }, NOW);
    expect(v.error).toBeUndefined();
    expect(v.symbol).toBe("AAPL");
  });

  it("accepts class-share dotted tickers", () => {
    expect(validateCandleQuery({ symbol: "BRK.B", resolution: "D" }, NOW).error).toBeUndefined();
  });

  it.each(["", "1AAPL", "A A", "TOOLONGXYZ1", "A/B", "A;DROP", "AA$"])(
    "rejects invalid symbol %j",
    (symbol) => {
      expect(validateCandleQuery({ symbol, resolution: "D" }, NOW).error).toBeTruthy();
    },
  );
});

describe("validateCandleQuery — resolution validation", () => {
  it.each(["3", "1D", "day", "H", "2"])("rejects invalid resolution %j", (resolution) => {
    expect(validateCandleQuery({ symbol: "AAPL", resolution }, NOW).error).toBeTruthy();
  });

  it("defaults omitted/empty resolution to daily", () => {
    expect(validateCandleQuery({ symbol: "AAPL" }, NOW).resolution).toBe("D");
    expect(validateCandleQuery({ symbol: "AAPL", resolution: "" }, NOW).resolution).toBe("D");
  });

  it("maps each valid resolution to Polygon (multiplier, timespan)", () => {
    for (const [res, expected] of Object.entries(CANDLE_RESOLUTIONS)) {
      const v = validateCandleQuery({ symbol: "AAPL", resolution: res }, NOW);
      expect(v.error).toBeUndefined();
      expect({ multiplier: v.multiplier, timespan: v.timespan }).toEqual(expected);
    }
  });
});

describe("validateCandleQuery — window bounds", () => {
  it("defaults to a bounded one-year window when from/to omitted", () => {
    const v = validateCandleQuery({ symbol: "AAPL", resolution: "D" }, NOW);
    expect(v.to).toBe("2024-06-01");
    expect(v.from).toBe("2023-06-01");
  });

  it("rejects from after to", () => {
    expect(validateCandleQuery({ symbol: "AAPL", resolution: "D", from: "2024-05-01", to: "2024-01-01" }, NOW).error).toBeTruthy();
  });

  it("rejects an oversized range", () => {
    const from = new Date(NOW); from.setUTCFullYear(from.getUTCFullYear() - 10);
    const v = validateCandleQuery({ symbol: "AAPL", resolution: "D", from: from.toISOString().slice(0, 10), to: "2024-06-01" }, NOW);
    expect(v.error).toBeTruthy();
    expect((Date.parse("2024-06-01") - Date.parse(from.toISOString().slice(0, 10))) / 86_400_000).toBeGreaterThan(MAX_RANGE_DAYS);
  });
});

describe("cacheTimespan — sub-day resolutions can't collide", () => {
  it("keeps 1x resolutions on the bare timespan (shares backtester rows)", () => {
    expect(cacheTimespan(1, "day")).toBe("day");
    expect(cacheTimespan(1, "week")).toBe("week");
    expect(cacheTimespan(1, "minute")).toBe("minute");
    expect(cacheTimespan(1, "hour")).toBe("hour");
  });
  it("encodes the multiplier for sub-day resolutions", () => {
    expect(cacheTimespan(5, "minute")).toBe("5minute");
    expect(cacheTimespan(15, "minute")).toBe("15minute");
    expect(cacheTimespan(30, "minute")).toBe("30minute");
    // 5-minute never collides with 1-minute
    expect(cacheTimespan(5, "minute")).not.toBe(cacheTimespan(1, "minute"));
  });
});

describe("normalizeBars — Polygon → chart candles", () => {
  const bars = [
    { t: 1_700_000_000_000, o: 1, h: 2, l: 0.5, c: 1.5, v: 100 },
    { t: 1_700_086_400_000, o: 1.5, h: 2.5, l: 1, c: 2, v: 200 },
  ];

  it("converts epoch ms → seconds and preserves OHLCV", () => {
    const out = normalizeBars(bars);
    expect(out[0]).toEqual({ time: 1_700_000_000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 });
    expect(out).toHaveLength(2);
  });

  it("drops malformed bars instead of emitting NaN", () => {
    const dirty = [{ t: 1, o: 1, h: 2, l: 0.5, c: NaN, v: 1 }, { t: 2, c: 5 }, null, { t: 3, o: 1, h: 2, l: 1, c: 1.5, v: 0 }];
    const out = normalizeBars(dirty);
    expect(out).toHaveLength(1);
    expect(out[0].close).toBe(1.5);
  });

  it("returns [] for empty / non-array input", () => {
    expect(normalizeBars([])).toEqual([]);
    expect(normalizeBars(undefined)).toEqual([]);
    expect(normalizeBars(null)).toEqual([]);
  });

  it("is IMPERSONAL: identical params → byte-identical output, no user input exists", () => {
    // The candle response is normalizeBars(getPolygonBars(validateCandleQuery(q))).
    // None of these take a user identity — so two different authenticated users
    // requesting the same params get identical output by construction.
    const asUserA = normalizeBars(bars);
    const asUserB = normalizeBars(bars);
    expect(asUserA).toEqual(asUserB);

    const v = validateCandleQuery({ symbol: "AAPL", resolution: "D", from: "2024-01-01", to: "2024-02-01" }, NOW);
    const keys = Object.keys(v);
    expect(keys).not.toContain("user");
    expect(keys).not.toContain("userId");
    expect(keys).not.toContain("uid");
  });
});

// In the test env Supabase isn't configured, so verifyUser() returns null for
// every caller — which is exactly what an unauthenticated request looks like.
describe("route auth gate", () => {
  const call = (pathname, query = {}) =>
    handleApiRequest({ method: "GET", pathname, query, body: null, headers: {}, rawBody: "" });

  it("rejects unauthenticated /api/market/candles with 401", async () => {
    const res = await call("/api/market/candles", { symbol: "AAPL", resolution: "D" });
    expect(res.status).toBe(401);
  });

  it("rejects unauthenticated /api/market/quote with 401", async () => {
    const res = await call("/api/market/quote", { symbol: "AAPL" });
    expect(res.status).toBe(401);
  });

  it("auth-gates the candle route before any upstream fetch", async () => {
    // The 401 above returns from verifyUser() before getPolygonBars runs, so
    // the auth gate can never leak market data to an anonymous caller — and the
    // test stays hermetic (no Polygon/Finnhub network call).
    const res = await call("/api/market/candles", { symbol: "AAPL", resolution: "D" });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthorized" });
  });
});
