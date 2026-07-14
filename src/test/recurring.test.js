import { describe, it, expect } from 'vitest'
import {
  normalizeMerchant,
  cadenceFromDates,
  detectRecurringOutflows,
  normalizePlaidStreams,
  scoreDebtStream,
  matchDebtToStream,
  streamPaymentsSince,
  isSubscriptionCandidate,
  isRecurringActive,
  detectFixedPriceSubscriptions,
  detectUsageBasedSpend,
} from '../lib/recurring.js'

describe('normalizeMerchant', () => {
  it('strips ref numbers, payment noise, and casing so a payee matches across months', () => {
    expect(normalizeMerchant('Guidance Residential ACH 8842')).toBe('GUIDANCE RESIDENTIAL')
    expect(normalizeMerchant('CHASE CREDIT CRD AUTOPAY XX3344')).toBe('CHASE CREDIT CRD') // AUTOPAY + ref stripped (CREDIT/CARD filtered later by matcher stopwords)
    expect(normalizeMerchant('Uber One')).toBe('UBER ONE')
  })
})

describe('cadenceFromDates', () => {
  it('detects monthly from ~30-day gaps', () => {
    expect(cadenceFromDates(['2026-01-03', '2026-02-02', '2026-03-04']).cadence).toBe('monthly')
  })
  it('detects weekly and biweekly', () => {
    expect(cadenceFromDates(['2026-01-01', '2026-01-08', '2026-01-15']).cadence).toBe('weekly')
    expect(cadenceFromDates(['2026-01-01', '2026-01-15', '2026-01-29']).cadence).toBe('biweekly')
  })
  it('returns unknown for a single date', () => {
    expect(cadenceFromDates(['2026-01-01']).cadence).toBe('unknown')
  })
})

describe('detectRecurringOutflows', () => {
  const txns = [
    { name: 'GUIDANCE RESIDENTIAL ACH 8842', amount: 1800, date: '2026-01-05' },
    { name: 'GUIDANCE RESIDENTIAL ACH 9001', amount: 1800, date: '2026-02-04' },
    { name: 'GUIDANCE RESIDENTIAL ACH 1123', amount: 1800, date: '2026-03-05' },
    { name: 'Trader Joes', amount: 62.4, date: '2026-02-10' },           // one-off, dropped
    { name: 'PAYROLL DEPOSIT', amount: -5000, date: '2026-02-01' },       // inflow, ignored
  ]
  it('keeps merchants with >=2 outflows and infers a monthly cadence + typical amount', () => {
    const streams = detectRecurringOutflows(txns)
    expect(streams).toHaveLength(1)
    expect(streams[0].merchant).toMatch(/GUIDANCE/i)
    expect(streams[0].typicalAmount).toBe(1800)
    expect(streams[0].cadence).toBe('monthly')
    expect(streams[0].count).toBe(3)
  })
  it('ignores inflows and one-offs', () => {
    const keys = detectRecurringOutflows(txns).map((s) => s.key)
    expect(keys.some((k) => k.includes('PAYROLL'))).toBe(false)
    expect(keys.some((k) => k.includes('TRADER'))).toBe(false)
  })
})

describe('normalizePlaidStreams', () => {
  it('adapts Plaid outflow_streams to the common shape', () => {
    const streams = normalizePlaidStreams({
      outflow_streams: [
        { merchant_name: 'Chase Card', average_amount: { amount: 250 }, last_amount: { amount: 260 }, frequency: 'MONTHLY', last_date: '2026-03-01', transaction_ids: ['a', 'b', 'c'] },
      ],
    })
    expect(streams[0].merchant).toBe('Chase Card')
    expect(streams[0].typicalAmount).toBe(250)
    expect(streams[0].cadence).toBe('monthly')
    expect(streams[0].count).toBe(3)
  })
})

describe('scoreDebtStream + matchDebtToStream', () => {
  const streams = [
    { key: 'GUIDANCE RESIDENTIAL', merchant: 'Guidance Residential', typicalAmount: 1800 },
    { key: 'NETFLIX', merchant: 'Netflix', typicalAmount: 15.49 },
    { key: 'CHASE', merchant: 'Chase Card Autopay', typicalAmount: 300 },
  ]
  it('matches a debt to the stream sharing its creditor name', () => {
    const debt = { name: 'Auto Financing (Ijara)', creditor: 'Guidance Residential' }
    const m = matchDebtToStream(debt, streams, { expectedAmount: 1800 })
    expect(m).not.toBeNull()
    expect(m.stream.merchant).toMatch(/Guidance/)
    expect(m.score).toBeGreaterThan(0.6)
  })
  it('does not match when no creditor token overlaps', () => {
    const debt = { name: 'Loan from my brother', creditor: 'Yusuf' }
    expect(matchDebtToStream(debt, streams, { expectedAmount: 500 })).toBeNull()
  })
  it('amount proximity refines the score but name overlap is required', () => {
    const wrongAmount = scoreDebtStream({ creditor: 'Guidance Residential' }, streams[0], 999999)
    const rightAmount = scoreDebtStream({ creditor: 'Guidance Residential' }, streams[0], 1800)
    expect(rightAmount).toBeGreaterThan(wrongAmount)
    // a stream with zero name overlap scores 0 regardless of amount
    expect(scoreDebtStream({ creditor: 'Yusuf' }, streams[0], 1800)).toBe(0)
  })
})

