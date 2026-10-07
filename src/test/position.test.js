import { describe, it, expect } from 'vitest'
import { openPosition, bracketLegsFor, bracketExitState } from '../../lib/trading/position.mjs'

const row = (side, qty, price, at, ticker = 'AAPL', paper = true) =>
  ({ side, qty: String(qty), suggested_price: String(price), executed_at: at, ticker, paper })

describe('openPosition', () => {
  it('averages only the OPEN position, not every buy the strategy ever made', () => {
    // Round trip 1 at $100, then a new position at $200. The old helper
    // averaged both buys ($150) and mis-stated the new position's gain.
    const p = openPosition([
      row('buy', 10, 100, '2026-10-01T14:00:00Z', 'AAPL'),
      row('sell', 10, 105, '2026-10-02T14:00:00Z', 'AAPL'),
      row('buy', 5, 200, '2026-10-05T14:00:00Z', 'MSFT'),
    ])
    expect(p).toMatchObject({ netQty: 5, avgEntry: 200, ticker: 'MSFT', openedAt: '2026-10-05T14:00:00Z' })
  })

  it('a partial sell keeps the average and the opening time', () => {
    const p = openPosition([
      row('buy', 10, 100, '2026-10-01T14:00:00Z'),
      row('buy', 10, 110, '2026-10-02T14:00:00Z'),
      row('sell', 5, 120, '2026-10-03T14:00:00Z'),
    ])
    expect(p.netQty).toBe(15)
    expect(p.avgEntry).toBeCloseTo(105, 9)
    expect(p.openedAt).toBe('2026-10-01T14:00:00Z')
  })

  it('is flat after a full exit', () => {
    const p = openPosition([row('buy', 3, 50, '2026-10-01T14:00:00Z'), row('sell', 3, 55, '2026-10-02T14:00:00Z')])
    expect(p).toMatchObject({ netQty: 0, avgEntry: null, openedAt: null })
  })

  it('does not trust row order', () => {
    const p = openPosition([
      row('buy', 5, 200, '2026-10-05T14:00:00Z', 'MSFT'),
      row('sell', 10, 105, '2026-10-02T14:00:00Z', 'AAPL'),
      row('buy', 10, 100, '2026-10-01T14:00:00Z', 'AAPL'),
    ])
    expect(p).toMatchObject({ netQty: 5, avgEntry: 200, ticker: 'MSFT' })
  })

  it('flags paper and survives malformed input', () => {
    expect(openPosition([row('buy', 1, 10, '2026-10-01T14:00:00Z')]).paper).toBe(true)
    expect(openPosition(null)).toMatchObject({ netQty: 0, avgEntry: null, executedCount: 0 })
    expect(openPosition([null, { side: 'buy', qty: 'x' }]).netQty).toBe(0)
  })
})

describe('bracketLegsFor', () => {
  it('prices the take-profit above and the stop below the entry, in cents', () => {
    expect(bracketLegsFor({ entryPrice: 200, qty: 7, takeProfitPct: 5, stopPct: 3 })).toEqual({
      ok: true,
      order_class: 'bracket',
      take_profit: { limit_price: '210' },
      stop_loss: { stop_price: '194' },
    })
  })

  it('refuses fractional quantities — Alpaca brackets need whole shares', () => {
    expect(bracketLegsFor({ entryPrice: 200, qty: 1.5, takeProfitPct: 5, stopPct: 3 })).toMatchObject({ ok: false, code: 'fractional' })
  })

  it('refuses a missing or nonsensical stop or target rather than placing an unprotected order', () => {
    expect(bracketLegsFor({ entryPrice: 200, qty: 1, takeProfitPct: 0, stopPct: 3 }).ok).toBe(false)
    expect(bracketLegsFor({ entryPrice: 200, qty: 1, takeProfitPct: 5, stopPct: 100 }).ok).toBe(false)
    expect(bracketLegsFor({ entryPrice: 0, qty: 1, takeProfitPct: 5, stopPct: 3 }).ok).toBe(false)
    expect(bracketLegsFor(null).ok).toBe(false)
  })
})

