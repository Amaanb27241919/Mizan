// Region eligibility + currency integrity.
//
// Context: until 2026-07-31 a Vercel middleware rewrote EVERY non-US visitor
// to /us-only.html, so a Canadian user never reached the app. That block was
// narrowed to the Plaid bank-linking path only. These tests pin the two things
// that narrowing depends on staying correct:
//   1. exactly who is eligible (and that unknown fails OPEN, not closed)
//   2. that a non-USD balance can never be silently summed as USD
import { describe, it, expect } from 'vitest'
import {
  isPlaidEligible, isUsTaxJurisdiction, normalizeCountry, countryFromHeaders,
  PLAID_COUNTRIES, US_TAX_COUNTRIES, COUNTRY_HEADER, COUNTRY_COOKIE,
} from '../../lib/geo.mjs'
import {
  countryFromCookie, canConnectBank, showsUsTaxTools,
  nonUsdAccounts, hasNonUsdAccounts, foreignCurrencyCodes,
} from '../lib/region.js'

describe('isPlaidEligible', () => {
  it('allows the US and the US territories Plaid treats as US', () => {
    for (const cc of PLAID_COUNTRIES) expect(isPlaidEligible(cc)).toBe(true)
    expect(PLAID_COUNTRIES).toContain('PR')
  })

  it('refuses Canada — the case that motivated the change', () => {
    expect(isPlaidEligible('CA')).toBe(false)
  })

  it('refuses other non-US countries', () => {
    for (const cc of ['GB', 'AE', 'PK', 'MY', 'SA', 'DE']) {
      expect(isPlaidEligible(cc)).toBe(false)
    }
  })

  it('is case- and whitespace-insensitive', () => {
    expect(isPlaidEligible('us')).toBe(true)
    expect(isPlaidEligible(' Us ')).toBe(true)
    expect(isPlaidEligible('ca')).toBe(false)
  })

  // Deliberate: an unresolvable IP is common and benign (local dev, preview
  // deploys, some carriers). Failing closed would deny real US users the core
  // integration to punish a geolocation miss.
  it('FAILS OPEN on an unknown or malformed country', () => {
    for (const v of [null, undefined, '', '   ', 'USA', '1', 'X', 123, {}]) {
      expect(isPlaidEligible(v)).toBe(true)
    }
  })
})

describe('normalizeCountry', () => {
  it('returns a 2-letter uppercase code or null', () => {
    expect(normalizeCountry('ca')).toBe('CA')
    expect(normalizeCountry(' us ')).toBe('US')
    expect(normalizeCountry('USA')).toBe(null)
    expect(normalizeCountry('')).toBe(null)
    expect(normalizeCountry(undefined)).toBe(null)
  })
})

describe('countryFromHeaders', () => {
  it('reads the Vercel edge header from a plain object (Node req.headers)', () => {
    expect(countryFromHeaders({ [COUNTRY_HEADER]: 'CA' })).toBe('CA')
  })

  it('reads it from a Headers-like object', () => {
    const h = new Map([[COUNTRY_HEADER, 'GB']])
    expect(countryFromHeaders({ get: (k) => h.get(k) })).toBe('GB')
  })

  it('returns null when absent, so callers fail open', () => {
    expect(countryFromHeaders({})).toBe(null)
    expect(countryFromHeaders(null)).toBe(null)
    expect(isPlaidEligible(countryFromHeaders({}))).toBe(true)
  })
})

describe('countryFromCookie', () => {
  it('extracts the country the middleware published', () => {
    expect(countryFromCookie(`${COUNTRY_COOKIE}=CA`)).toBe('CA')
  })

  it('finds it among other cookies', () => {
    expect(countryFromCookie(`sb-token=abc; ${COUNTRY_COOKIE}=US; theme=dark`)).toBe('US')
  })

  it('tolerates spacing and percent-encoding', () => {
    expect(countryFromCookie(`a=1;  ${COUNTRY_COOKIE} = CA `)).toBe('CA')
    expect(countryFromCookie(`${COUNTRY_COOKIE}=%43%41`)).toBe('CA')
  })

  it('returns null for absent, empty or junk cookie strings', () => {
    expect(countryFromCookie('')).toBe(null)
    expect(countryFromCookie('other=1')).toBe(null)
    expect(countryFromCookie(null)).toBe(null)
    expect(countryFromCookie(`${COUNTRY_COOKIE}=NOPE`)).toBe(null)
  })

  // A cookie name that merely ends with ours must not match.
  it('does not match a lookalike cookie name', () => {
    expect(countryFromCookie(`x_${COUNTRY_COOKIE}=CA`)).toBe(null)
  })
})

describe('canConnectBank', () => {
  it('is false for a Canadian visitor', () => {
    expect(canConnectBank(`${COUNTRY_COOKIE}=CA`)).toBe(false)
  })

  it('is true for a US visitor', () => {
    expect(canConnectBank(`${COUNTRY_COOKIE}=US`)).toBe(true)
  })

  // No cookie: middleware did not resolve a country, or we are on localhost.
  it('is true when no cookie was set', () => {
    expect(canConnectBank('')).toBe(true)
  })
})

