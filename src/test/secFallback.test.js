// The SEC fallback WIRING: does it actually fire when Finnhub cannot establish
// debt, and does it stay out of the way when Finnhub can?
//
// The pure logic is covered in secFacts.test.js. This file exists because of a
// lesson this repo has learned five times: a green suite can hide a path that
// never runs. The live end-to-end check on 2026-10-16 resolved all twelve
// sample names through Finnhub, so the fallback was never exercised — which is
// correct behaviour and also exactly how a broken fallback would look.
import { describe, it, expect, vi, afterEach } from 'vitest'

async function freshSharia() {
  vi.resetModules()
  process.env.FINNHUB_KEY = 'test-key'
  delete process.env.ZOYA_API_KEY
  delete process.env.SEC_FALLBACK
  const mod = await import('../../lib/sharia.mjs')
  mod.configureFinnhubPacing({ perMinute: 1000, sleep: async () => {} })
  mod.configureSecPacing({ perSecond: 1000, sleep: async () => {} })
  return mod
}

const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const PROFILE = { finnhubIndustry: 'Semiconductors', marketCapitalization: 100_000, country: 'US', name: 'Test Co' }
const MM = 1e6
const RECENT = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10)

/** A SEC companyfacts document for a comfortably AAOIFI-passing filer. */
const SEC_FACTS = {
  facts: {
    'us-gaap': Object.fromEntries(Object.entries({
      Assets: 60_000, Liabilities: 20_000, CashAndCashEquivalentsAtCarryingValue: 2_000,
      AccountsReceivableNetCurrent: 1_000, LongTermDebtNoncurrent: 3_000, DebtCurrent: 500,
      RevenueFromContractWithCustomerExcludingAssessedTax: 40_000, InvestmentIncomeInterest: 200,
    }).map(([tag, mm]) => [tag, { units: { USD: [{ val: mm * MM, end: RECENT, form: '10-K', accn: '0000950170-26-000123', fy: 2026 }] } }])),
  },
}
const SEC_TICKERS = { 0: { cik_str: 789019, ticker: 'TST' } }

/**
 * @param finnhubDebt 'ok' → a usable debt/equity ratio; 'missing' → no ratio
 *   and an EMPTY balance sheet, the real failure this fallback is for.
 * @param sec 'ok' | 'down' | 'unknown-ticker'
 */
function stub({ finnhubDebt = 'missing', sec = 'ok' } = {}) {
  const calls = []
  return vi.fn(async (url) => {
    calls.push(url)
    if (url.includes('data.sec.gov')) return sec === 'down' ? json({}, 503) : json(SEC_FACTS)
    if (url.includes('www.sec.gov/files/company_tickers')) {
      return sec === 'unknown-ticker' ? json({}) : json(SEC_TICKERS)
    }
    if (url.includes('profile2')) return json(PROFILE)
    if (url.includes('stock/metric')) return json(finnhubDebt === 'ok' ? { metric: { 'totalDebt/totalEquityAnnual': 0.1 } } : { metric: {} })
    if (url.includes('financials-reported')) {
      return json(finnhubDebt === 'ok'
        ? { data: [{ year: 2025, report: { bs: [
            { concept: 'us-gaap_Assets', value: 50e9 }, { concept: 'us-gaap_Liabilities', value: 10e9 },
            { concept: 'us-gaap_StockholdersEquity', value: 40e9 },
          ], ic: [] } }] }
        : { data: [{ year: 2025, report: { bs: [], ic: [] } }] })   // the empty balance sheet
    }
    return json({}, 404)
  })
}

describe('SEC fallback wiring', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('fires when Finnhub cannot establish debt, and says so', async () => {
    const s = await freshSharia()
    vi.stubGlobal('fetch', stub({ finnhubDebt: 'missing', sec: 'ok' }))
    const v = await s.screenSymbol('TST')
    expect(v.source).toBe('sec')
    expect(v.debtKnown).toBe(true)
    expect(v.status).toBe('halal')
    expect(v.fiscalYear).toBe(2026)
    // 3,500 debt against a 100,000 market cap.
    expect(v.byStandard.AAOIFI.ratios.debtR).toBeCloseTo(3.5, 1)
  })

  it('cites the filing the verdict rests on', async () => {
    const s = await freshSharia()
    vi.stubGlobal('fetch', stub({ finnhubDebt: 'missing' }))
    const v = await s.screenSymbol('TST')
    expect(v.filing).toBe('https://www.sec.gov/Archives/edgar/data/789019/000095017026000123/0000950170-26-000123-index.htm')
  })

  it('stays OUT of the way when Finnhub has the debt', async () => {
    const s = await freshSharia()
    const fetchStub = stub({ finnhubDebt: 'ok' })
    vi.stubGlobal('fetch', fetchStub)
    const v = await s.screenSymbol('TST')
    expect(v.source).toBe('finnhub')
    expect(v.filing).toBeNull()
    expect(fetchStub.mock.calls.every(([u]) => !String(u).includes('sec.gov'))).toBe(true)
  })

  it('FAILS SOFT: a SEC outage leaves the verdict exactly where it was', async () => {
    // The property that makes this safe to put in the core screening path. If
    // this breaks, a fallback outage becomes a screening outage.
    const s = await freshSharia()
    vi.stubGlobal('fetch', stub({ finnhubDebt: 'missing', sec: 'down' }))
    const v = await s.screenSymbol('TST')
    expect(v.debtKnown).toBe(false)
    expect(v.status).toBe('review')     // unchanged from before the fallback existed
    expect(v.source).toBe('finnhub')
  })

  it('an unknown ticker (foreign filer, ETF) is not forced into a verdict', async () => {
    const s = await freshSharia()
    vi.stubGlobal('fetch', stub({ finnhubDebt: 'missing', sec: 'unknown-ticker' }))
    const v = await s.screenSymbol('TST')
    expect(v.debtKnown).toBe(false)
    expect(v.status).toBe('review')
  })

  it('SEC_FALLBACK=0 switches it off completely', async () => {
    vi.resetModules()
    process.env.FINNHUB_KEY = 'test-key'
    process.env.SEC_FALLBACK = '0'
    const s = await import('../../lib/sharia.mjs')
    s.configureFinnhubPacing({ perMinute: 1000, sleep: async () => {} })
    const fetchStub = stub({ finnhubDebt: 'missing' })
    vi.stubGlobal('fetch', fetchStub)
    const v = await s.screenSymbol('TST')
    expect(v.status).toBe('review')
    expect(fetchStub.mock.calls.every(([u]) => !String(u).includes('sec.gov'))).toBe(true)
    delete process.env.SEC_FALLBACK
  })

  it('sends the contact User-Agent SEC requires, or it would 403', async () => {
    const s = await freshSharia()
    const fetchStub = stub({ finnhubDebt: 'missing' })
    vi.stubGlobal('fetch', fetchStub)
    await s.screenSymbol('TST')
    const secCall = fetchStub.mock.calls.find(([u]) => String(u).includes('sec.gov'))
    expect(secCall[1].headers['User-Agent']).toMatch(/\S+@\S+|mizan/i)
  })
})
