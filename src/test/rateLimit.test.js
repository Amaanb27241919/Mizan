import { describe, it, expect } from 'vitest'
import { matchAction, RATE_LIMITS } from '../../lib/rateLimit.mjs'

describe('matchAction — rate-limit bucket routing', () => {
  it('routes the Order Ticket quote (intent=order) to its dedicated bucket', () => {
    expect(matchAction('/api/finnhub/quote', 'symbols=AAPL&intent=order')).toBe('marketdata.ticket')
    expect(matchAction('/api/finnhub/quote', 'intent=order&symbols=AAPL')).toBe('marketdata.ticket')
  })

  it('routes ordinary quote polling to the shared marketdata bucket', () => {
    expect(matchAction('/api/finnhub/quote', 'symbols=SPY,QQQ,AAPL')).toBe('marketdata')
    expect(matchAction('/api/finnhub/news', '')).toBe('marketdata')
    expect(matchAction('/api/polygon/agg', '')).toBe('marketdata')
    expect(matchAction('/api/metals/spot', '')).toBe('marketdata')
  })

  it('does not let a bare "intent" or a different value hijack the ticket bucket', () => {
    expect(matchAction('/api/finnhub/quote', 'symbols=AAPL')).toBe('marketdata')
    expect(matchAction('/api/finnhub/quote', 'symbols=AAPL&intent=poll')).toBe('marketdata')
  })

  it('keeps the other buckets intact', () => {
    expect(matchAction('/api/plaid/transactions', 'sync=1')).toBe('plaid.sync')
    expect(matchAction('/api/plaid/accounts', '')).toBe('plaid')
    expect(matchAction('/api/advisor', '')).toBe('anthropic')
    expect(matchAction('/api/something-else', '')).toBe('default')
  })

  it('sizes the ticket bucket generously but bounded (a debounced single-symbol lookup)', () => {
    expect(RATE_LIMITS['marketdata.ticket']).toBe(240)
    expect(RATE_LIMITS['marketdata.ticket']).toBeGreaterThan(RATE_LIMITS['marketdata'])
  })
})
