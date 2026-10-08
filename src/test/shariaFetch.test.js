import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The screening engine reads FINNHUB_KEY at import, so each test imports a
// fresh copy of the module with a key set and fetch stubbed.
async function freshSharia() {
  vi.resetModules()
  process.env.FINNHUB_KEY = 'test-key'
  delete process.env.ZOYA_API_KEY
  const mod = await import('../../lib/sharia.mjs')
  mod.configureFinnhubPacing({ perMinute: 1000, sleep: async () => {} }) // no real waiting in tests
  return mod
}

// Minimal Finnhub responses for a clean, AAOIFI-passing company.
const PROFILE = { finnhubIndustry: 'Semiconductors', marketCapitalization: 100000, country: 'US', name: 'Test Co' }
const METRIC = { metric: { 'totalDebt/totalEquityAnnual': 0.1 } }
const FIN = { data: [{ report: { bs: [
  { concept: 'us-gaap_Assets', value: 50e9 },
  { concept: 'us-gaap_Liabilities', value: 10e9 },
  { concept: 'us-gaap_StockholdersEquity', value: 40e9 },
  { concept: 'us-gaap_CashAndCashEquivalentsAtCarryingValue', value: 2e9 },
  { concept: 'us-gaap_AccountsReceivableNetCurrent', value: 3e9 },
] } }] }

const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
function finnhubStub({ throttle = () => false } = {}) {
  const calls = []
  const fn = vi.fn(async (url) => {
    calls.push(url)
    if (throttle(url, calls.length)) return json({ error: 'API limit reached' }, 429)
    if (url.includes('profile2')) return json(PROFILE)
    if (url.includes('stock/metric')) return json(METRIC)
    if (url.includes('financials-reported')) return json(FIN)
    return json({}, 404)
  })
  fn.calls = calls
  return fn
}

describe('screening under Finnhub throttling', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('retries a throttled call and returns the REAL verdict', async () => {
    const s = await freshSharia()
    let first = true
    vi.stubGlobal('fetch', finnhubStub({ throttle: (u) => { if (u.includes('stock/metric') && first) { first = false; return true } return false } }))
    const v = await s.screenSymbol('TST')
    expect(v.byStandard.AAOIFI.pass).toBe(true)
    expect(v.status).toBe('halal')
  })

  it('a call still throttled after retries yields "unknown" — never a degraded "review" — and is NOT cached', async () => {
    // The 2026-10-07 defect: a 429 was read as "no data", the verdict fell to
    // "review", and that wrong answer was cached for the rest of the day.
    const s = await freshSharia()
    vi.stubGlobal('fetch', finnhubStub({ throttle: (u) => u.includes('financials-reported') }))
    const v1 = await s.screenSymbol('TST')
    expect(v1.status).toBe('unknown')
    expect(v1.reason).toMatch(/finnhub_unavailable/)

    // Throttling clears; the next request must re-screen, not serve the failure.
    vi.stubGlobal('fetch', finnhubStub())
    const v2 = await s.screenSymbol('TST')
    expect(v2.status).toBe('halal')
  })

  it('stamps the engine version, and the shared cache ignores entries from an older engine', async () => {
    const s = await freshSharia()
    const { SCREEN_ENGINE_VERSION } = await import('../lib/shariaVerdict.js')
    const fetchFn = finnhubStub()
    s.setScreenCache({ get: async () => ({ status: 'review', byStandard: {} }), set: async () => {} }) // pre-v2 entry
    vi.stubGlobal('fetch', fetchFn)
    const v = await s.screenSymbol('TST')
    expect(v.engine).toBe(SCREEN_ENGINE_VERSION)
    expect(v.status).toBe('halal')          // re-screened, not served the stale "review"
    expect(fetchFn).toHaveBeenCalled()
  })

  it('reads the shared cache before calling Finnhub, and writes only good verdicts to it', async () => {
    const s = await freshSharia()
    const store = new Map()
    s.setScreenCache({
      get: async (tk, day) => store.get(`${tk}|${day}`) || null,
      set: async (tk, day, v) => { store.set(`${tk}|${day}`, v) },
    })
    const fetchFn = finnhubStub()
    vi.stubGlobal('fetch', fetchFn)
    await s.screenSymbol('TST')
    expect([...store.keys()]).toHaveLength(1)

    // A fresh instance (cold serverless) finds it without touching Finnhub.
    const s2 = await freshSharia()
    s2.setScreenCache({ get: async (tk, day) => store.get(`${tk}|${day}`) || null, set: async () => {} })
    const coldFetch = finnhubStub()
    vi.stubGlobal('fetch', coldFetch)
    const v = await s2.screenSymbol('TST')
    expect(v.status).toBe('halal')
    expect(coldFetch).not.toHaveBeenCalled()
  })

  it('never writes a failed screen to the shared cache', async () => {
    const s = await freshSharia()
    const store = new Map()
    s.setScreenCache({ get: async () => null, set: async (tk, day, v) => { store.set(tk, v) } })
    vi.stubGlobal('fetch', finnhubStub({ throttle: (u) => u.includes('profile2') }))
    await s.screenSymbol('TST')
    expect(store.size).toBe(0)
  })

  it('a broken cache adapter never breaks screening', async () => {
    const s = await freshSharia()
    s.setScreenCache({ get: async () => { throw new Error('db down') }, set: async () => { throw new Error('db down') } })
    vi.stubGlobal('fetch', finnhubStub())
    expect((await s.screenSymbol('TST')).status).toBe('halal')
  })

  it('screenBatch stops at its time budget and marks the rest pending, uncached', async () => {
    const s = await freshSharia()
    vi.stubGlobal('fetch', finnhubStub())
    const r = await s.screenBatch(['AAA', 'BBB', 'CCC', 'DDD'], { budgetMs: -1 })
    for (const tk of ['AAA', 'BBB', 'CCC', 'DDD']) expect(r[tk]).toMatchObject({ status: 'unknown', reason: 'pending' })
  })
})

describe('Finnhub pacing', () => {
  it('waits rather than exceeding the per-minute limit', async () => {
    const s = await freshSharia()
    const waits = []
    let now = 0
    s.configureFinnhubPacing({ perMinute: 2, sleep: async (ms) => { waits.push(ms); now += ms }, now: () => now })
    vi.stubGlobal('fetch', finnhubStub())
    await s.screenSymbol('TST')     // 3 calls under a limit of 2/min
    expect(waits.length).toBeGreaterThan(0)
    expect(Math.max(...waits)).toBeGreaterThan(0)
    vi.unstubAllGlobals()
  })
})
