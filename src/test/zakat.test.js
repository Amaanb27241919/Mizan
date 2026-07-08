import { describe, it, expect } from 'vitest'
import {
  TROY_OZ_TO_G,
  NISAB_GOLD_G,
  NISAB_SILVER_G,
  NISAB_GOLD_USD,
  NISAB_SILVER_USD,
  INVESTMENT_FACTOR_FULL,
  INVESTMENT_FACTOR_LONGTERM,
  ZAKAT_RATE,
  DEFAULT_ZAKAT_SETTINGS,
  round2,
  usdPerGram,
  nisabValueForWeight,
  nisabFromSpot,
  investmentFactor,
  nisabValueFor,
  negativeBankAmount,
  netZakatableWealth,
  zakatDueOn,
  isAboveNisab,
  computeZakat,
} from '../lib/zakat.js'

// ── Constants sanity ──────────────────────────────────────────────────────────
describe('constants', () => {
  it('encodes the canonical nisab weights and rate', () => {
    // Arrange / Act / Assert
    expect(NISAB_GOLD_G).toBe(87.48)
    expect(NISAB_SILVER_G).toBe(612.36)
    expect(TROY_OZ_TO_G).toBe(31.1034768)
    expect(ZAKAT_RATE).toBe(0.025)
    expect(INVESTMENT_FACTOR_FULL).toBe(1.0)
    expect(INVESTMENT_FACTOR_LONGTERM).toBe(0.3)
  })

  it('defaults to silver nisab + long-term investment method', () => {
    expect(DEFAULT_ZAKAT_SETTINGS).toEqual({
      nisabStandard: 'silver',
      investmentMethod: 'longterm_30',
    })
  })
})

// ── Troy-ounce → gram conversion ──────────────────────────────────────────────
describe('usdPerGram (oz→g conversion)', () => {
  it('returns 1.00/g when the ounce price equals one troy ounce in grams', () => {
    // A price of $31.1034768/oz is exactly $1.00/g by construction.
    expect(usdPerGram(TROY_OZ_TO_G)).toBeCloseTo(1, 10)
  })

  it('scales linearly: double the ounce price ⇒ double the gram price', () => {
    expect(usdPerGram(2 * TROY_OZ_TO_G)).toBeCloseTo(2, 10)
  })

  it('converts a realistic $2400/oz gold quote to ~$77.16/g', () => {
    expect(usdPerGram(2400)).toBeCloseTo(77.1621, 3)
  })
})

// ── Nisab value from a per-gram price ─────────────────────────────────────────
describe('nisabValueForWeight (nisab value at a price/gram)', () => {
  it('values the gold nisab (87.48 g) at $100/g as $8,748', () => {
    expect(nisabValueForWeight(NISAB_GOLD_G, 100)).toBeCloseTo(8748, 6)
  })

  it('values the silver nisab (612.36 g) at $1/g as $612.36', () => {
    expect(nisabValueForWeight(NISAB_SILVER_G, 1)).toBeCloseTo(612.36, 6)
  })

  it('produces a higher gold-nisab USD value than silver at the same $/g', () => {
    // Gold nisab is a smaller weight, so at an equal per-gram price it is a
    // LOWER USD threshold — but gold's real per-gram price is ~80x silver's,
    // which is why the gold threshold is higher in practice.
    const perGram = 5
    expect(nisabValueForWeight(NISAB_GOLD_G, perGram)).toBeLessThan(
      nisabValueForWeight(NISAB_SILVER_G, perGram)
    )
  })
})

// ── nisabFromSpot: agreement with the server (/api/metals/spot) ────────────────
describe('nisabFromSpot (server-parity spot → nisab)', () => {
  it('reproduces the exact lib/handlers.mjs oz→g→nisab formula', () => {
    // Independently re-derive the server's expression (round2 to cents) and
    // assert byte-for-byte equality, so client fallback math never drifts from
    // the server's /api/metals/spot response.
    const goldOz = 2400
    const silverOz = 30
    const TROY = 31.1034768
    const r2 = (n) => Math.round(n * 100) / 100
    const expectedGoldNisab = r2((87.48 * goldOz) / TROY)
    const expectedSilverNisab = r2((612.36 * silverOz) / TROY)
    const expectedGoldPerG = r2(goldOz / TROY)
    const expectedSilverPerG = r2(silverOz / TROY)

    const out = nisabFromSpot(goldOz, silverOz)

    expect(out.nisab_gold_usd).toBe(expectedGoldNisab)
    expect(out.nisab_silver_usd).toBe(expectedSilverNisab)
    expect(out.gold_usd_per_g).toBe(expectedGoldPerG)
    expect(out.silver_usd_per_g).toBe(expectedSilverPerG)
  })

  it('rounds all outputs to cents', () => {
    const out = nisabFromSpot(2412.37, 29.876)
    for (const v of Object.values(out)) {
      expect(v).toBe(round2(v))
    }
  })

  it('returns null on a non-positive or non-finite quote', () => {
    expect(nisabFromSpot(0, 30)).toBeNull()
    expect(nisabFromSpot(2400, -1)).toBeNull()
    expect(nisabFromSpot(NaN, 30)).toBeNull()
    expect(nisabFromSpot(2400, undefined)).toBeNull()
  })
})

