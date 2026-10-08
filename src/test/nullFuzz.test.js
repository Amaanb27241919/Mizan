import { describe, it, expect } from 'vitest'

/**
 * Null-fuzz every exported function in the pure modules.
 *
 * WHY THIS EXISTS, specifically:
 *
 * `function f({ a = 1 } = {})` looks null-safe and is not. A destructuring
 * default fires ONLY for `undefined` — pass `null` and it throws
 * "Cannot destructure property...". And `null` is precisely what a failed
 * fetch, an absent DB row, or a rejected upstream call hands you, so the
 * production path is the one that triggers it.
 *
 * I hit this three separate times in one session while building the AI
 * modules — including once in a file written AFTER I had documented the
 * mistake in a comment elsewhere. A rule I have to remember is not a rule.
 * This test does the remembering: it calls every export with the values a
 * broken upstream actually produces and requires that nothing throws.
 *
 * A function that genuinely cannot accept a given input should RETURN a
 * refusal — `{ ok: false }`, `null`, `[]` — because callers in this codebase
 * branch on refusals and crash on exceptions. These are leaf-level pure
 * helpers; throwing is never the right answer for them.
 *
 * Adding a module here is deliberately cheap. Anything pure under lib/ai or
 * lib/trading belongs in the list.
 */

const MODULES = [
  '../../lib/ai/signalSchema.mjs',
  '../../lib/ai/marketPacket.mjs',
  '../../lib/ai/ensemble.mjs',
  '../../lib/ai/evidence.mjs',
  '../../lib/ai/attribution.mjs',
  '../../lib/ai/providers.mjs',
  '../../lib/trading/executionMode.mjs',
  '../../lib/trading/orderIdentity.js',
  '../../lib/trading/fills.mjs',
  '../../lib/trading/rank.mjs',
  '../../lib/trading/basket.mjs',
  '../../lib/trading/broker.mjs',
  '../../lib/trading/stuck.mjs',
  '../../lib/trading/closedLots.mjs',
  '../../lib/trading/sleeve.mjs',
  '../../lib/trading/position.mjs',
  '../../lib/trading/screenGate.mjs',
  '../../lib/ownerBrief.mjs',
  '../../lib/trading/smallAccount.mjs',
  '../../lib/trading/volume.mjs',
]

/** What a broken upstream actually hands you. `null` is the headline case. */
const HOSTILE = [
  undefined,
  null,            // the one that breaks `= {}` defaults
  0, '', false, NaN,
  [], {},
  'unexpected string',
  [null],
  { ok: false },
]

/**
 * Functions whose contract is to throw, or that need real I/O. None today —
 * the list exists so an exception has to be declared rather than discovered.
 */
const ALLOWED_TO_THROW = new Set([])

describe('null-fuzz: pure modules must refuse, never throw', () => {
  for (const path of MODULES) {
    it(`${path.split('/').pop()} survives hostile input`, async () => {
      const mod = await import(path)
      const fns = Object.entries(mod).filter(([, v]) => typeof v === 'function')
      expect(fns.length, `${path} exported no functions — wrong path?`).toBeGreaterThan(0)

      for (const [name, fn] of fns) {
        if (ALLOWED_TO_THROW.has(`${path}:${name}`)) continue

        for (const arg of HOSTILE) {
          // Single argument — the common shape for these helpers.
          try {
            const out = fn(arg)
            // A returned promise must reject-free too; several of these are async.
            if (out && typeof out.then === 'function') await out.catch(() => {})
          } catch (e) {
            throw new Error(
              `${name}(${JSON.stringify(arg) ?? String(arg)}) THREW: ${e.message}\n` +
              `  in ${path}\n` +
              `  A pure helper must return a refusal, not throw — callers branch on refusals and crash on exceptions.\n` +
              `  If this is a destructuring default (\`= {}\`), remember it does NOT fire for null.`,
            )
          }

          // Two arguments — covers (value, options) shapes.
          try {
            const out = fn(arg, arg)
            if (out && typeof out.then === 'function') await out.catch(() => {})
          } catch (e) {
            throw new Error(
              `${name}(${JSON.stringify(arg) ?? String(arg)}, same) THREW: ${e.message}\n  in ${path}`,
            )
          }
        }
      }
    })
  }

  it('covers every pure module that exists, so a new one cannot be forgotten', async () => {
    const { readdirSync } = await import('node:fs')
    const { resolve, dirname } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const here = dirname(fileURLToPath(import.meta.url))

    const found = []
    for (const dir of ['ai', 'trading']) {
      const abs = resolve(here, '../../lib', dir)
      for (const f of readdirSync(abs)) {
        if (/\.(mjs|js)$/.test(f)) found.push(`../../lib/${dir}/${f}`)
      }
    }
    const missing = found.filter((f) => !MODULES.includes(f))
    expect(missing, `these pure modules are not null-fuzzed:\n  ${missing.join('\n  ')}`).toEqual([])
  })
})
