import { describe, it, expect } from 'vitest'
import { clientOrderId, isFractional, stopOrderFor, needsRearm, stopReference, MAX_CLIENT_ORDER_ID, scopeStopsToStrategy, stopTag } from '../../lib/trading/orderIdentity.js'

describe('clientOrderId', () => {
  it('is DETERMINISTIC — the same signal always yields the same id', () => {
    // The entire protection. If a retry computed a different id, the broker
    // would accept it and place a second order.
    const a = clientOrderId('abc-123')
    const b = clientOrderId('abc-123')
    expect(a).toBe(b)
    expect(a).toBe('mz-abc-123')
  })

  it('does not depend on a clock or randomness', () => {
    // Asserted by construction: call it many times across a tick boundary.
    const ids = new Set(Array.from({ length: 50 }, () => clientOrderId('sig-1')))
    expect(ids.size).toBe(1)
  })

  it('differs between signals, so two real orders are never merged', () => {
    expect(clientOrderId('sig-1')).not.toBe(clientOrderId('sig-2'))
  })

  it('strips characters a broker might reject', () => {
    expect(clientOrderId('a/b:c d')).toBe('mz-abcd')
  })

  it('returns null when there is no signal to key on', () => {
    // Null means "no idempotency key"; the caller must decide, rather than
    // being handed a fabricated id that protects nothing.
    for (const bad of [null, undefined, '', '   ', '///']) {
      expect(clientOrderId(bad), String(bad)).toBeNull()
    }
  })

  it('stays inside the broker length limit', () => {
    const id = clientOrderId('x'.repeat(500))
    expect(id.length).toBeLessThanOrEqual(MAX_CLIENT_ORDER_ID)
  })

  it('only changes on an EXPLICIT re-placement', () => {
    expect(clientOrderId('s1', { attempt: 0 })).toBe('mz-s1')
    expect(clientOrderId('s1', { attempt: 1 })).toBe('mz-s1-r1')
    expect(clientOrderId('s1', { attempt: 1 })).toBe(clientOrderId('s1', { attempt: 1 }))
  })
})

describe('isFractional', () => {
  it('recognises what the broker treats as fractional', () => {
    expect(isFractional(15.977489415)).toBe(true)
    expect(isFractional(15)).toBe(false)
    expect(isFractional(15.0)).toBe(false)
    expect(isFractional('2.5')).toBe(true)
  })

  it('does not call float noise fractional', () => {
    expect(isFractional(3.0000000000001)).toBe(false)
  })
})

