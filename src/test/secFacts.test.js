// SEC XBRL → screening fundamentals. Every case here is a shape observed in
// the live API on 2026-10-16, not an invented one, and the ones that matter
// most are the two traps that produce a CONFIDENT WRONG NUMBER rather than an
// error: a filer abandoning a tag (stale value, forever) and a filer naming
// long-term debt something the chain does not list (debt understated by 94%).
import { describe, it, expect } from 'vitest'
import { pickFact, debtFromFacts, fundamentalsFromFacts, filingUrl, cikMapFromJson, MAX_AGE_DAYS } from '../../lib/market/secFacts.mjs'

/** Build a companyfacts document from { tag: [[value, end, form?]] }. */
const facts = (spec) => ({
  facts: {
    'us-gaap': Object.fromEntries(Object.entries(spec).map(([tag, rows]) => [tag, {
      units: { USD: rows.map(([val, end, form = '10-K']) => ({ val, end, form, accn: `000-${end}`, fy: Number(String(end).slice(0, 4)) })) },
    }])),
  },
})
const MM = 1e6
const RECENT = '2026-06-30'
const OLD = '2019-09-30'

describe('pickFact', () => {
  it('takes the first tag that has a usable value, in preference order', () => {
    const f = facts({ Assets: [[100, RECENT]], Liabilities: [[40, RECENT]] })
    expect(pickFact(f, ['Missing', 'Assets'], { after: '2025-01-01' })).toMatchObject({ value: 100, tag: 'Assets' })
  })

  it('returns the NEWEST row of a tag, not the first', () => {
    const f = facts({ Assets: [[100, '2024-06-30'], [300, RECENT], [200, '2025-06-30']] })
    expect(pickFact(f, ['Assets'], { after: '2024-01-01' }).value).toBe(300)
  })

  it('refuses a value older than the floor — the abandoned-tag trap', () => {
    // P&G's newest CashAndCashEquivalentsAtCarryingValue row is from 2019;
    // they moved to another tag. Without the floor this pairs a seven-year-old
    // cash figure with this year's assets and reports a plausible wrong ratio.
    const f = facts({ CashAndCashEquivalentsAtCarryingValue: [[9999, OLD]] })
    expect(pickFact(f, ['CashAndCashEquivalentsAtCarryingValue'], { after: '2025-06-01' })).toBeNull()
    expect(pickFact(f, ['CashAndCashEquivalentsAtCarryingValue'], { after: '2015-01-01' }).value).toBe(9999)
  })

  it('ignores forms that are not periodic reports', () => {
    const f = facts({ Assets: [[100, RECENT, '8-K'], [50, RECENT, 'S-1']] })
    expect(pickFact(f, ['Assets'], { after: '2025-01-01' })).toBeNull()
  })

  it('accepts the foreign-filer report forms', () => {
    for (const form of ['10-K', '10-Q', '20-F', '40-F']) {
      expect(pickFact(facts({ Assets: [[7, RECENT, form]] }), ['Assets'], { after: '2025-01-01' }).value).toBe(7)
    }
  })

  it('survives malformed input rather than throwing', () => {
    for (const bad of [null, undefined, {}, 'nope', 42, { facts: null }, { facts: { 'us-gaap': 'x' } }]) {
      expect(pickFact(bad, ['Assets'], { after: '2020-01-01' })).toBeNull()
    }
    expect(pickFact(facts({ Assets: [[1, RECENT]] }), null, {})).toBeNull()
    expect(pickFact(facts({ Assets: [[1, RECENT]] }), ['Assets'], null)).toMatchObject({ value: 1 })
  })
})

