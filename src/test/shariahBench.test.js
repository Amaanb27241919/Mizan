/**
 * Independent validation of the AAOIFI ratio engine against a third-party
 * labelled set — ShariahBench (CC-BY-4.0), 56 instruments across 7 regions
 * with full line-item inputs and AAOIFI verdicts.
 *
 * Why this exists (2026-10-16). Every other test of `lib/sharia.mjs` asserts
 * what WE think the rules are. That cannot catch a misread standard: before
 * 2026-10-14 the engine used 33% limits and a 49% receivables test, both of
 * which are the index providers' numbers rather than AAOIFI's, and every test
 * passed the whole time because they encoded the same mistake. This fixture
 * is the first check against someone else's reading.
 *
 * Their `debt_ratio` and `cash_ratio` use MARKET CAP as the denominator,
 * which is Mizan's AAOIFI denominator, so the comparison is like for like.
 * Every row is decided by a ratio or income clause (§3/4, §3/4/2, §3/4/3,
 * §3/4/4) — none purely by sector — so `sector: "halal"` is passed and the
 * ratios alone decide, which is exactly the part under test.
 */
import { describe, it, expect } from 'vitest'
import { evaluateAgainst, STANDARDS } from '../../lib/sharia.mjs'
import bench from './fixtures/shariah-bench.json'

/** One instrument's line items → the shape evaluateAgainst expects. */
const asInput = (x) => ({
  sector: 'halal',
  debt: x.interestBearingDebtUsd,
  cash: x.cashAndSecuritiesUsd,
  recv: 0,
  mc: x.marketCapUsd,
  assets: x.totalAssetsUsd,
  nonPermPct: x.haramRevenuePct,
  // Their haram-revenue figure is a measured line item, not our "other income"
  // estimate, so it may fail the test as well as clear it.
  nonPermBasis: 'interest_income',
})

const verdictOf = (res) => (res.pass === true ? 'compliant' : res.pass === false ? 'non_compliant' : 'unknown')
const decisive = bench.instruments.filter((x) => x.aaoifiVerdict !== 'borderline')

describe('ShariahBench — our AAOIFI engine vs a third-party labelled set', () => {
  it('carries its attribution, as CC-BY-4.0 requires', () => {
    expect(bench._license).toMatch(/CC-BY-4\.0/)
    expect(bench._source).toMatch(/shariah-bench/)
  })

  it('covers both verdicts across several regions — not just easy passes', () => {
    const compliant = decisive.filter((x) => x.aaoifiVerdict === 'compliant').length
    const non = decisive.filter((x) => x.aaoifiVerdict === 'non_compliant').length
    expect(compliant).toBeGreaterThanOrEqual(15)
    expect(non).toBeGreaterThanOrEqual(15)
    expect(new Set(bench.instruments.map((x) => x.region)).size).toBeGreaterThanOrEqual(5)
  })

  it('agrees with every decisive verdict', () => {
    const disagreements = decisive
      .map((x) => ({ x, ours: verdictOf(evaluateAgainst(STANDARDS.AAOIFI, asInput(x))) }))
      .filter(({ x, ours }) => ours !== x.aaoifiVerdict)
      .map(({ x, ours }) => `${x.ticker} (${x.determiningClause}): they say ${x.aaoifiVerdict}, we say ${ours}` +
        ` [debt ${(100 * x.interestBearingDebtUsd / x.marketCapUsd).toFixed(1)}%,` +
        ` cash ${(100 * x.cashAndSecuritiesUsd / x.marketCapUsd).toFixed(1)}%,` +
        ` haram ${x.haramRevenuePct.toFixed(2)}%]`)

    expect(disagreements, `AAOIFI engine disagrees with ShariahBench on:\n  ${disagreements.join('\n  ')}`).toEqual([])
  })

  it('a name failing ONLY on impermissible income is caught — the test added 2026-10-14', () => {
    // EMAAR passes both ratio limits and fails at 5.15% haram revenue. Before
    // the income test ran, this one would have been called compliant.
    const emaar = bench.instruments.find((x) => x.ticker.startsWith('EMAAR'))
    expect(emaar.aaoifiVerdict).toBe('non_compliant')
    expect(100 * emaar.interestBearingDebtUsd / emaar.marketCapUsd).toBeLessThan(30)
    expect(100 * emaar.cashAndSecuritiesUsd / emaar.marketCapUsd).toBeLessThan(30)
    expect(emaar.haramRevenuePct).toBeGreaterThan(5)
    const res = evaluateAgainst(STANDARDS.AAOIFI, asInput(emaar))
    expect(res.pass).toBe(false)
    expect(res.fails.map((f) => f.rule)).toContain('Non-permissible income')
  })

  it('the set would catch a drift back to the index providers\' 33% limits', () => {
    // The guard that gives this fixture its teeth: if someone restored the old
    // thresholds, at least one instrument must change verdict. If this ever
    // fails, the fixture has stopped discriminating and needs more names.
    const wrong = { ...STANDARDS.AAOIFI, debtMax: 33, cashMax: 33, inclusive: false }
    const flipped = decisive.filter((x) =>
      verdictOf(evaluateAgainst(wrong, asInput(x))) !== verdictOf(evaluateAgainst(STANDARDS.AAOIFI, asInput(x))))
    expect(flipped.length).toBeGreaterThan(0)
  })
})