describe('stopOrderFor', () => {
  it('sends the EXACT held quantity, never a rounded one', () => {
    // Measured live: qty 15.9775 against a holding of 15.977489415 is rejected
    // with "insufficient qty available for order".
    const r = stopOrderFor({ symbol: 'CRL', qty: 15.977489415, referencePrice: 288.46, stopPct: 5 })
    expect(r.ok).toBe(true)
    expect(r.order.qty).toBe('15.977489415')
  })

  it('makes a FRACTIONAL stop a DAY order, because GTC is rejected', () => {
    // Live: "stop/stop_limit fractional GTC orders are not enabled".
    const r = stopOrderFor({ symbol: 'CRL', qty: 15.977489415, referencePrice: 100, stopPct: 5 })
    expect(r.order.time_in_force).toBe('day')
    expect(r.fractional).toBe(true)
    expect(r.rearmDaily).toBe(true)
  })

  it('lets a WHOLE-share stop rest as GTC', () => {
    const r = stopOrderFor({ symbol: 'CRL', qty: 15, referencePrice: 100, stopPct: 5 })
    expect(r.order.time_in_force).toBe('gtc')
    expect(r.rearmDaily).toBe(false)
  })

  it('puts the stop BELOW the reference price by the stated percent', () => {
    const r = stopOrderFor({ symbol: 'X', qty: 10, referencePrice: 200, stopPct: 5 })
    expect(Number(r.order.stop_price)).toBeCloseTo(190, 2)
    expect(r.order.side).toBe('sell')
  })

  it('rounds to cents', () => {
    const r = stopOrderFor({ symbol: 'X', qty: 1, referencePrice: 33.333, stopPct: 3 })
    expect(r.order.stop_price).toMatch(/^\d+\.\d{1,2}$/)
  })

  it('builds a stop_limit only when an offset is asked for', () => {
    const plain = stopOrderFor({ symbol: 'X', qty: 1, referencePrice: 100, stopPct: 5 })
    expect(plain.order.type).toBe('stop')
    expect(plain.order.limit_price).toBeUndefined()

    const lim = stopOrderFor({ symbol: 'X', qty: 1, referencePrice: 100, stopPct: 5, limitOffsetPct: 1 })
    expect(lim.order.type).toBe('stop_limit')
    expect(Number(lim.order.limit_price)).toBeCloseTo(94.05, 2)   // 95 less 1%
  })

  it('REFUSES rather than reshaping, on every bad input', () => {
    // A silently reshaped stop is a different stop than the one intended.
    expect(stopOrderFor({ symbol: '', qty: 1, referencePrice: 10 }).code).toBe('no_symbol')
    expect(stopOrderFor({ symbol: 'X', qty: 0, referencePrice: 10 }).code).toBe('no_qty')
    expect(stopOrderFor({ symbol: 'X', qty: -5, referencePrice: 10 }).code).toBe('no_qty')
    expect(stopOrderFor({ symbol: 'X', qty: 1, referencePrice: 0 }).code).toBe('no_price')
    expect(stopOrderFor({ symbol: 'X', qty: 1, referencePrice: NaN }).code).toBe('no_price')
    expect(stopOrderFor({ symbol: 'X', qty: 1, referencePrice: 10, stopPct: 0 }).code).toBe('bad_stop_pct')
    expect(stopOrderFor({ symbol: 'X', qty: 1, referencePrice: 10, stopPct: 100 }).code).toBe('bad_stop_pct')
    expect(stopOrderFor({ symbol: 'X', qty: 1, referencePrice: 10, stopPct: 5, limitOffsetPct: 200 }).code).toBe('bad_limit_offset')
    expect(stopOrderFor().ok).toBe(false)
  })
})

describe('needsRearm', () => {
  const pos = (symbol, qty) => ({ symbol, qty })
  const stop = (symbol, qty, extra = {}) => ({ symbol, qty, side: 'sell', type: 'stop', ...extra })

  it('reports a position with no stop at all', () => {
    const r = needsRearm([pos('AAA', 10)], [])
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ symbol: 'AAA', qty: 10, covered: 0 })
  })

  it('treats PARTIAL cover as uncovered, not as done', () => {
    // A stop on 15 of 15.977 shares leaves a sliver unprotected. Calling that
    // "covered" is exactly the comfortable lie worth refusing.
    const r = needsRearm([pos('CRL', 15.977489415)], [stop('CRL', 15)])
    expect(r).toHaveLength(1)
    expect(r[0].gap).toBeCloseTo(0.977489415, 6)
  })

  it('counts a fully covered position as done', () => {
    expect(needsRearm([pos('CRL', 15.977489415)], [stop('CRL', 15.977489415)])).toHaveLength(0)
  })

  it('adds up multiple stops on one symbol', () => {
    expect(needsRearm([pos('AAA', 10)], [stop('AAA', 4), stop('AAA', 6)])).toHaveLength(0)
  })

  it('ignores orders that are not protective sell-stops', () => {
    // A resting BUY limit protects nothing.
    const r = needsRearm([pos('AAA', 10)], [
      { symbol: 'AAA', qty: 10, side: 'buy', type: 'limit' },
      { symbol: 'AAA', qty: 10, side: 'sell', type: 'limit' },
    ])
    expect(r).toHaveLength(1)
  })

  it('accepts a trailing stop as cover', () => {
    expect(needsRearm([pos('AAA', 10)], [stop('AAA', 10, { type: 'trailing_stop' })])).toHaveLength(0)
  })

  it('skips short positions rather than trying to stop them', () => {
    expect(needsRearm([pos('AAA', -10)], [])).toHaveLength(0)
  })

  it('never throws on garbage', () => {
    for (const bad of [null, undefined, 'x', 42, {}]) {
      expect(needsRearm(bad, bad)).toEqual([])
    }
    expect(needsRearm([null, pos('AAA', 1)], [null])).toHaveLength(1)
  })
})

