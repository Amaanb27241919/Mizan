import { describe, it, expect } from 'vitest'
import {
  sleeveCash, rankDeployBudget, earningsExclusions, withCashSweep, aiGateDecision,
} from '../../lib/trading/sleeve.mjs'

const sig = (side, qty, price, status = 'executed') => ({ side, qty: String(qty), suggested_price: String(price), status })

// The defect that prompted this module: rank_rebalance handed the basket
// allocator `capital_allocated` as NEW money every rebalance. The allocator
// treats its budget as a contribution, so the live $95k strategy would have
// bought ~$95k more on its 2026-10-09 rebalance with ~$5k of cash — on margin.
describe('sleeveCash', () => {
  it('is capital minus what was bought plus what was sold', () => {
    expect(sleeveCash({ capital: 1000, signals: [sig('buy', 2, 300), sig('sell', 1, 350)] })).toBeCloseTo(750, 6)
  })

  it('reserves cash for buys still in flight (submitted), so a tick cannot spend it twice', () => {
    expect(sleeveCash({ capital: 1000, signals: [sig('buy', 1, 400, 'submitted')] })).toBeCloseTo(600, 6)
  })

  it('ignores records that never became orders', () => {
    const noise = ['shadow', 'rejected', 'expired', 'pending'].map((s) => sig('buy', 10, 100, s))
    expect(sleeveCash({ capital: 1000, signals: noise })).toBe(1000)
  })

  it('the live strategy after its first rebalance has almost nothing left to deploy', () => {
    // Shape of 97b5b48e on 2026-10-02: $95,000 capital, $94,999.73 bought.
    expect(sleeveCash({ capital: 95000, signals: [sig('buy', 1, 94999.73)] })).toBeCloseTo(0.27, 2)
  })

  it('survives malformed input', () => {
    expect(sleeveCash(null)).toBe(0)
    expect(sleeveCash({ capital: 'x', signals: { e: 1 } })).toBe(0)
  })
})

describe('rankDeployBudget', () => {
  it('adds the proceeds of this rebalance\'s sells to the sleeve', () => {
    expect(rankDeployBudget({ sleeve: 100, sells: [{ qty: 2, price: 50 }], accountCash: 10000 })).toBe(200)
  })

  it('NEVER exceeds the account\'s real cash — margin is riba', () => {
    expect(rankDeployBudget({ sleeve: 95000, sells: [], accountCash: 5000 })).toBe(5000)
    expect(rankDeployBudget({ sleeve: 95000, sells: [{ qty: 10, price: 100 }], accountCash: 5000 })).toBe(6000)
  })

  it('is zero, not negative, when the sleeve is overspent', () => {
    expect(rankDeployBudget({ sleeve: -50, sells: [], accountCash: 1e6 })).toBe(0)
  })

  it('refuses to guess when the account cash is unknown', () => {
    expect(rankDeployBudget({ sleeve: 1000, sells: [], accountCash: null })).toBe(0)
  })
})

describe('earningsExclusions', () => {
  const cal = [
    { symbol: 'MU', date: '2026-09-30' },
    { symbol: 'KLAC', date: '2026-10-28' },
    { symbol: 'LRCX', date: '2026-10-07' },
    { symbol: 'ZZZZ', date: '2026-10-07' },
  ]
  const universe = ['MU', 'KLAC', 'LRCX', 'ADI']

  it('blocks universe names reporting within the window (inclusive)', () => {
    expect(earningsExclusions(cal, universe, { asOf: '2026-09-28', days: 3 })).toEqual(['MU'])
    expect(earningsExclusions(cal, universe, { asOf: '2026-10-05', days: 3 })).toEqual(['LRCX'])
  })

  it('ignores names outside the universe and dates already past', () => {
    expect(earningsExclusions(cal, universe, { asOf: '2026-10-08', days: 3 })).toEqual([])
  })

  it('is off when days is 0 and survives malformed input', () => {
    expect(earningsExclusions(cal, universe, { asOf: '2026-09-28', days: 0 })).toEqual([])
    expect(earningsExclusions(null, null, null)).toEqual([])
    expect(earningsExclusions({ earningsCalendar: cal }, universe, { asOf: '2026-09-28', days: 3 })).toEqual(['MU'])
  })
})