// TaxPlanner encodes US law (30-day wash sale, "federal + state marginal
// rate"). Canada has the superficial loss rule, a 50% inclusion rate and
// sheltered TFSA/RRSP accounts, so that panel is not merely irrelevant to a
// Canadian — it is wrong advice about money.
describe('isUsTaxJurisdiction / showsUsTaxTools', () => {
  it('hides the tax tools from a Canadian visitor', () => {
    expect(isUsTaxJurisdiction('CA')).toBe(false)
    expect(showsUsTaxTools(`${COUNTRY_COOKIE}=CA`)).toBe(false)
  })

  it('shows them in the US and US territories', () => {
    for (const cc of US_TAX_COUNTRIES) expect(isUsTaxJurisdiction(cc)).toBe(true)
    expect(showsUsTaxTools(`${COUNTRY_COOKIE}=US`)).toBe(true)
  })

  // The cache-first service worker can serve index.html with no document
  // request, so the middleware never sets the cookie for a real US user.
  // Hiding a working feature from the actual user base would be the worse bug.
  it('FAILS OPEN when the country is unknown', () => {
    expect(isUsTaxJurisdiction(null)).toBe(true)
    expect(showsUsTaxTools('')).toBe(true)
    expect(showsUsTaxTools('unrelated=1')).toBe(true)
  })

  // These two sets are identical today but answer different questions. If they
  // are ever merged, enabling Plaid Canada would silently start showing US
  // wash-sale rules to Canadians.
  it('is a separate decision from Plaid eligibility', () => {
    expect(US_TAX_COUNTRIES).not.toBe(PLAID_COUNTRIES)
  })
})

// The reason this matters: fmtUSD hardcodes `$`/en-US and nisab is computed
// purely in USD, so an unconverted CAD balance overstates wealth by the FX
// rate and can report Zakat as owed when it is not.
describe('nonUsdAccounts', () => {
  const snapUsd = { accountId: 'a1', brokerage: 'E*Trade', accountName: 'Individual', currency: 'USD' }
  const snapCad = { accountId: 'a2', brokerage: 'Questrade', accountName: 'TFSA', currency: 'CAD' }

  it('flags a SnapTrade account reporting CAD', () => {
    const out = nonUsdAccounts([snapCad], [])
    expect(out).toHaveLength(1)
    expect(out[0].currency).toBe('CAD')
    expect(out[0].label).toContain('Questrade')
  })

  it('ignores USD accounts', () => {
    expect(nonUsdAccounts([snapUsd], [])).toEqual([])
  })

  // Critical non-regression: SnapTrade omits currency for many custodians.
  // Treating unknown as foreign would warn every existing US user.
  it('treats a missing or empty currency as USD, not as foreign', () => {
    expect(nonUsdAccounts([{ accountId: 'a3', brokerage: 'Fidelity' }], [])).toEqual([])
    expect(nonUsdAccounts([{ accountId: 'a4', currency: null }], [])).toEqual([])
    expect(nonUsdAccounts([{ accountId: 'a5', currency: '   ' }], [])).toEqual([])
  })

  it('is case-insensitive about the currency code', () => {
    expect(nonUsdAccounts([{ accountId: 'a6', currency: 'usd' }], [])).toEqual([])
    expect(nonUsdAccounts([{ accountId: 'a7', currency: 'cad' }], [])[0].currency).toBe('CAD')
  })

  it('flags a Plaid account reporting a non-USD iso_currency', () => {
    const out = nonUsdAccounts([], [{ account_id: 'p1', institution_name: 'RBC', name: 'Chequing', iso_currency: 'CAD' }])
    expect(out).toHaveLength(1)
    expect(out[0].label).toContain('RBC')
  })

  it('survives null, non-array and junk input', () => {
    expect(nonUsdAccounts(null, undefined)).toEqual([])
    expect(nonUsdAccounts('nope', {})).toEqual([])
    expect(nonUsdAccounts([null, {}], [null])).toEqual([])
  })

  it('reports across both providers at once', () => {
    const out = nonUsdAccounts([snapUsd, snapCad], [{ account_id: 'p2', iso_currency: 'GBP' }])
    expect(out).toHaveLength(2)
  })
})

describe('hasNonUsdAccounts / foreignCurrencyCodes', () => {
  it('is false for an all-USD portfolio', () => {
    expect(hasNonUsdAccounts([{ accountId: 'a', currency: 'USD' }], [])).toBe(false)
    expect(foreignCurrencyCodes([{ accountId: 'a', currency: 'USD' }], [])).toEqual([])
  })

  it('returns distinct codes, sorted, with no duplicates', () => {
    const codes = foreignCurrencyCodes(
      [{ accountId: 'a', currency: 'CAD' }, { accountId: 'b', currency: 'CAD' }],
      [{ account_id: 'c', iso_currency: 'GBP' }],
    )
    expect(codes).toEqual(['CAD', 'GBP'])
  })
})
