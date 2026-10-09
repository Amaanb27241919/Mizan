import { describe, it, expect } from 'vitest'
import { tradeEligibility, screenPlanInputs, HALAL_FUNDS } from '../../lib/trading/screenGate.mjs'

// Verdict shapes as lib/sharia.mjs produces them. STX on 2026-10-07: passes
// AAOIFI, fails 4 stricter standards, so the cross-standard VOTE said "haram".
const pass = (std = 'AAOIFI') => ({ status: 'halal', byStandard: { [std]: { pass: true } } })
const STX = { status: 'haram', byStandard: { AAOIFI: { pass: true }, FTSE_SHARIAH: { pass: false } } }
const failAaoifi = { status: 'review', byStandard: { AAOIFI: { pass: false } } }
const sector = { status: 'haram', reason: 'Prohibited sector: Banks', byStandard: { AAOIFI: { pass: false } } }
const inconclusive = { status: 'review', byStandard: { AAOIFI: { pass: null } } }
const throttled = { status: 'unknown', reason: 'finnhub_unavailable:429' }
const pending = { status: 'unknown', reason: 'pending' }

describe('tradeEligibility (owner decision 2026-10-07: every strategy uses AAOIFI)', () => {
  it('judges by AAOIFI, NOT the cross-standard vote', () => {
    expect(tradeEligibility(STX, 'STX')).toBe('eligible')
    expect(tradeEligibility(failAaoifi, 'X')).toBe('blocked')
  })
  it('a prohibited sector is always blocked', () => {
    expect(tradeEligibility(sector, 'BANK')).toBe('blocked')
  })
  it('evaluated-but-inconclusive is NOT eligible — unconfirmed is not halal', () => {
    expect(tradeEligibility(inconclusive, 'X')).toBe('blocked')
  })
  it('a failed or pending screen is "unverified" — retry, never buy on it', () => {
    expect(tradeEligibility(throttled, 'X')).toBe('unverified')
    expect(tradeEligibility(pending, 'X')).toBe('unverified')
    expect(tradeEligibility(null, 'X')).toBe('unverified')
  })
  it('Sharia-screened funds are eligible by construction (no company balance sheet to ratio-test)', () => {
    for (const f of ['SPUS', 'SPSK', 'HLAL', 'UMMA', 'SPWO']) {
      expect(HALAL_FUNDS.has(f)).toBe(true)
      expect(tradeEligibility(inconclusive, f)).toBe('eligible')
    }
  })
  it('honours another standard when a strategy names one', () => {
    expect(tradeEligibility(STX, 'STX', { standard: 'FTSE_SHARIAH' })).toBe('blocked')
  })
})

describe('screenPlanInputs', () => {
  const v = { STX, FAIL: failAaoifi, OK: pass(), HELDBAD: failAaoifi, HELDGAP: throttled, NEW: throttled }

  it('excludes ineligible buy candidates and sells holdings that FAIL the standard', () => {
    const r = screenPlanInputs({ candidates: ['STX', 'FAIL', 'OK'], held: ['HELDBAD', 'OK'], verdicts: v })
    expect(r.excludeBuys).toEqual(['FAIL'])
    expect(r.forceSells).toEqual(['HELDBAD'])
    expect(r.waiting).toBe(false)
  })

  it('never sells a holding just because its screen failed to load', () => {
    const r = screenPlanInputs({ candidates: [], held: ['HELDGAP'], verdicts: v })
    expect(r.forceSells).toEqual([])
  })

  it('waits while a buy candidate is unverified, and excludes it once past the cutoff', () => {
    expect(screenPlanInputs({ candidates: ['NEW', 'OK'], held: [], verdicts: v })).toMatchObject({ waiting: true, unverified: ['NEW'] })
    expect(screenPlanInputs({ candidates: ['NEW', 'OK'], held: [], verdicts: v, pastCutoff: true }))
      .toMatchObject({ waiting: false, excludeBuys: ['NEW'], unverified: ['NEW'] })
  })

  it('survives malformed input', () => {
    expect(screenPlanInputs(null)).toMatchObject({ excludeBuys: [], forceSells: [], waiting: false })
  })
})