describe('bracketExitState', () => {
  // Alpaca GET /v2/orders/{id}?nested=true — numerics are strings.
  const parent = (legs, status = 'filled') => ({ id: 'p1', status, legs })
  const leg = (id, type, status, filled_qty = '0', filled_avg_price = null, filled_at = null) =>
    ({ id, type, side: 'sell', status, filled_qty, filled_avg_price, filled_at })

  it('reports a leg that sold the position', () => {
    const s = bracketExitState(parent([
      leg('tp', 'limit', 'canceled'),
      leg('sl', 'stop', 'filled', '7', '193.98', '2026-10-08T15:00:00Z'),
    ]))
    expect(s.filled).toEqual({ legId: 'sl', kind: 'stop', qty: 7, price: 193.98, at: '2026-10-08T15:00:00Z' })
    expect(s.brokerOwnsExits).toBe(false)
  })

  it('while both legs rest, the broker owns the stop and the target', () => {
    const s = bracketExitState(parent([leg('tp', 'limit', 'new'), leg('sl', 'stop', 'held')]))
    expect(s).toMatchObject({ filled: null, openLegIds: ['tp', 'sl'], brokerOwnsExits: true })
  })

  it('legs that are gone (cancelled, expired) hand the exits back to polling', () => {
    const s = bracketExitState(parent([leg('tp', 'limit', 'canceled'), leg('sl', 'stop', 'expired')]))
    expect(s).toMatchObject({ filled: null, openLegIds: [], brokerOwnsExits: false })
  })

  it('a partially filled leg is not yet an exit', () => {
    const s = bracketExitState(parent([leg('tp', 'limit', 'partially_filled', '3', '210'), leg('sl', 'stop', 'new')]))
    expect(s.filled).toBe(null)
    expect(s.brokerOwnsExits).toBe(true)
  })

  it('survives malformed input', () => {
    expect(bracketExitState(null)).toMatchObject({ filled: null, openLegIds: [], brokerOwnsExits: false })
    expect(bracketExitState({ legs: 'x' })).toMatchObject({ filled: null, openLegIds: [] })
  })
})

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'lib', 'handlers.mjs'), 'utf8')

describe('swing broker-exit wiring', () => {
  it('a swing entry with broker exits refuses to enter without its bracket, and never on live money', () => {
    expect(SRC).toMatch(/if \(!signalVenue\(strat\)\?\.paper\) \{ warn\("bot\.entry\.bracket_live_refused"/)
    expect(SRC).toMatch(/if \(!legs\.ok\) \{ warn\("bot\.entry\.bracket_refused"[^}]*\}\); continue; \}/)
    expect(SRC).toMatch(/ticker: tickerUp, side, qty, signalId: signal\.id, bracket,/)
  })

  it('while the bracket rests, polling does not also fire the stop or the target', () => {
    expect(SRC).toMatch(/const hitStop = !brokerOwnsExits && /)
    expect(SRC).toMatch(/const hitDrawdown = !brokerOwnsExits && /)
    expect(SRC).toMatch(/const hitTarget = !brokerOwnsExits && /)
  })

  it('cancels the bracket BEFORE a trail or time-limit sale, and skips the sale if it cannot', () => {
    // Selling while a leg still holds the shares would sell them twice — on a
    // shared account, the second sale comes out of another strategy's book.
    const horizon = SRC.slice(SRC.indexOf('} else if (hitHorizon) {'), SRC.indexOf('await exitClose("bot.strategy.horizon_closed"'))
    const trail = SRC.slice(SRC.indexOf('} else if (hitTrail) {'), SRC.indexOf('await exitClose("bot.strategy.trailing_stop"'))
    expect(horizon).toMatch(/if \(!\(await clearBracket\(\)\)\) continue;/)
    expect(trail).toMatch(/if \(!\(await clearBracket\(\)\)\) continue;/)
  })

  it('an unreadable broker means doing nothing that tick', () => {
    expect(SRC).toMatch(/if \(be\.error\) \{ warn\("bot\.bracket\.read_failed"[^}]*\}\); continue; \}/)
  })

  it('the time limit counts from the POSITION, not the strategy', () => {
    expect(SRC).toMatch(/const openedMs = pos\.openedAt \? new Date\(pos\.openedAt\)\.getTime\(\) : NaN;/)
    expect(SRC).not.toMatch(/const ageDays = strat\.created_at \?/)
  })
})