describe('withCashSweep', () => {
  it('puts the empty slots into the sweep ticker', () => {
    const out = withCashSweep({ A: 0.5, B: 0.5 }, { buyTop: 4, targetCount: 2, ticker: 'SPSK' })
    expect(out).toEqual({ A: 0.25, B: 0.25, SPSK: 0.5 })
  })

  it('adds nothing when every slot is filled', () => {
    expect(withCashSweep({ A: 0.5, B: 0.5 }, { buyTop: 2, targetCount: 2, ticker: 'SPSK' })).toEqual({ A: 0.5, B: 0.5 })
  })

  it('weights still sum to 1', () => {
    const out = withCashSweep({ A: 0.2, B: 0.3, C: 0.5 }, { buyTop: 15, targetCount: 3, ticker: 'SPSK' })
    expect(Object.values(out).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9)
  })

  it('is a no-op without a ticker, and survives malformed input', () => {
    expect(withCashSweep({ A: 1 }, { buyTop: 5, targetCount: 1, ticker: null })).toEqual({ A: 1 })
    expect(withCashSweep(null, null)).toEqual({})
  })
})

describe('aiGateDecision', () => {
  const row = (ticker, ensemble) => ({ ticker, rationale: { kind: 'ai_panel', ensemble } })
  const SELL2 = { ok: true, consensus: 'SELL', unanimous: true, votes: 2 }
  const HOLD = { ok: true, consensus: 'HOLD', unanimous: false, votes: 2 }
  const DECLINED = { ok: false, code: 'insufficient_votes' }

  it('blocks only a name the panel agreed to SELL', () => {
    const d = aiGateDecision({ candidates: ['A', 'B', 'C'], reviews: [row('A', SELL2), row('B', HOLD), row('C', DECLINED)] })
    expect(d.vetoed).toEqual(['A'])
    expect(d.passed).toEqual(['B', 'C'])
    expect(d.unreviewed).toEqual([])
    expect(d.ready).toBe(true)
  })

  it('waits while a candidate has not been reviewed yet', () => {
    const d = aiGateDecision({ candidates: ['A', 'B'], reviews: [row('A', HOLD)] })
    expect(d.unreviewed).toEqual(['B'])
    expect(d.ready).toBe(false)
  })

  it('after the cutoff, unreviewed names proceed — a vendor outage must not freeze the book', () => {
    const d = aiGateDecision({ candidates: ['A', 'B'], reviews: [row('A', HOLD)], pastCutoff: true })
    expect(d.ready).toBe(true)
    expect(d.passed).toEqual(['A', 'B'])
    expect(d.unreviewedAtCutoff).toEqual(['B'])
  })

  it("blocks a name Mizan's own screen rates haram, whatever the models said", () => {
    const haram = { ticker: 'X', rationale: { kind: 'ai_panel', screen_only: true, sharia_verdict: 'haram', ensemble: { ok: false } } }
    const d = aiGateDecision({ candidates: ['X'], reviews: [haram] })
    expect(d.vetoed).toEqual(['X'])
  })

  it('a screen-only row for a "review" verdict counts as reviewed and passes', () => {
    const rev = { ticker: 'Y', rationale: { kind: 'ai_panel', screen_only: true, sharia_verdict: 'review', ensemble: { ok: false } } }
    const d = aiGateDecision({ candidates: ['Y'], reviews: [rev] })
    expect(d).toMatchObject({ vetoed: [], passed: ['Y'], ready: true })
  })

  it('ignores reviews that are not AI panel rows', () => {
    const d = aiGateDecision({ candidates: ['A'], reviews: [{ ticker: 'A', rationale: { kind: 'rank', ensemble: SELL2 } }] })
    expect(d.unreviewed).toEqual(['A'])
  })

  it('survives malformed input', () => {
    expect(aiGateDecision(null)).toMatchObject({ vetoed: [], passed: [], unreviewed: [], ready: true })
  })
})

