// Ethical / BDS overlay — the curated divestment-target list and its attribution.
//
// This feature shipped 2026-07-02 with ZERO tests, which is the wrong way round:
// of everything in the screening stack, this is the part that makes public
// factual claims about named public companies. A wrong ticker here is not a
// rendering bug, it is a false accusation against a real business.
//
// So these tests guard the INVARIANTS rather than the contents. The list itself
// is editorial and will change every reconciliation; what must never change is
// that every entry is attributed, that the overlay stays strictly separate from
// the Sharia verdict, and that the staleness clock actually ticks.
import { describe, it, expect } from 'vitest'
import {
  ethicalScreen,
  ethicalExcludedTickers,
  ETHICAL_SOURCES,
  ETHICAL_RECONCILED,
  ETHICAL_REVIEW_DAYS,
  daysSinceEthicalReview,
  isEthicalReviewDue,
} from '../../lib/sharia.mjs'

describe('ethicalScreen — lookup', () => {
  it('flags a listed ticker and says who listed it', () => {
    const r = ethicalScreen('CAT')
    expect(r.excluded).toBe(true)
    expect(r.activity).toBeTruthy()
    expect(r.sources.length).toBeGreaterThan(0)
    expect(r.reason).toContain(r.sources[0].name)
  })

  it('returns a clean not-excluded shape for an unlisted ticker', () => {
    const r = ethicalScreen('AAPL')
    expect(r.excluded).toBe(false)
    expect(r.reason).toBeNull()
    expect(r.sources).toEqual([])
  })

  it('normalizes case and surrounding whitespace', () => {
    expect(ethicalScreen('  cat ').excluded).toBe(true)
    expect(ethicalScreen('Cat').reason).toBe(ethicalScreen('CAT').reason)
  })

  it('never throws on junk input', () => {
    for (const junk of [null, undefined, '', 0, {}, []]) {
      expect(() => ethicalScreen(junk)).not.toThrow()
      expect(ethicalScreen(junk).excluded).toBe(false)
    }
  })
})

describe('the list is attributed — every entry, no exceptions', () => {
  const tickers = ethicalExcludedTickers()

  it('is non-empty and sorted', () => {
    expect(tickers.length).toBeGreaterThan(0)
    expect([...tickers].sort()).toEqual(tickers)
  })

  // The failure this catches: a typo in a `sources` key. ETHICAL_SOURCES lookup
  // returns undefined, .filter(Boolean) drops it, and the entry silently ships
  // with NO attribution while still rendering a red BDS pill — Mizan asserting
  // the claim in its own voice, which is the exact thing the design forbids.
  it.each(tickers)('%s resolves to at least one real source', (tk) => {
    const r = ethicalScreen(tk)
    expect(r.excluded).toBe(true)
    expect(r.sources.length).toBeGreaterThan(0)
    for (const s of r.sources) {
      expect(Object.values(ETHICAL_SOURCES)).toContainEqual(s)
      expect(s.name).toBeTruthy()
      expect(s.url).toMatch(/^https:\/\//)
    }
  })

  it.each(tickers)('%s states its reason as attribution, not assertion', (tk) => {
    const { reason } = ethicalScreen(tk)
    expect(reason).toMatch(/listed by /)
  })

  it('every declared source is citable', () => {
    for (const s of Object.values(ETHICAL_SOURCES)) {
      expect(s.url).toMatch(/^https:\/\//)
      expect(s.version).toBeTruthy()   // which edition was read, so a reader can check
    }
  })
})

describe('the overlay is separate from the Sharia verdict', () => {
  // If a `status` ever appears on this object, someone has started letting the
  // overlay speak as a religious ruling. It is an ethical filter layered on top;
  // conflating the two would restate one methodology as the other.
  it.each(ethicalExcludedTickers())('%s carries no Sharia status of its own', (tk) => {
    const r = ethicalScreen(tk)
    expect(r).not.toHaveProperty('status')
    expect(r).not.toHaveProperty('byStandard')
    expect(r.list).toBe('bds')
  })
})

describe('staleness clock', () => {
  it('has a valid, non-future reconciliation date', () => {
    expect(ETHICAL_RECONCILED).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const d = new Date(`${ETHICAL_RECONCILED}T00:00:00Z`)
    expect(Number.isNaN(d.getTime())).toBe(false)
    // A future date would park the clock permanently in the healthy state.
    expect(d.getTime()).toBeLessThanOrEqual(Date.now() + 86400000)
  })

  it('counts days from the reconciliation date', () => {
    const base = new Date(`${ETHICAL_RECONCILED}T00:00:00Z`)
    const plus10 = new Date(base.getTime() + 10 * 86400000)
    expect(daysSinceEthicalReview(plus10)).toBe(10)
  })

  it('is not due today but is due once the interval lapses', () => {
    const base = new Date(`${ETHICAL_RECONCILED}T00:00:00Z`)
    expect(isEthicalReviewDue(base)).toBe(false)
    const justBefore = new Date(base.getTime() + (ETHICAL_REVIEW_DAYS - 1) * 86400000)
    expect(isEthicalReviewDue(justBefore)).toBe(false)
    const due = new Date(base.getTime() + ETHICAL_REVIEW_DAYS * 86400000)
    expect(isEthicalReviewDue(due)).toBe(true)
  })

  it('treats an unparseable date as overdue rather than healthy', () => {
    // Fail loud, not silent: a typo'd date must not read as "reviewed forever".
    expect(isEthicalReviewDue(new Date(), 'not-a-date')).toBe(true)
  })
})