// Wiring guards: the pure rule above is worthless if a strategy path stops calling it.
import { readFileSync } from 'node:fs'
import path from 'node:path'
describe('every strategy path screens by AAOIFI (handlers.mjs wiring)', () => {
  const SRC = readFileSync(path.resolve(__dirname, '../../lib/handlers.mjs'), 'utf8')
  const fn = (name) => { const i = SRC.indexOf(`async function ${name}(`); return SRC.slice(i, SRC.indexOf('\n}\n', i)) }
  it('rank plans screen their hold zone and held names, and wait on unverified ones', () => {
    const p = fn('prepareRankPlan')
    expect(p).toMatch(/screenPlanInputs\(/)
    expect(p).toMatch(/if \(screen\.waiting\)/)
    expect(p).toMatch(/forceSell/)
  })
  it('the AI research panel and the entry engine use tradeEligibility, not the vote', () => {
    expect(fn('runResearchPanel')).toMatch(/tradeEligibility\(screen, sym/)
    expect(fn('runResearchPanel')).not.toMatch(/verdict = String\(screen\?\.status/)
    expect(SRC).toMatch(/tradeEligibility\(entryScreen, tickerUp/)
  })
  it('the gate re-plans keep forced sells', () => {
    expect(fn('runAiGate')).toMatch(/rebalancePlan\(\{[^}]*forceSell/)
  })
})

describe('verdict cache retention', () => {
  const SRC = readFileSync(path.resolve(__dirname, '../../lib/handlers.mjs'), 'utf8')
  it('the daily cleanup evicts old verdict rows (Data Retention promises TTL eviction)', () => {
    const at = SRC.indexOf('if (pathname === "/api/cron/cleanup")')
    const c = SRC.slice(at, SRC.indexOf('checkDataFeeds(sbAdmin', at))
    expect(c.length).toBeGreaterThan(100)
    expect(c).toMatch(/from\("polygon_cache"\)\s*\.delete\([^)]*\)\.eq\("timespan", SCREEN_CACHE_SPAN\)\.lt\("from_date"/)
  })
})

describe("handOrderGate — hand orders held to AAOIFI (owner, 2026-10-09)", () => {
  it("buys need an AAOIFI pass; failing and unscreened buys are refused", async () => {
    const { handOrderGate } = await import("../../lib/trading/screenGate.mjs");
    const pass = { status: "halal", byStandard: { AAOIFI: { pass: true } } };
    const fail = { status: "halal", byStandard: { AAOIFI: { pass: false } } };   // a vote can say halal while AAOIFI fails
    expect(handOrderGate({ side: "buy", ticker: "aapl", verdict: pass })).toEqual({ ok: true });
    const f = handOrderGate({ side: "buy", ticker: "xyz", verdict: fail });
    expect(f).toMatchObject({ ok: false, code: "sharia_failed", status: 403 });
    expect(f.error).toMatch(/^XYZ does not pass the AAOIFI Sharia screen/);
    expect(handOrderGate({ side: "buy", ticker: "XYZ", verdict: null })).toMatchObject({ ok: false, code: "sharia_unverified", status: 503 });
    expect(handOrderGate({ side: "buy", ticker: "XYZ", verdict: { status: "unknown" } }).code).toBe("sharia_unverified");
  });
  it("halal funds pass by construction, and sells are never blocked", async () => {
    const { handOrderGate } = await import("../../lib/trading/screenGate.mjs");
    expect(handOrderGate({ side: "buy", ticker: "SPUS", verdict: null })).toEqual({ ok: true });
    expect(handOrderGate({ side: "sell", ticker: "XYZ", verdict: { byStandard: { AAOIFI: { pass: false } } } })).toEqual({ ok: true });
    expect(handOrderGate(null)).toMatchObject({ ok: false, code: "sharia_unverified" });
  });
});

describe('hand-order routes are held to AAOIFI (handlers.mjs wiring, owner 2026-10-09)', () => {
  const SRC = readFileSync(path.resolve(__dirname, '../../lib/handlers.mjs'), 'utf8')
  const route = (start, end) => { const i = SRC.indexOf(start); return SRC.slice(i, SRC.indexOf(end, i)) }
  it('the paper order route screens a buy before it reaches the broker', () => {
    const r = route('if (pathname === "/api/alpaca/order" && method === "POST")', 'audit({\n      userId: user.id,\n      action: "alpaca.order_placed"')
    const gate = r.indexOf('handOrderGate('), place = r.indexOf('placeAlpacaOrder(')
    expect(gate, 'handOrderGate must be called').toBeGreaterThan(-1)
    expect(gate, 'and before placeAlpacaOrder').toBeLessThan(place)
    expect(r).toMatch(/side !== "sell"/)
  })
  it('the live preview route screens a buy before it resolves the symbol at the broker', () => {
    const r = route('if (pathname === "/api/snaptrade/trade/impact" && method === "POST")', 'if (pathname === "/api/snaptrade/trade/place"')
    const gate = r.indexOf('handOrderGate('), broker = r.indexOf('resolveUniversalSymbolId(')
    expect(gate).toBeGreaterThan(-1)
    expect(gate).toBeLessThan(broker)
  })
})