describe('streamPaymentsSince', () => {
  it('returns positive-amount posted payments on/after a date', () => {
    const stream = { txns: [
      { date: '2025-12-05', amount: 1800 },
      { date: '2026-01-05', amount: 1800 },
      { date: '2026-02-04', amount: 1800 },
    ] }
    const pays = streamPaymentsSince(stream, '2026-01-01')
    expect(pays).toHaveLength(2)
    expect(pays.every((p) => p.amount === 1800)).toBe(true)
  })
})

describe('isSubscriptionCandidate', () => {
  it('keeps ordinary subscriptions', () => {
    expect(isSubscriptionCandidate('Spotify', 'ENTERTAINMENT')).toBe(true)
    expect(isSubscriptionCandidate('Google Workspace', 'GENERAL_SERVICES')).toBe(true)
  })
  it('keeps subscriptions Plaid mis-tags as TRANSFER_OUT (the reported bug)', () => {
    // Grok/xAI and Coinbase One came back tagged TRANSFER_OUT in prod and were
    // being dropped by the old blanket category filter.
    expect(isSubscriptionCandidate('Grok Xai', 'TRANSFER_OUT')).toBe(true)
    expect(isSubscriptionCandidate('OpenAI', 'GENERAL_SERVICES')).toBe(true)
  })
  it('drops true money movement even when it recurs', () => {
    expect(isSubscriptionCandidate('Fidelity', 'TRANSFER_OUT')).toBe(false)
    expect(isSubscriptionCandidate('Robinhood', 'TRANSFER_OUT')).toBe(false)
    expect(isSubscriptionCandidate('Zelle to Yusuf', 'TRANSFER_OUT')).toBe(false)
    expect(isSubscriptionCandidate('Remitly', 'TRANSFER_OUT')).toBe(false)
  })
  it('drops card/loan payments and never-sub categories', () => {
    expect(isSubscriptionCandidate('CHASE CREDIT CARD PAYMENT', 'LOAN_PAYMENTS')).toBe(false)
    expect(isSubscriptionCandidate('Monthly Service Fee', 'BANK_FEES')).toBe(false)
    expect(isSubscriptionCandidate('Payroll', 'INCOME')).toBe(false)
    expect(isSubscriptionCandidate('', 'GENERAL_SERVICES')).toBe(false)
  })
})

describe('isRecurringActive', () => {
  const asOf = new Date('2026-07-13T00:00:00Z').getTime()
  it('monthly: active within a cycle, stopped once ~1.35 cycles elapse', () => {
    expect(isRecurringActive('2026-06-15', 'monthly', asOf)).toBe(true)  // 28 days
    expect(isRecurringActive('2026-05-01', 'monthly', asOf)).toBe(false) // 73 days
  })
  it('weekly reads stopped much sooner than monthly', () => {
    expect(isRecurringActive('2026-07-06', 'weekly', asOf)).toBe(true)   // 7 days
    expect(isRecurringActive('2026-06-20', 'weekly', asOf)).toBe(false)  // 23 days
  })
  it('annual is not killed a month after its charge', () => {
    expect(isRecurringActive('2025-09-01', 'annual', asOf)).toBe(true)   // ~315 days
  })
  it('irregular/unknown cadence falls back to the monthly window', () => {
    expect(isRecurringActive('2026-06-30', 'irregular', asOf)).toBe(true)
    expect(isRecurringActive('2026-04-01', 'irregular', asOf)).toBe(false)
  })
  it('returns false on missing/garbage dates', () => {
    expect(isRecurringActive('', 'monthly', asOf)).toBe(false)
    expect(isRecurringActive('not-a-date', 'monthly', asOf)).toBe(false)
  })
})