// ── investmentFactor: full vs long-term (0.30) ────────────────────────────────
describe('investmentFactor', () => {
  it('returns 1.0 for the full-value (trader) method', () => {
    expect(investmentFactor({ investmentMethod: 'full' })).toBe(1.0)
  })

  it('returns 0.30 for the long-term (buy-and-hold) method', () => {
    expect(investmentFactor({ investmentMethod: 'longterm_30' })).toBe(0.3)
  })

  it('defaults to 0.30 for unknown/missing settings', () => {
    expect(investmentFactor({})).toBe(0.3)
    expect(investmentFactor(undefined)).toBe(0.3)
    expect(investmentFactor({ investmentMethod: 'nonsense' })).toBe(0.3)
  })
})

// ── nisabValueFor: standard selection, live-preference, NaN guard ─────────────
describe('nisabValueFor', () => {
  const liveStooq = { nisab_gold_usd: 6750.14, nisab_silver_usd: 610.5, source: 'stooq' }

  it('selects the gold threshold under the gold standard', () => {
    expect(nisabValueFor({ nisabStandard: 'gold' }, null)).toBe(NISAB_GOLD_USD)
  })

  it('selects the silver threshold under the silver standard', () => {
    expect(nisabValueFor({ nisabStandard: 'silver' }, null)).toBe(NISAB_SILVER_USD)
  })

  it('defaults to the silver threshold when the standard is unspecified', () => {
    expect(nisabValueFor({}, null)).toBe(NISAB_SILVER_USD)
  })

  it('prefers live spot values over the static fallback', () => {
    expect(nisabValueFor({ nisabStandard: 'gold' }, liveStooq)).toBe(6750.14)
    expect(nisabValueFor({ nisabStandard: 'silver' }, liveStooq)).toBe(610.5)
  })

  it('ignores live values when the source is "static" (fallback shape)', () => {
    const staticLive = { nisab_gold_usd: 6750.14, nisab_silver_usd: 610.5, source: 'static' }
    expect(nisabValueFor({ nisabStandard: 'gold' }, staticLive)).toBe(NISAB_GOLD_USD)
  })

  it('falls back to the constant when a live value is NaN (the NaN guard)', () => {
    const badLive = { nisab_gold_usd: NaN, nisab_silver_usd: NaN, source: 'stooq' }
    expect(nisabValueFor({ nisabStandard: 'gold' }, badLive)).toBe(NISAB_GOLD_USD)
    expect(nisabValueFor({ nisabStandard: 'silver' }, badLive)).toBe(NISAB_SILVER_USD)
  })

  it('falls back to the constant when live is null', () => {
    expect(nisabValueFor({ nisabStandard: 'gold' }, null)).toBe(NISAB_GOLD_USD)
  })
})

// ── Deductions: negative bank + short-term debt ───────────────────────────────
describe('negativeBankAmount', () => {
  it('returns the absolute value of a negative (overdrawn) balance', () => {
    expect(negativeBankAmount(-1250)).toBe(1250)
  })

  it('returns 0 for a positive or zero balance', () => {
    expect(negativeBankAmount(5000)).toBe(0)
    expect(negativeBankAmount(0)).toBe(0)
  })
})

describe('netZakatableWealth', () => {
  it('deducts short-term debt and a negative bank balance (AAOIFI rule)', () => {
    // 50,000 assets − 3,000 debt − 1,000 overdraft = 46,000
    const w = netZakatableWealth({
      zakatableAssets: 50000,
      shortTermDebt: 3000,
      bankBalance: -1000,
    })
    expect(w).toBe(46000)
  })

  it('does not treat a positive bank balance as a deduction', () => {
    const w = netZakatableWealth({ zakatableAssets: 10000, shortTermDebt: 0, bankBalance: 4000 })
    expect(w).toBe(10000)
  })

  it('floors at 0 when debts exceed assets', () => {
    const w = netZakatableWealth({ zakatableAssets: 1000, shortTermDebt: 5000, bankBalance: -500 })
    expect(w).toBe(0)
  })
})

