// Ticker typeahead for the Screener's "screen any ticker" lookup.
//
// Payload shapes below are taken from live Finnhub /search responses
// (2026-08-10, exchange=US), not invented — including BRK.A, which is why
// dotted symbols must survive the filter: class shares are screenable.
import { describe, it, expect } from 'vitest'
import {
  normalizeQuery,
  normalizeSymbolSearch,
  MAX_QUERY_LEN,
  MAX_SUGGESTIONS,
} from '../../lib/market/symbolSearch.mjs'

describe('normalizeQuery', () => {
  it('accepts an ordinary company name', () => {
    expect(normalizeQuery('apple')).toEqual({ ok: true, q: 'apple' })
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeQuery('  nvidia  ')).toEqual({ ok: true, q: 'nvidia' })
  })

  it('rejects empty and whitespace-only input rather than querying upstream', () => {
    for (const bad of ['', '   ', null, undefined]) {
      expect(normalizeQuery(bad).ok).toBe(false)
    }
  })

  it('rejects an over-long query', () => {
    expect(normalizeQuery('a'.repeat(MAX_QUERY_LEN + 1)).ok).toBe(false)
    expect(normalizeQuery('a'.repeat(MAX_QUERY_LEN)).ok).toBe(true)
  })

  it('keeps the punctuation that appears in real company names', () => {
    expect(normalizeQuery("Berkshire Hathaway").q).toBe('Berkshire Hathaway')
    expect(normalizeQuery("Smucker's").q).toBe("Smucker's")
    expect(normalizeQuery('AT&T').q).toBe('AT&T')
    expect(normalizeQuery('BRK.A').q).toBe('BRK.A')
    expect(normalizeQuery('Coca-Cola').q).toBe('Coca-Cola')
  })

  it('strips characters that could reach the upstream URL, without blanking the query', () => {
    // Stripped rather than rejected so a stray keystroke doesn't kill the
    // dropdown mid-typing.
    expect(normalizeQuery('app<le>').q).toBe('apple')
    expect(normalizeQuery('nvda&token=leak').q).toBe('nvda&tokenleak')
    expect(normalizeQuery('a/../b').q).toBe('a..b')
  })

  it('rejects a query that is only illegal characters', () => {
    expect(normalizeQuery('<<>>').ok).toBe(false)
  })
})

describe('normalizeSymbolSearch', () => {
  const finnhub = {
    count: 4,
    result: [
      { description: 'NVIDIA Corp', displaySymbol: 'NVDA', symbol: 'NVDA', type: 'Common Stock' },
      { description: 'Berkshire Hathaway Inc', displaySymbol: 'BRK.A', symbol: 'BRK.A', type: 'Common Stock' },
      { description: 'Apple Hospitality REIT Inc', displaySymbol: 'APLE', symbol: 'APLE', type: 'Common Stock' },
    ],
  }

  it('shapes the payload into {symbol, name, type}', () => {
    expect(normalizeSymbolSearch(finnhub)[0]).toEqual({
      symbol: 'NVDA', name: 'NVIDIA Corp', type: 'Common Stock',
    })
  })

  it('keeps dotted class shares — BRK.A is screenable', () => {
    const out = normalizeSymbolSearch(finnhub)
    expect(out.map(s => s.symbol)).toContain('BRK.A')
  })

  it('preserves provider order and never reorders by any judgment', () => {
    // Compliance-relevant: this is a name matcher. Reordering by desirability
    // would turn an impersonal lookup into a ranked recommendation.
    expect(normalizeSymbolSearch(finnhub).map(s => s.symbol)).toEqual(['NVDA', 'BRK.A', 'APLE'])
  })

  it('drops rows the screener could not screen', () => {
    const messy = { result: [
      { description: 'Foreign Listing', symbol: 'AAPL.SW.LONGER', type: 'Common Stock' },
      { description: '', symbol: 'NONAME', type: 'Common Stock' },
      { description: 'No Symbol Inc', symbol: '', type: 'Common Stock' },
      { description: 'A Warrant', symbol: 'WARR', type: 'Warrant' },
      { description: 'Lowercase Ok', symbol: 'good', type: 'Common Stock' },
    ] }
    expect(normalizeSymbolSearch(messy)).toEqual([
      { symbol: 'GOOD', name: 'Lowercase Ok', type: 'Common Stock' },
    ])
  })

  it('de-duplicates repeated symbols', () => {
    const dupes = { result: [
      { description: 'NVIDIA Corp', symbol: 'NVDA', type: 'Common Stock' },
      { description: 'NVIDIA Corp duplicate', symbol: 'NVDA', type: 'Common Stock' },
    ] }
    expect(normalizeSymbolSearch(dupes)).toHaveLength(1)
  })

  it('caps the list', () => {
    const many = { result: Array.from({ length: 40 }, (_, i) => ({
      description: `Co ${i}`, symbol: `SYM${i}`, type: 'Common Stock',
    })) }
    expect(normalizeSymbolSearch(many)).toHaveLength(MAX_SUGGESTIONS)
    expect(normalizeSymbolSearch(many, { limit: 3 })).toHaveLength(3)
  })

  it('returns [] for junk instead of throwing — a broken feed must not break typing', () => {
    for (const bad of [null, undefined, {}, { result: null }, { result: 'nope' }, 42]) {
      expect(normalizeSymbolSearch(bad)).toEqual([])
    }
  })
})