import { valueBook } from '../../lib/trading/sleeve.mjs'

// Found 2026-10-06 by the Trade Lab audit: the strategy card summed the share
// counts of all 25 different tickers (386.57) and priced the total at ONE
// ticker's quote, showing ~$162k / +71% for a ~$97k book.
describe('valueBook', () => {
  it('prices every ticker separately', () => {
    expect(valueBook({ ADI: 2, SNDK: 1 }, { ADI: 420, SNDK: 1750 })).toEqual({ value: 2590, priced: 2, missing: [] })
  })

  it('reports tickers it could not price instead of silently valuing them at zero', () => {
    expect(valueBook({ ADI: 2, ZZZ: 5 }, { ADI: 420 })).toEqual({ value: 840, priced: 1, missing: ['ZZZ'] })
  })

  it('accepts string prices and survives malformed input', () => {
    expect(valueBook({ ADI: '2' }, { ADI: '420.5' }).value).toBe(841)
    expect(valueBook(null, null)).toEqual({ value: 0, priced: 0, missing: [] })
  })
})

import { strategyScore } from '../../lib/trading/sleeve.mjs'

// The scoreboard the Trade Lab exists for: is a strategy beating simply
// holding SPUS over the SAME window? The card used to compute P&L as
// (stock value − capital), ignoring the strategy's cash, so every unfunded
// strategy read "−100%" and a swing that had just sold read as a total loss.
describe('strategyScore', () => {
  const sig = (side, qty, price, at, status = 'executed') => ({ side, qty, suggested_price: price, status, executed_at: at })

  it('equity is stock value PLUS the strategy\'s own cash', () => {
    const s = strategyScore({ capital: 1000, ledger: [sig('buy', 5, 100, '2026-10-02T13:30:00Z')], marketValue: 550 })
    expect(s.cash).toBe(500)
    expect(s.equity).toBe(1050)
    expect(s.returnPct).toBeCloseTo(5, 9)
  })

  it('a strategy that has not traded has NO return yet — never −100%', () => {
    expect(strategyScore({ capital: 250000, ledger: [], marketValue: 0 })).toMatchObject({ equity: 250000, returnPct: null, startedAt: null })
  })

  it('a swing that sold everything keeps its proceeds', () => {
    const s = strategyScore({ capital: 1000, ledger: [
      sig('buy', 10, 100, '2026-10-02T13:30:00Z'), sig('sell', 10, 105, '2026-10-05T15:00:00Z'),
    ], marketValue: 0 })
    expect(s.equity).toBe(1050)
    expect(s.returnPct).toBeCloseTo(5, 9)
    expect(s.startedAt).toBe('2026-10-02T13:30:00Z')
  })

  it('compares against SPUS over the same window, and states the difference', () => {
    const s = strategyScore({ capital: 1000, ledger: [sig('buy', 5, 100, '2026-10-02T13:30:00Z')], marketValue: 550,
      benchStart: 60, benchNow: 61.2 })
    expect(s.benchReturnPct).toBeCloseTo(2, 9)
    expect(s.alphaPct).toBeCloseTo(3, 9)
  })

  it('reports no comparison rather than a fake one when the benchmark is missing', () => {
    const s = strategyScore({ capital: 1000, ledger: [sig('buy', 5, 100, '2026-10-02T13:30:00Z')], marketValue: 550, benchStart: null, benchNow: 61 })
    expect(s.benchReturnPct).toBe(null)
    expect(s.alphaPct).toBe(null)
  })

  it('survives malformed input', () => {
    expect(strategyScore(null)).toMatchObject({ equity: 0, returnPct: null, benchReturnPct: null })
  })
})

