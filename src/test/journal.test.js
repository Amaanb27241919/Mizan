import { describe, it, expect } from 'vitest'
import { journalCsv, JOURNAL_COLS } from '../../lib/trading/journal.mjs'

// Row shapes copied from real pending_signals (2026-10-07).
const order = { created_at: '2026-10-07T13:33:38Z', executed_at: '2026-10-07T13:33:40Z', ticker: 'MU', side: 'buy', qty: '34.5464', suggested_price: '1017.49', status: 'executed', error_msg: null,
  rationale: { v: 1, strategy_type: 'rank_rebalance', rank: 3, momentum: 1.82, volatility: 0.041, target_weight: 0.044, excluded: ['STX'] } }
const review = { created_at: '2026-10-07T17:46:33Z', ticker: 'COHR', side: 'buy', qty: '0', status: 'shadow',
  rationale: { kind: 'ai_panel', ensemble: { ok: false, code: 'insufficient_votes', per_model: [{ provider: 'google', action: 'HOLD' }, { provider: 'openrouter', action: 'INSUFFICIENT_DATA' }] }, failures: [{ provider: 'anthropic', code: 'http_400' }] } }
const screened = { created_at: '2026-10-07T17:40:00Z', ticker: 'STX', side: 'buy', qty: '0', status: 'shadow', rationale: { kind: 'ai_panel', screen_only: true, sharia_verdict: 'haram' } }

describe('journalCsv — every decision a strategy made, for study later', () => {
  const csv = journalCsv([review, order, screened], { strategy: 'A: reference system + AI gate' })
  const lines = csv.trim().split('\n')
  it('has a header and one row per record, oldest first', () => {
    expect(lines[0]).toBe(JOURNAL_COLS.join(','))
    expect(lines).toHaveLength(4)
    expect(lines[1]).toContain('MU')
    expect(lines[3]).toContain('COHR')
  })
  it('names the kind of record: an order, an AI review, a screen-only skip', () => {
    expect(lines[1]).toMatch(/,order,/)
    expect(lines[2]).toMatch(/,screen_only,/)
    expect(lines[3]).toMatch(/,ai_review,/)
  })
  it('flattens each analyst\'s vote and failure into its own column', () => {
    const cols = JOURNAL_COLS
    const row = lines[3].split(',')
    expect(row[cols.indexOf('claude')]).toBe('failed:http_400')
    expect(row[cols.indexOf('gemini')]).toBe('HOLD')
    expect(row[cols.indexOf('deepseek')]).toBe('INSUFFICIENT_DATA')
    expect(row[cols.indexOf('panel_result')]).toBe('insufficient_votes')
  })
  it('keeps the decision inputs of an order', () => {
    const row = lines[1].split(',')
    expect(row[JOURNAL_COLS.indexOf('rank')]).toBe('3')
    expect(row[JOURNAL_COLS.indexOf('excluded')]).toBe('STX')
  })
  it('is safe to open in Excel: no formula injection', () => {
    const evil = journalCsv([{ ...order, ticker: '=HYPERLINK("x")' }], { strategy: 'x' })
    expect(evil).toContain(`"'=HYPERLINK(""x"")"`)
  })
  it('survives junk', () => {
    expect(journalCsv(null).trim()).toBe(JOURNAL_COLS.join(','))
  })
})

import { readFileSync } from 'node:fs'
import path from 'node:path'
describe('/api/bot/journal.csv wiring', () => {
  const SRC = readFileSync(path.resolve(__dirname, '../../lib/handlers.mjs'), 'utf8')
  const route = SRC.slice(SRC.indexOf('if (pathname === "/api/bot/journal.csv"'), SRC.indexOf('// GET /api/etf/universe'))
  it('requires a signed-in trading user and only exports the CALLER\'S strategy', () => {
    expect(route).toMatch(/const user = await verifyUser\(h\);\s*if \(!user\) return \{ status: 401/)
    expect(route).toMatch(/canUseTradingBot\(user\)/)
    expect(route).toMatch(/\.eq\("id", sid\)\.eq\("user_id", user\.id\)/)
    expect(route).toMatch(/if \(!strat\) return \{ status: 404/)
  })
  it('is read-only', () => { expect(route).not.toMatch(/\.(insert|update|upsert|delete)\(/) })
})