// ── Static contract on the wiring ───────────────────────────────────────────
// This is the shape of bug a logic test cannot reach: clientOrderId can be
// perfectly correct while a call site simply forgets to pass the signal id,
// and then that path has no idempotency at all. It is the same class as the
// broker-seam bug Codex found, where resolveBroker was right and the QUERY
// never loaded `params`.
import { readFileSync } from 'node:fs'
import path from 'node:path'

describe('idempotency wiring', () => {
  const SRC = readFileSync(path.resolve(__dirname, '../../lib/handlers.mjs'), 'utf8')

  it('EVERY executeStrategyOrder call passes a signalId', () => {
    const calls = SRC.match(/await executeStrategyOrder\(\{[\s\S]{0,320}?\}\)/g) || []
    expect(calls.length, 'expected the known execution sites').toBeGreaterThanOrEqual(5)
    const missing = calls.filter(c => !/signalId/.test(c))
    expect(missing, `these execution paths have NO idempotency key:\n${missing.join('\n---\n')}`)
      .toHaveLength(0)
  })

  it('the Alpaca path actually sends client_order_id', () => {
    expect(SRC).toMatch(/clientOrderId:\s*clientOrderId\(signalId\)/)
    expect(SRC).toMatch(/orderBody\.client_order_id\s*=\s*coid/)
  })

  it('the strategy claim lease is still in place', () => {
    // Not added here — it already existed, and my own gap map wrongly called
    // it missing. Pinned so a refactor cannot quietly remove the thing that
    // closes the overlapping-cron duplicate-execution races.
    expect(SRC).toMatch(/botClaimLeaseThresholdIso/)
    expect(SRC).toMatch(/\.lt\("updated_at", claimLeaseThresholdIso\)/)
  })
})

describe('stopReference — the ratchet', () => {
  it('NEVER moves down: a falling price cannot lower the stop', () => {
    // The rule the whole emulation rests on. Re-arming from the current price
    // alone would widen the loss on exactly the day protection matters.
    expect(stopReference({ entryPrice: 100, currentPrice: 80 })).toBe(100)
    expect(stopReference({ entryPrice: 100, currentPrice: 80, priorHighWater: 130 })).toBe(130)
  })

  it('ratchets UP as the position gains', () => {
    expect(stopReference({ entryPrice: 100, currentPrice: 140 })).toBe(140)
  })

  it('falls back to whatever price it does have', () => {
    expect(stopReference({ currentPrice: 50 })).toBe(50)
    expect(stopReference({ entryPrice: 50 })).toBe(50)
    expect(stopReference({})).toBeNull()
    expect(stopReference()).toBeNull()
    expect(stopReference({ entryPrice: 0, currentPrice: -5 })).toBeNull()
  })
})

describe('stopOrderFor — immediate-trigger guard', () => {
  it('REFUSES a stop that would fire the instant it is accepted', () => {
    // High-water 200, 5% trail -> stop 190, but the price is already 150. The
    // position is BELOW its stop; placing it is a market dump on a possibly
    // stale quote, so it refuses and lets a human look.
    const r = stopOrderFor({ symbol: 'X', qty: 1, referencePrice: 200, stopPct: 5, livePrice: 150 })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('would_trigger_immediately')
    expect(r.stopPrice).toBeCloseTo(190, 2)
    expect(r.livePrice).toBe(150)
  })

  it('places normally when the stop sits below the live price', () => {
    const r = stopOrderFor({ symbol: 'X', qty: 1, referencePrice: 200, stopPct: 5, livePrice: 199 })
    expect(r.ok).toBe(true)
    expect(Number(r.order.stop_price)).toBeCloseTo(190, 2)
  })

  it('still works when no live price is supplied', () => {
    // The guard is opt-in; absence of a quote must not block arming.
    expect(stopOrderFor({ symbol: 'X', qty: 1, referencePrice: 200, stopPct: 5 }).ok).toBe(true)
  })
})