import { dcaAffordableQty } from '../../lib/trading/sleeve.mjs'
describe('dcaAffordableQty — the account\'s real cash caps a DCA buy', () => {
  // 2026-10-07: the owner stopped depositing into the E*TRADE account. The DCA
  // budget was capital_allocated minus deployed, so it would have placed (and
  // had rejected) one order every weekday for an account with no money in it.
  it('caps whole shares at the cash on hand', () => {
    expect(dcaAffordableQty({ budget: 50, price: 34.51, cash: 40 })).toBe(1)
    expect(dcaAffordableQty({ budget: 200, price: 34.51, cash: 80 })).toBe(2)
  })
  it('returns 0 when the account cannot afford one share — wait, do not order', () => {
    expect(dcaAffordableQty({ budget: 50, price: 34.51, cash: 12.3 })).toBe(0)
  })
  it('falls back to the budget when cash could not be read, so a broken connection still surfaces', () => {
    expect(dcaAffordableQty({ budget: 50, price: 34.51, cash: null })).toBe(1)
  })
  it('survives junk', () => {
    expect(dcaAffordableQty(null)).toBe(0)
    expect(dcaAffordableQty({ budget: 50, price: 0, cash: 100 })).toBe(0)
  })
})

import { readFileSync as readSrc } from 'node:fs'
import nodePath from 'node:path'
describe('DCA branch wiring', () => {
  const SRC = readSrc(nodePath.resolve(__dirname, '../../lib/handlers.mjs'), 'utf8')
  const dca = SRC.slice(SRC.indexOf('if (strat.strategy_type === "dca") {'), SRC.indexOf('signalsGenerated++;', SRC.indexOf('if (strat.strategy_type === "dca") {')))
  it('reads live account cash and sizes with dcaAffordableQty BEFORE inserting a signal', () => {
    expect(dca).toMatch(/snapAccountCash\(strat\.user_id, strat\.account_id\)/)
    const sized = dca.indexOf('dcaAffordableQty(')
    expect(sized).toBeGreaterThan(-1)
    expect(sized).toBeLessThan(dca.indexOf('from("pending_signals").insert('))
  })
  it('only live venues are cash-checked (paper has its own sleeve accounting)', () => {
    expect(dca).toMatch(/if \(venue && !venue\.paper\)/)
  })
})

describe('strategyScore — an unpriced position is unknown, never a loss', () => {
  // 2026-10-08: a rate-limited quote valued Experiment D's 361 ISRG at $0 and
  // the card read "$176, −100.12% vs SPUS" for a position worth ~$149,600.
  const ledger = [{ side: 'buy', qty: 361, suggested_price: 416, status: 'executed', executed_at: '2026-10-07T14:00:10Z' }]
  it('reports cash but no equity or return when the holdings could not be priced', () => {
    const s = strategyScore({ capital: 150000, ledger, marketValue: 0, priced: false, benchStart: 100, benchNow: 99.9 })
    expect(s.cash).toBe(-176) // 361 × $416 filled $176 over the $150,000 capital
    expect(s.equity).toBeNull()
    expect(s.returnPct).toBeNull()
    expect(s.alphaPct).toBeNull()
  })
  it('priced by default, so existing callers are unchanged', () => {
    expect(strategyScore({ capital: 150000, ledger, marketValue: 149648.94 }).returnPct).toBeCloseTo(-0.35, 2)
  })
})

describe('progress pricing wiring (handlers.mjs)', () => {
  const SRC = readSrc(nodePath.resolve(__dirname, '../../lib/handlers.mjs'), 'utf8')
  const f = SRC.slice(SRC.indexOf('async function computeStrategyProgress('), SRC.indexOf('async function computeStrategyProgress(') + 9000)
  it('prices a single position from Alpaca before Finnhub, and flags it when neither answers', () => {
    expect(f).toMatch(/fetchLatestPrices\(\[out\.held_ticker\], pCreds\)/)
    expect(f).toMatch(/if \(!quote\) out\.unpriced = \[out\.held_ticker\];/)
  })
  it('passes priced:false to the score when anything is unpriced', () => {
    expect(f).toMatch(/strategyScore\(\{[^}]*priced \}\)/)
  })
})
