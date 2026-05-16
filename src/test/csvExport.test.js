// Tests for the RFC-4180 CSV escape + builder used by every /api/export/*
// endpoint in lib/handlers.mjs. Importing handlers.mjs in jsdom is safe —
// plaidClient and sbAdmin both gate on env vars being present, so without
// those env vars set the module just emits "skipped" log lines on load.
import { describe, it, expect } from 'vitest'
import { csvEscapeCell, toCsv } from '../../lib/handlers.mjs'

describe('csvEscapeCell', () => {
  it('passes plain strings through unquoted', () => {
    expect(csvEscapeCell('hello')).toBe('hello')
    expect(csvEscapeCell('AAPL')).toBe('AAPL')
  })

  it('wraps + escapes when a comma is present', () => {
    expect(csvEscapeCell('Smith, John')).toBe('"Smith, John"')
  })

  it('wraps + doubles embedded double quotes', () => {
    expect(csvEscapeCell('she said "hi"')).toBe('"she said ""hi"""')
  })

  it('wraps strings that contain LF or CRLF', () => {
    expect(csvEscapeCell('line1\nline2')).toBe('"line1\nline2"')
    expect(csvEscapeCell('line1\r\nline2')).toBe('"line1\r\nline2"')
  })

  it('emits finite numbers unquoted', () => {
    expect(csvEscapeCell(1234.56)).toBe('1234.56')
    expect(csvEscapeCell(0)).toBe('0')
    expect(csvEscapeCell(-3.5)).toBe('-3.5')
  })

  it('emits NaN / Infinity as empty', () => {
    expect(csvEscapeCell(NaN)).toBe('')
    expect(csvEscapeCell(Infinity)).toBe('')
    expect(csvEscapeCell(-Infinity)).toBe('')
  })

  it('emits booleans as unquoted true/false', () => {
    expect(csvEscapeCell(true)).toBe('true')
    expect(csvEscapeCell(false)).toBe('false')
  })

  it('emits null / undefined as empty cell', () => {
    expect(csvEscapeCell(null)).toBe('')
    expect(csvEscapeCell(undefined)).toBe('')
  })
})

describe('toCsv', () => {
  it('emits a header-only row when no rows are supplied', () => {
    const out = toCsv(['date', 'amount'], [])
    expect(out).toBe('date,amount\r\n')
  })

  it('joins header + rows with CRLF terminators', () => {
    const rows = [
      { date: '2025-01-01', amount: 12.50, name: 'Coffee' },
      { date: '2025-01-02', amount: -3.00, name: 'Refund' },
    ]
    const out = toCsv(['date', 'amount', 'name'], rows)
    expect(out).toBe(
      'date,amount,name\r\n' +
      '2025-01-01,12.5,Coffee\r\n' +
      '2025-01-02,-3,Refund\r\n'
    )
  })

  it('escapes cells with commas, quotes, and newlines correctly in one row', () => {
    const rows = [{ a: 'has, comma', b: 'has "quote"', c: 'has\nnewline' }]
    const out = toCsv(['a', 'b', 'c'], rows)
    expect(out).toBe(
      'a,b,c\r\n' +
      '"has, comma","has ""quote""","has\nnewline"\r\n'
    )
  })

  it('treats missing keys as empty cells', () => {
    const rows = [{ a: 1 }]
    const out = toCsv(['a', 'b', 'c'], rows)
    expect(out).toBe('a,b,c\r\n1,,\r\n')
  })

  it('returns empty header row for empty cols input', () => {
    const out = toCsv([], [])
    expect(out).toBe('\r\n')
  })
})
