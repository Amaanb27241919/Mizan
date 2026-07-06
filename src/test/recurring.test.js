import { describe, it, expect } from 'vitest'
import {
  normalizeMerchant,
  cadenceFromDates,
  detectRecurringOutflows,
  normalizePlaidStreams,
  scoreDebtStream,
  matchDebtToStream,
  streamPaymentsSince,
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