describe('detectFixedPriceSubscriptions', () => {
  const asOf = new Date('2026-07-13T00:00:00Z').getTime()
  const pfc = (primary) => ({ personal_finance_category: { primary } })
  const charge = (merchant, amount, date, primary) => ({ merchant_name: merchant, amount, date, ...pfc(primary) })

  it('detects a fixed-price monthly sub across ≥2 months', () => {
    const txns = [
      charge('Grok Xai', 30, '2026-05-29', 'TRANSFER_OUT'), // Plaid mis-tag kept
      charge('Grok Xai', 30, '2026-06-29', 'TRANSFER_OUT'),
    ]
    const subs = detectFixedPriceSubscriptions(txns, { asOfMs: asOf })
    expect(subs.map((s) => s.merchant)).toContain('Grok Xai')
    const grok = subs.find((s) => s.merchant === 'Grok Xai')
    expect(grok.avgPerCharge).toBe(30)
    expect(grok.cadence).toBe('monthly')
  })

  it('excludes variable-amount spend (high coefficient of variation)', () => {
    const txns = [
      charge('Amazon', 12.40, '2026-04-06', 'GENERAL_MERCHANDISE'),
      charge('Amazon', 58.10, '2026-05-06', 'GENERAL_MERCHANDISE'),
      charge('Amazon', 31.00, '2026-06-06', 'GENERAL_MERCHANDISE'),
    ]
    expect(detectFixedPriceSubscriptions(txns, { asOfMs: asOf })).toHaveLength(0)
  })

  it('excludes fixed-amount coincidences in discretionary categories (food)', () => {
    const txns = [
      charge('Corner Coffee', 5, '2026-05-01', 'FOOD_AND_DRINK'),
      charge('Corner Coffee', 5, '2026-06-01', 'FOOD_AND_DRINK'),
    ]
    expect(detectFixedPriceSubscriptions(txns, { asOfMs: asOf })).toHaveLength(0)
  })

  it('excludes true transfers even at a fixed amount', () => {
    const txns = [
      charge('Fidelity', 1000, '2026-05-04', 'TRANSFER_OUT'),
      charge('Fidelity', 1000, '2026-06-04', 'TRANSFER_OUT'),
    ]
    expect(detectFixedPriceSubscriptions(txns, { asOfMs: asOf })).toHaveLength(0)
  })

  it('requires the merchant to span ≥2 distinct months', () => {
    const txns = [
      charge('Netlify', 11.20, '2026-06-05', 'GENERAL_SERVICES'),
      charge('Netlify', 11.20, '2026-06-19', 'GENERAL_SERVICES'), // same month
    ]
    expect(detectFixedPriceSubscriptions(txns, { asOfMs: asOf })).toHaveLength(0)
  })

  it('marks a stopped fixed-price sub inactive by cadence', () => {
    const txns = [
      charge('Shopify', 64, '2026-04-22', 'GENERAL_SERVICES'),
      charge('Shopify', 64, '2026-05-22', 'GENERAL_SERVICES'), // last 52 days before asOf
    ]
    const subs = detectFixedPriceSubscriptions(txns, { asOfMs: asOf })
    expect(subs).toHaveLength(1)
    expect(subs[0].active).toBe(false)
  })
})

describe('detectUsageBasedSpend', () => {
  const asOf = new Date('2026-07-13T00:00:00Z').getTime()
  const charge = (merchant, amount, date, primary) => ({
    merchant_name: merchant, amount, date, personal_finance_category: { primary },
  })
  // Anthropic-style metered billing: many variable charges across ≥3 months.
  const anthropic = [
    charge('Anthropic', 10, '2026-04-05', 'GENERAL_SERVICES'),
    charge('Anthropic', 22, '2026-04-20', 'GENERAL_SERVICES'),
    charge('Anthropic', 8,  '2026-05-03', 'GENERAL_SERVICES'),
    charge('Anthropic', 30, '2026-05-19', 'GENERAL_SERVICES'),
    charge('Anthropic', 14, '2026-06-02', 'GENERAL_SERVICES'),
    charge('Anthropic', 16, '2026-06-15', 'GENERAL_SERVICES'),
  ]

  it('surfaces high-frequency variable service spend as a monthly run-rate', () => {
    const [a] = detectUsageBasedSpend(anthropic, { asOfMs: asOf })
    expect(a.merchant).toBe('Anthropic')
    expect(a.usage).toBe(true)
    expect(a.cadence).toBe('usage')
    expect(a.estMonthly).toBeCloseTo(100 / 3, 4) // total ÷ 3 distinct months
  })

  it('ignores fixed-price vendors (those belong to the fixed-price detector)', () => {
    const fixed = ['2026-04-05', '2026-04-20', '2026-05-03', '2026-05-19', '2026-06-02', '2026-06-15']
      .map((d) => charge('OpenAI', 20, d, 'GENERAL_SERVICES'))
    expect(detectUsageBasedSpend(fixed, { asOfMs: asOf })).toHaveLength(0)
  })

  it('ignores a few one-off service purchases (below the charge floor)', () => {
    const oneOffs = [
      charge('Vistaprint', 126, '2026-06-22', 'GENERAL_SERVICES'),
      charge('Vistaprint', 90, '2026-07-05', 'GENERAL_SERVICES'),
    ]
    expect(detectUsageBasedSpend(oneOffs, { asOfMs: asOf })).toHaveLength(0)
  })

  it('is scoped to GENERAL_SERVICES — not variable retail/food spend', () => {
    const amazon = anthropic.map((t) => ({ ...t, merchant_name: 'Amazon', personal_finance_category: { primary: 'GENERAL_MERCHANDISE' } }))
    expect(detectUsageBasedSpend(amazon, { asOfMs: asOf })).toHaveLength(0)
  })
})