describe('stop-arming wiring', () => {
  const SRC = readFileSync(path.resolve(__dirname, '../../lib/handlers.mjs'), 'utf8')
  const FN = SRC.slice(SRC.indexOf('async function armProtectiveStops'),
                       SRC.indexOf('async function armProtectiveStops') + 4200)

  it('is OPT-IN — no param, no stops', () => {
    // The live rank strategy was designed with rank-based exits only.
    // Attaching a stop to it mid-flight would change the experiment while it
    // is being measured.
    expect(FN).toMatch(/protective_stop_pct/)
    expect(FN).toMatch(/not opted in/)
  })

  it('arms BEFORE the cadence check, because DAY stops expire nightly', () => {
    // The cadence check moved into rankDue() (2026-10-06); what matters is
    // that the rank branch CALLS it after arming.
    const BR = SRC.slice(SRC.indexOf('if (strat.strategy_type === "rank_rebalance")'))
    const arm = BR.indexOf('await armProtectiveStops(strat, armCreds)')
    const cadence = BR.indexOf('if (!rankDue(strat)) continue;')
    expect(arm).toBeGreaterThan(-1)
    expect(cadence).toBeGreaterThan(-1)
    expect(arm, 'arming must not sit behind the weekly cadence gate').toBeLessThan(cadence)
  })

  it('sends the EXACT held qty from the broker, never a recomputed one', () => {
    expect(FN).toMatch(/qty:\s*pos\.qty/)
  })

  it('uses the ratchet rather than the raw current price', () => {
    expect(FN).toMatch(/stopReference\(/)
    expect(FN).toMatch(/entryPrice:\s*Number\(pos\.avg_entry_price\)/)
  })

  it('is bounded so it cannot starve the live strategy sharing this cron', () => {
    expect(SRC).toMatch(/ARM_SYMBOL_CAP\s*=\s*\d+/)
    expect(SRC).toMatch(/ARM_MS_BUDGET/)
    expect(FN).toMatch(/Date\.now\(\) > deadline/)
  })

  it('treats a duplicate client_order_id as already-armed, not an error', () => {
    expect(FN).toMatch(/client_order_id must be unique/)
  })
})

// Two strategies share one Alpaca paper account. A stop pass that read the
// whole account would arm stops on the OTHER strategy's shares — the live
// momentum book had no stops by design, and a stopped variant beside it would
// have quietly given it some. Found 2026-10-04 before the variant existed.
describe('scopeStopsToStrategy', () => {
  const positions = [
    { symbol: 'ADI', qty: '20', avg_entry_price: '400', current_price: '410' },
    { symbol: 'NUE', qty: '27.3', avg_entry_price: '240', current_price: '241' },
  ]
  const tag = stopTag('abcdef12-0000-0000-0000-000000000000')

  it('keeps only symbols this strategy holds, at no more than its own quantity', () => {
    const out = scopeStopsToStrategy({ positions, openOrders: [], book: { ADI: 6.5 }, strategyId: 'abcdef12-0000' })
    expect(out.positions).toHaveLength(1)
    expect(out.positions[0]).toMatchObject({ symbol: 'ADI', qty: '6.5', avg_entry_price: '400' })
  })

  it('never claims more than the account actually holds', () => {
    const out = scopeStopsToStrategy({ positions, openOrders: [], book: { ADI: 50 }, strategyId: 'abcdef12' })
    expect(out.positions[0].qty).toBe('20')
  })

  it("counts only this strategy's own stops as coverage", () => {
    const openOrders = [
      { symbol: 'ADI', side: 'sell', type: 'stop', qty: '6.5', client_order_id: 'mz-stop-99999999-ADI-20261005' },
      { symbol: 'ADI', side: 'sell', type: 'stop', qty: '2', client_order_id: `${tag}ADI-20261005` },
    ]
    const out = scopeStopsToStrategy({ positions, openOrders, book: { ADI: 6.5 }, strategyId: 'abcdef12-0000' })
    expect(out.openOrders).toHaveLength(1)
    expect(out.openOrders[0].qty).toBe('2')
  })

  it('an empty book arms nothing — a strategy with no shares protects no shares', () => {
    const out = scopeStopsToStrategy({ positions, openOrders: [], book: {}, strategyId: 'abcdef12' })
    expect(out.positions).toEqual([])
  })

  it('survives malformed input', () => {
    expect(scopeStopsToStrategy(null)).toEqual({ positions: [], openOrders: [] })
    expect(scopeStopsToStrategy({ positions: { e: 1 }, openOrders: null, book: null, strategyId: null }))
      .toEqual({ positions: [], openOrders: [] })
  })
})
