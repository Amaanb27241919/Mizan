// The Assistant's suggested questions must be ones it can ANSWER inside the
// compliance boundary (CLAUDE.md §1): facts about the user's own data, or how
// something works — never a request for a pick or a personal buy/sell call.
// "Recommend 3 Sharia-compliant ETFs" and "Should I tax-loss harvest any
// positions?" shipped as suggestions; the advisor is built to refuse both
// (found 2026-10-15 while making the launch video).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const SRC = readFileSync(path.resolve(__dirname, '../components/MizanApp.jsx'), 'utf8')
const block = SRC.slice(SRC.indexOf('const prompts=['), SRC.indexOf('];', SRC.indexOf('const prompts=[')))
const prompts = [...block.matchAll(/\{q:"([^"]+)"/g)].map((m) => m[1])

describe('Assistant suggested questions', () => {
  it('exist', () => { expect(prompts.length).toBeGreaterThanOrEqual(4) })
  it('never ask for a recommendation or a personal buy/sell decision', () => {
    const asksForAdvice = /\b(recommend|suggest (?:a|some|\d)|should i|what should|which .*(?:buy|sell)|best (?:stock|etf|fund)|buy|sell)\b/i
    expect(prompts.filter((q) => asksForAdvice.test(q))).toEqual([])
  })
})
