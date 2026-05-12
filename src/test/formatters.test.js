import { describe, it, expect } from 'vitest'
import { f$, fp, kf } from '../lib/formatters.js'

describe('f$', () => {
  it('formats positive amounts with comma separators and 2 decimals', () => {
    expect(f$(1234.5)).toBe('$1,234.50')
  })
  it('formats zero', () => {
    expect(f$(0)).toBe('$0.00')
  })
  it('formats negative amounts as absolute value (no minus sign)', () => {
    // Caller is responsible for prepending - or − if needed; f$ always returns positive
    expect(f$(-99.5)).toBe('$99.50')
  })
  it('honors a custom decimal count', () => {
    expect(f$(1.5, 0)).toBe('$2')
    expect(f$(1.5, 4)).toBe('$1.5000')
  })
  it('returns "-" for null / undefined / NaN', () => {
    expect(f$(null)).toBe('-')
    expect(f$(undefined)).toBe('-')
    expect(f$(NaN)).toBe('-')
  })
})

describe('fp', () => {
  it('formats positive percent with + sign and 2 decimals', () => {
    expect(fp(0.621)).toBe('+0.62%')
    expect(fp(12.345)).toBe('+12.35%')
  })
  it('formats negative percent with - sign', () => {
    expect(fp(-3.14)).toBe('-3.14%')
  })
  it('formats zero without a sign', () => {
    expect(fp(0)).toBe('0.00%')
  })
  it('returns "-" for null / undefined / NaN', () => {
    expect(fp(null)).toBe('-')
    expect(fp(NaN)).toBe('-')
  })
})

describe('kf', () => {
  it('formats >= 1B in billions with 2 decimals', () => {
    expect(kf(1e9)).toBe('$1.00B')
    expect(kf(2.5e9)).toBe('$2.50B')
  })
  it('formats >= 1M in millions with 1 decimal', () => {
    expect(kf(1e6)).toBe('$1.0M')
    expect(kf(4.2e6)).toBe('$4.2M')
  })
  it('formats < 1M with thousands separators', () => {
    expect(kf(1234)).toBe('$1,234')
    expect(kf(999999)).toBe('$999,999')
  })
  it('returns "-" for null / NaN', () => {
    expect(kf(null)).toBe('-')
    expect(kf(NaN)).toBe('-')
  })
})