// ── Rate + nisab gate ─────────────────────────────────────────────────────────
describe('zakatDueOn', () => {
  it('applies the 2.5% rate', () => {
    expect(zakatDueOn(100000)).toBe(2500)
    expect(zakatDueOn(670)).toBeCloseTo(16.75, 10)
  })

  it('returns 0 for zero/invalid input', () => {
    expect(zakatDueOn(0)).toBe(0)
    expect(zakatDueOn(NaN)).toBe(0)
  })
})

describe('isAboveNisab', () => {
  it('is true at or above the threshold', () => {
    expect(isAboveNisab(670, 670)).toBe(true)
    expect(isAboveNisab(1000, 670)).toBe(true)
  })

  it('is false below the threshold', () => {
    expect(isAboveNisab(669.99, 670)).toBe(false)
  })
})

// ── computeZakat: full Zakat-tab pipeline ─────────────────────────────────────
describe('computeZakat', () => {
  it('scales brokerage by 30%, adds manual assets, deducts debt + overdraft', () => {
    // acctZakatable = 100,000 × 0.30 = 30,000
    // zakatable = max(0, 30,000 + 48,500 − 2,000 − 500) = 76,000
    // due = 76,000 × 2.5% = 1,900
    const r = computeZakat({
      acctTotal: 100000,
      settings: { investmentMethod: 'longterm_30', nisabStandard: 'silver' },
      zakatableManual: 48500,
      liabilityTotal: 2000,
      bankBalance: -500,
      nisab: 670,
    })
    expect(r.invFactor).toBe(0.3)
    expect(r.acctZakatable).toBe(30000)
    expect(r.negativeBank).toBe(500)
    expect(r.zakatable).toBe(76000)
    expect(r.zakatDue).toBe(1900)
    expect(r.aboveNisab).toBe(true)
  })

  it('uses full market value under the full-value method', () => {
    const r = computeZakat({
      acctTotal: 100000,
      settings: { investmentMethod: 'full', nisabStandard: 'gold' },
      nisab: 8310,
    })
    expect(r.acctZakatable).toBe(100000)
    expect(r.zakatable).toBe(100000)
    expect(r.zakatDue).toBe(2500)
    expect(r.aboveNisab).toBe(true)
  })

  it('reports below-nisab but still exposes the raw due when ungated (Zakat tab)', () => {
    // 1,000 × 0.30 = 300, which is under the 670 silver nisab.
    const r = computeZakat({
      acctTotal: 1000,
      settings: { investmentMethod: 'longterm_30', nisabStandard: 'silver' },
      nisab: 670,
    })
    expect(r.zakatable).toBe(300)
    expect(r.aboveNisab).toBe(false)
    expect(r.zakatDue).toBeCloseTo(7.5, 10) // ungated: raw 2.5%
  })

  it('zeroes the due below nisab when gated (Overview-tile behavior)', () => {
    const r = computeZakat({
      acctTotal: 1000,
      settings: { investmentMethod: 'longterm_30', nisabStandard: 'silver' },
      nisab: 670,
      gateDue: true,
    })
    expect(r.aboveNisab).toBe(false)
    expect(r.zakatDue).toBe(0)
  })

  it('handles empty input without NaN', () => {
    const r = computeZakat({})
    expect(r.zakatable).toBe(0)
    expect(r.zakatDue).toBe(0)
    expect(r.aboveNisab).toBe(true) // 0 >= 0
  })

  it('adds positive bank cash to zakatable wealth (cash on hand is zakatable)', () => {
    // acctZakatable = 10,000 × 1.0 = 10,000; + 5,000 bank cash = 15,000
    const r = computeZakat({
      acctTotal: 10000,
      settings: { investmentMethod: 'full', nisabStandard: 'silver' },
      bankBalance: 5000,
      nisab: 670,
    })
    expect(r.bankCash).toBe(5000)
    expect(r.negativeBank).toBe(0)
    expect(r.zakatable).toBe(15000)
    expect(r.zakatDue).toBe(375) // 15,000 × 2.5%
  })

  it('treats the bank balance with its natural sign (adds cash, deducts overdraft)', () => {
    const base = { acctTotal: 10000, settings: { investmentMethod: 'full' }, nisab: 0 }
    const pos = computeZakat({ ...base, bankBalance: 2000 })  // +2,000 cash  → 12,000
    const neg = computeZakat({ ...base, bankBalance: -2000 }) // −2,000 debt  →  8,000
    expect(pos.zakatable).toBe(12000)
    expect(neg.zakatable).toBe(8000)
    // the swing between +X cash and −X overdraft is exactly 2X
    expect(pos.zakatable - neg.zakatable).toBe(4000)
  })
})
