import { describe, it, expect } from 'vitest'
import { relativeVolume, sessionFraction } from '../../lib/trading/volume.mjs'

// Daily bars as Alpaca returns them (t = 04:00Z = NY midnight, v = shares).
const day = (d, v) => ({ t: `2026-09-${String(d).padStart(2, '0')}T04:00:00Z`, c: 100, v })
const history = Array.from({ length: 20 }, (_, i) => day(i + 1, 1_000_000))

describe('sessionFraction — how much of a normal day has traded', () => {
  it('accounts for the 15-minute data embargo and caps at a full day', () => {
    expect(sessionFraction(15 + 39)).toBeCloseTo(0.1)      // 39 of 390 minutes visible
    expect(sessionFraction(15 + 390)).toBe(1)
    expect(sessionFraction(500)).toBe(1)
  })
  it('is null before enough of the session exists to judge', () => {
    expect(sessionFraction(20)).toBeNull()
    expect(sessionFraction(null)).toBeNull()
  })
})

describe('relativeVolume', () => {
  it('compares today so far with the same share of an average day', () => {
    // Half the day visible, 1.0M traded vs a 1.0M average → twice the usual pace.
    const bars = [...history, day(21, 1_000_000)]
    expect(relativeVolume({ bars, today: '2026-09-21', minutesSinceOpen: 15 + 195 })).toBeCloseTo(2)
  })
  it('a quiet day reads under 1', () => {
    const bars = [...history, day(21, 250_000)]
    expect(relativeVolume({ bars, today: '2026-09-21', minutesSinceOpen: 15 + 195 })).toBeCloseTo(0.5)
  })
  it('is null without today\'s bar, enough history, or enough session — never a guess', () => {
    expect(relativeVolume({ bars: history, today: '2026-09-21', minutesSinceOpen: 200 })).toBeNull()
    expect(relativeVolume({ bars: [...history.slice(0, 5), day(21, 1)], today: '2026-09-21', minutesSinceOpen: 200 })).toBeNull()
    expect(relativeVolume({ bars: [...history, day(21, 1)], today: '2026-09-21', minutesSinceOpen: 10 })).toBeNull()
    expect(relativeVolume(null)).toBeNull()
  })
})

import { readFileSync } from 'node:fs'
import path from 'node:path'
describe('swing entry wiring (handlers.mjs)', () => {
  const SRC = readFileSync(path.resolve(__dirname, '../../lib/handlers.mjs'), 'utf8')
  const entry = SRC.slice(SRC.indexOf('// ── ENTRY ENGINE'), SRC.indexOf('const tickerUp = best.ticker;'))
  it('an unconfirmed volume reading blocks the entry rather than passing it', () => {
    expect(entry).toMatch(/if \(relVolOf && !\(relVol !== null && relVol >= minRelVol\)\) \{ volumeBlocked\+\+; continue; \}/)
  })
  it('is off unless the strategy sets min_relative_volume', () => {
    expect(entry).toMatch(/const minRelVol = Number\(strat\.params\?\.min_relative_volume\) \|\| 0;/)
    expect(entry).toMatch(/if \(minRelVol > 0\) \{/)
  })
})
