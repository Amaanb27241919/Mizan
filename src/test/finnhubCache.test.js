// @vitest-environment node
//
// F7 — Finnhub proxy hardening. The four Finnhub proxy endpoints (news,
// earnings, profile2, metric) go through fetchWithRetry (429/Retry-After-aware
// backoff), and news + earnings additionally share a small per-warm-instance
// response cache so users don't each re-spend the 60/min free-tier budget on
// identical payloads. These tests pin the pure TTL-freshness decision the cache
// relies on, plus the TTL contract (news 5m / earnings 30m), without importing
// any live Finnhub call or Supabase mock.
import { describe, it, expect } from "vitest";
import {
  finnhubCacheFresh,
  FINNHUB_NEWS_TTL_MS,
  FINNHUB_EARNINGS_TTL_MS,
} from "../../lib/handlers.mjs";

const NOW = Date.parse("2026-07-23T15:00:00.000Z");

describe("Finnhub cache TTL contract", () => {
  it("news TTL is 5 minutes (headlines move intraday)", () => {
    expect(FINNHUB_NEWS_TTL_MS).toBe(5 * 60 * 1000);
  });
  it("earnings TTL is 30 minutes (calendar barely changes)", () => {
    expect(FINNHUB_EARNINGS_TTL_MS).toBe(30 * 60 * 1000);
  });
  it("earnings is cached longer than news", () => {
    expect(FINNHUB_EARNINGS_TTL_MS).toBeGreaterThan(FINNHUB_NEWS_TTL_MS);
  });
});

describe("finnhubCacheFresh — pure freshness decision", () => {
  it("serves an entry written well within the TTL", () => {
    const entry = { ts: NOW - 60 * 1000, body: { news: [] } }; // 1 min old
    expect(finnhubCacheFresh(entry, FINNHUB_NEWS_TTL_MS, NOW)).toBe(true);
  });

  it("expires an entry once the TTL has elapsed (news, 6 min old)", () => {
    const entry = { ts: NOW - 6 * 60 * 1000, body: { news: [] } };
    expect(finnhubCacheFresh(entry, FINNHUB_NEWS_TTL_MS, NOW)).toBe(false);
  });

  it("keeps an earnings entry fresh at 20 min but expires it at 31 min", () => {
    const fresh = { ts: NOW - 20 * 60 * 1000, body: { earningsCalendar: [] } };
    const stale = { ts: NOW - 31 * 60 * 1000, body: { earningsCalendar: [] } };
    expect(finnhubCacheFresh(fresh, FINNHUB_EARNINGS_TTL_MS, NOW)).toBe(true);
    expect(finnhubCacheFresh(stale, FINNHUB_EARNINGS_TTL_MS, NOW)).toBe(false);
  });

  it("is exclusive exactly at the TTL boundary (< ttl, matches the get check)", () => {
    const atBoundary = { ts: NOW - FINNHUB_NEWS_TTL_MS, body: {} };
    const justInside = { ts: NOW - FINNHUB_NEWS_TTL_MS + 1, body: {} };
    expect(finnhubCacheFresh(atBoundary, FINNHUB_NEWS_TTL_MS, NOW)).toBe(false);
    expect(finnhubCacheFresh(justInside, FINNHUB_NEWS_TTL_MS, NOW)).toBe(true);
  });

  it("treats a missing or malformed entry as never fresh (forces a fresh fetch)", () => {
    expect(finnhubCacheFresh(null, FINNHUB_NEWS_TTL_MS, NOW)).toBe(false);
    expect(finnhubCacheFresh(undefined, FINNHUB_NEWS_TTL_MS, NOW)).toBe(false);
    expect(finnhubCacheFresh({ body: {} }, FINNHUB_NEWS_TTL_MS, NOW)).toBe(false); // no ts
    expect(finnhubCacheFresh({ ts: NaN, body: {} }, FINNHUB_NEWS_TTL_MS, NOW)).toBe(false);
  });
});