describe('debtFromFacts — never understate', () => {
  const after = '2025-06-01'

  it('prefers the explicitly combined total', () => {
    const f = facts({ DebtLongtermAndShorttermCombinedAmount: [[129541, RECENT]], LongTermDebt: [[1, RECENT]], Liabilities: [[200000, RECENT]] })
    expect(debtFromFacts(f, { after }).value).toBe(129541)
  })

  it('does not double-count the current portion of long-term debt', () => {
    // Cisco, verified live: LongTermDebt 22,872 already contains the 3,500
    // current portion, and DebtCurrent 10,161 contains it too. Summing both
    // would report 33,033 against a true 29,533.
    const f = facts({
      LongTermDebt: [[22872, RECENT]], LongTermDebtNoncurrent: [[19372, RECENT]],
      LongTermDebtCurrent: [[3500, RECENT]], DebtCurrent: [[10161, RECENT]], Liabilities: [[60000, RECENT]],
    })
    expect(debtFromFacts(f, { after }).value).toBe(29533)
  })

  it('derives the long-term portion when only the total and current are tagged', () => {
    const f = facts({ LongTermDebt: [[40294, RECENT]], LongTermDebtCurrent: [[9227, RECENT]], Liabilities: [[100000, RECENT]] })
    // 31,067 noncurrent + 9,227 current = the 40,294 total, not 49,521.
    expect(debtFromFacts(f, { after }).value).toBe(40294)
  })

  it('REFUSES current-only debt — the Oracle trap', () => {
    // Oracle tags long-term debt as LongTermNotesPayable ($122bn). A chain
    // that misses it finds only DebtCurrent ($7.2bn) and would bless a
    // heavily leveraged company. Unknown is the correct answer here.
    const f = facts({ DebtCurrent: [[7199, RECENT]], Liabilities: [[150000, RECENT]] })
    expect(debtFromFacts(f, { after })).toBeNull()
  })

  it('finds long-term debt under the alternative names filers actually use', () => {
    for (const tag of ['LongTermDebtNoncurrent', 'LongTermNotesPayable', 'SeniorNotesNoncurrent']) {
      const f = facts({ [tag]: [[122342, RECENT]], DebtCurrent: [[7199, RECENT]], Liabilities: [[200000, RECENT]] })
      expect(debtFromFacts(f, { after }).value).toBe(129541)
    }
  })

  it('refuses a total that exceeds total liabilities — a misread tag', () => {
    const f = facts({ LongTermDebtNoncurrent: [[500000, RECENT]], Liabilities: [[1000, RECENT]] })
    expect(debtFromFacts(f, { after })).toBeNull()
  })

  it('reports a genuine zero as zero, not as unknown', () => {
    const f = facts({ LongTermDebtNoncurrent: [[0, RECENT]], Liabilities: [[5000, RECENT]] })
    expect(debtFromFacts(f, { after })).toMatchObject({ value: 0 })
  })

  it('sums the short-term borrowing lines when there is no DebtCurrent', () => {
    const f = facts({
      LongTermDebtNoncurrent: [[1000, RECENT]], CommercialPaper: [[300, RECENT]],
      ShortTermBorrowings: [[200, RECENT]], Liabilities: [[9000, RECENT]],
    })
    expect(debtFromFacts(f, { after }).value).toBe(1500)
  })

  it('cites each tag once, although the current portion is used twice', () => {
    // Coca-Cola's shape: the long-term total includes the current portion, so
    // the code subtracts it and adds it back. The arithmetic is right; the
    // citation trail must not read as if it double-counted.
    const f = facts({
      LongTermDebtAndCapitalLeaseObligations: [[39065, RECENT]],
      LongTermDebtAndCapitalLeaseObligationsCurrent: [[4493, RECENT]],
      NotesAndLoansPayable: [[332, RECENT]], Liabilities: [[80000, RECENT]],
    })
    const d = debtFromFacts(f, { after })
    expect(d.value).toBe(39397)
    const tags = d.parts.map((p) => p.tag)
    expect(new Set(tags).size).toBe(tags.length)
  })

  it('excludes operating leases — rent is not riba', () => {
    // Buckle's only liabilities are store leases. Counting them as debt would
    // fail a genuinely debt-free retailer on an ijara-like obligation.
    const f = facts({ OperatingLeaseLiability: [[421, RECENT]], OperatingLeaseLiabilityNoncurrent: [[340, RECENT]], Liabilities: [[600, RECENT]] })
    expect(debtFromFacts(f, { after })).toBeNull()
  })

  it('is null when nothing debt-like is tagged at all', () => {
    expect(debtFromFacts(facts({ Assets: [[100, RECENT]] }), { after })).toBeNull()
    expect(debtFromFacts(null, { after })).toBeNull()
  })
})

