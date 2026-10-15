// The 2026-10-14 experiments (news catalyst, green-day rule, pre-market
// entries, fixed-weight dividend basket) are wired into lib/handlers.mjs.
// The rules themselves are tested in catalyst.test.js; these pin the wiring.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { explainStrategy } from '../lib/strategyExplainer.js'

const SRC = readFileSync(path.resolve(__dirname, '../../lib/handlers.mjs'), 'utf8')
const between = (a, b) => SRC.slice(SRC.indexOf(a), SRC.indexOf(b, SRC.indexOf(a)))

describe('news catalyst', () => {
  it('no news feed means no entry, and a candidate without fresh news is skipped', () => {
    expect(SRC).toMatch(/if \(!rawNews\) \{ warn\("bot\.entry\.news_unavailable"[^}]*\}\); continue; \}/)
    expect(SRC).toMatch(/if \(newsSet && !newsSet\.has\(cand\)\) \{ newsBlocked\+\+; continue; \}/)
  })
})

describe('green-day rule', () => {
  it('runs in the exit engine before the stop, clears the bracket first, and ends the day', () => {
    const exit = between('// GREEN-DAY RULE (Experiment I', 'const hitStop = !brokerOwnsExits')
    expect(exit).toMatch(/if \(!\(await clearBracket\(\)\)\) continue;/)
    expect(exit.indexOf('clearBracket')).toBeLessThan(exit.indexOf('exitClose('))
    expect(exit).toMatch(/await markDayDone\(strat, today, act\);/)
  })
  it('the entry engine takes no new position once the day is done', () => {
    expect(SRC).toMatch(/if \(strat\.params\?\.day_done === today\) continue;/)
  })
})

describe('pre-market entries', () => {
  const fn = between('async function premarketSwingEntries()', '\n/**\n * PRE-MARKET REVIEW')
  it('opt-in, paper only, leased, and a limit order flagged for extended hours', () => {
    expect(fn).toMatch(/x\?\.params\?\.premarket_entries === true/)
    expect(fn).toMatch(/if \(!venue\?\.paper\)/)
    expect(fn).toMatch(/\.lt\("updated_at", botClaimLeaseThresholdIso\(claimNowMs\)\)/)
    expect(fn).toMatch(/limitPrice: limit, extendedHours: true/)
    expect(fn).toMatch(/if \(eligible !== "eligible"\)/)
    expect(fn.indexOf('tradeEligibility(')).toBeLessThan(fn.indexOf('executeStrategyOrder('))
  })
  it('never with a position, an order in flight, or the day done', () => {
    expect(fn).toMatch(/if \(pos\.netQty > 0\)/)
    expect(fn).toMatch(/orderInFlight\(flight\)/)
    expect(fn).toMatch(/strat\.params\?\.day_done === today/)
  })
  it('the order router refuses a limit or extended-hours strategy order anywhere but Alpaca paper', () => {
    const ex = between('async function executeStrategyOrder(', '\n}\n')
    expect(ex).toMatch(/if \(extendedHours \|\| limitPrice\) \{\s*return normalizeResult\(routed\.broker, \{ ok: false, status: 400, code: "extended_hours_paper_only"/)
    expect(ex.indexOf('extended_hours_paper_only')).toBeLessThan(ex.indexOf('getSnapCredsForUser'))
  })
  it('runs from the closed-market branch', () => {
    expect(SRC).toMatch(/try \{ premarketEntries = await premarketSwingEntries\(\); \}/)
  })
})

describe('fixed-weight basket', () => {
  it('is sized by its own weights, not by volatility', () => {
    expect(SRC).toMatch(/let weights = strat\.params\?\.fixed_weights \? fixedWeights\(strat\.params\.fixed_weights, plan\.target\) : inverseVolWeights\(ranked, plan\.target\);/)
  })
})

describe('the explainer says what each new strategy does', () => {
  const swing = (params, extra = {}) => ({ id: 'x', strategy_type: 'breakout', capital_allocated: 12500, stop_loss_pct: 3, profit_target_pct: 6,
    params: { broker: 'alpaca_paper', universe_tickers: ['CRM', 'ORCL'], entry_threshold_pct: 1.5, ...params }, ...extra })
  it('news, pre-market and green-day rules are stated', () => {
    const h = explainStrategy(swing({ require_news_hours: 24 }))
    expect(h.rules[0]).toMatch(/only if the company had news in the last 24 hours/)
    expect(h.oneLine).toMatch(/fresh news/)
    expect(explainStrategy(swing({ require_news_hours: 24, premarket_entries: true })).rules.join(' ')).toMatch(/before the open, from 7:00 ET/)
    expect(explainStrategy(swing({ green_day: { goal_pct: 1, loss_limit_pct: 2 } })).rules.join(' ')).toMatch(/up 1% on the day it sells and stops for the day; down 2%/)
  })
  it('H and J differ only by pre-market entries, so J says what it tests', () => {
    const H = { ...swing({ require_news_hours: 24 }), id: 'h', params: { ...swing({ require_news_hours: 24 }).params, experiment: 'H: news catalyst', display_name: 'Spica' } }
    const J = { ...swing({ require_news_hours: 24, premarket_entries: true }), id: 'j', params: { ...swing({ require_news_hours: 24, premarket_entries: true }).params, experiment: 'J: pre-market', display_name: 'Suhail' } }
    expect(explainStrategy(J, [H, J]).tests).toMatch(/Tests pre-market entries: H runs the same rules without it/)
  })
  it('the dividend basket reads as a basket, quarterly', () => {
    const g = explainStrategy({ id: 'g', strategy_type: 'rank_rebalance', capital_allocated: 12000,
      params: { broker: 'alpaca_paper', rebalance_days: 91, fixed_weights: { TXN: 7.1, PG: 6.7 }, basket_source: "Amal Invest's halal-filtered SCHD list" } })
    expect(g.oneLine).toBe('A fixed basket of 2 halal dividend stocks, rebalanced quarterly.')
    expect(g.rules[0]).toMatch(/Amal Invest's halal-filtered SCHD list/)
  })
})