describe('fundamentalsFromFacts', () => {
  const full = () => facts({
    Assets: [[300000 * MM, RECENT]],
    Liabilities: [[200000 * MM, RECENT]],
    CashAndCashEquivalentsAtCarryingValue: [[10000 * MM, RECENT]],
    ShortTermInvestments: [[5000 * MM, RECENT]],
    AccountsReceivableNetCurrent: [[7000 * MM, RECENT]],
    LongTermDebtNoncurrent: [[30000 * MM, RECENT]],
    DebtCurrent: [[2000 * MM, RECENT]],
    RevenueFromContractWithCustomerExcludingAssessedTax: [[50000 * MM, RECENT]],
    InvestmentIncomeInterest: [[500 * MM, RECENT]],
  })

  it('returns every figure in millions, to match the market-cap unit', () => {
    const f = fundamentalsFromFacts(full(), { now: new Date('2026-10-16') })
    expect(f).toMatchObject({ assets: 300000, cash: 15000, recv: 7000, debt: 32000, source: 'sec' })
  })

  it('does not add short-term investments twice when the cash tag includes them', () => {
    const f = fundamentalsFromFacts(facts({
      Assets: [[100 * MM, RECENT]],
      CashCashEquivalentsAndShortTermInvestments: [[20 * MM, RECENT]],
      ShortTermInvestments: [[8 * MM, RECENT]],
    }), { now: new Date('2026-10-16') })
    expect(f.cash).toBe(20)
  })

  it('measures impermissible income from interest, and marks an estimate as one', () => {
    const measured = fundamentalsFromFacts(full(), { now: new Date('2026-10-16') })
    expect(measured).toMatchObject({ nonPermPct: 1, nonPermBasis: 'interest_income' })

    const estimated = fundamentalsFromFacts(facts({
      Assets: [[100 * MM, RECENT]],
      Revenues: [[1000 * MM, RECENT]],
      OtherNonoperatingIncomeExpense: [[20 * MM, RECENT]],
    }), { now: new Date('2026-10-16') })
    expect(estimated).toMatchObject({ nonPermPct: 2, nonPermBasis: 'other_income_estimate' })
  })

  it('leaves the income test unmeasured rather than guessing', () => {
    const f = fundamentalsFromFacts(facts({ Assets: [[100 * MM, RECENT]], Revenues: [[1000 * MM, RECENT]] }), { now: new Date('2026-10-16') })
    expect(f.nonPermPct).toBeNull()
    expect(f.nonPermBasis).toBeNull()
  })

  it('carries the filing it rests on, so a verdict can cite evidence', () => {
    const f = fundamentalsFromFacts(full(), { now: new Date('2026-10-16') })
    expect(f.periodEnd).toBe(RECENT)
    expect(f.form).toBe('10-K')
    expect(f.accession).toBe(`000-${RECENT}`)
    expect(f.fiscalYear).toBe(2026)
  })

  it('passes debt through as null when it cannot be established — fail closed', () => {
    const f = fundamentalsFromFacts(facts({ Assets: [[100 * MM, RECENT]], DebtCurrent: [[7 * MM, RECENT]], Liabilities: [[90 * MM, RECENT]] }), { now: new Date('2026-10-16') })
    expect(f.debt).toBeNull()
    expect(f.debtTags).toEqual([])
  })

  it('is null when there is no recent filing at all', () => {
    expect(fundamentalsFromFacts(facts({ Assets: [[100 * MM, OLD]] }), { now: new Date('2026-10-16') })).toBeNull()
    expect(fundamentalsFromFacts(facts({}), { now: new Date('2026-10-16') })).toBeNull()
    for (const bad of [null, undefined, {}, 'x', 7]) expect(fundamentalsFromFacts(bad, {})).toBeNull()
  })

  it('the recency floor is the stated window, measured from now', () => {
    const now = new Date('2026-10-16')
    const justInside = new Date(now.getTime() - (MAX_AGE_DAYS - 2) * 86400000).toISOString().slice(0, 10)
    const justOutside = new Date(now.getTime() - (MAX_AGE_DAYS + 2) * 86400000).toISOString().slice(0, 10)
    expect(fundamentalsFromFacts(facts({ Assets: [[1 * MM, justInside]] }), { now })).not.toBeNull()
    expect(fundamentalsFromFacts(facts({ Assets: [[1 * MM, justOutside]] }), { now })).toBeNull()
  })
})

describe('citation helpers', () => {
  it('builds the filing index URL', () => {
    expect(filingUrl('0000789019', '0000950170-26-000123'))
      .toBe('https://www.sec.gov/Archives/edgar/data/789019/000095017026000123/0000950170-26-000123-index.htm')
  })
  it('refuses to invent a URL from missing parts', () => {
    expect(filingUrl(null, 'x')).toBeNull()
    expect(filingUrl('123', null)).toBeNull()
  })
  it('maps tickers to zero-padded CIKs, first listing winning', () => {
    const m = cikMapFromJson({ 0: { cik_str: 789019, ticker: 'msft' }, 1: { cik_str: 320193, ticker: 'AAPL' }, 2: { cik_str: 1, ticker: 'MSFT' } })
    expect(m.MSFT).toBe('0000789019')
    expect(m.AAPL).toBe('0000320193')
  })
  it('survives a malformed map', () => {
    for (const bad of [null, 'x', 7, { 0: null }, { 0: { cik_str: 'nope', ticker: 'X' } }]) expect(cikMapFromJson(bad)).toEqual({})
  })
})
