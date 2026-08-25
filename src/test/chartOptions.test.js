// Chart library options are NOT CSS.
//
// Regression guard for a6f3ff2 (2026-08-18). The fluid-type migration rewrote
// ~1,260 px font sizes into var(--fs-*) tokens, which is right everywhere the
// value lands in a stylesheet or a JSX style prop — and wrong in the one place
// it landed in a canvas library's options object:
//
//   createChart(el, { layout: { ..., fontSize: 11 } })        // before
//   createChart(el, { layout: { ..., fontSize: "var(--fs-xs)" } })  // after
//
// lightweight-charts types layout.fontSize as `number` and does arithmetic on
// it (`fontSize + 4` for scale spacing). A string turns that addition into
// concatenation — "var(--fs-xs)4" — poisoning the layout maths for a renderer
// that never resolves CSS variables in the first place.
//
// A blanket px→token sweep cannot tell a CSS declaration from a library option
// that happens to share a property name, so the distinction has to be asserted
// rather than remembered.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const priceChart = readFileSync(join(root, 'src/components/charts/PriceChart.jsx'), 'utf8')

/** The options object literal passed to createChart(el, { ... }). */
function createChartOptions(src) {
  const start = src.indexOf('createChart(')
  expect(start, 'createChart call not found').toBeGreaterThan(-1)
  // Walk braces from the first "{" after the call to find the matching close.
  const open = src.indexOf('{', start)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(open, i + 1)
    }
  }
  throw new Error('unbalanced createChart options')
}

describe('lightweight-charts options', () => {
  const options = createChartOptions(priceChart)

  it('never passes a CSS variable to the canvas renderer', () => {
    // Covers fontSize and any sibling that a future sweep might touch.
    expect(options).not.toMatch(/var\(--/)
  })

  it('passes a numeric font size, not a string', () => {
    // Either a literal number or a resolver call — never a quoted value.
    expect(options).toMatch(/fontSize:\s*(?:\d+(?:\.\d+)?|resolveAxisFontPx\(\))/)
    expect(options).not.toMatch(/fontSize:\s*["'`]/)
  })

  it('resolves the axis size from the type scale with a numeric fallback', () => {
    // The point is to stay in tune with --fs-* WITHOUT handing the library a
    // string. If someone deletes the resolver and hardcodes a px number the
    // chart still works, so this only pins the fallback being a real number.
    expect(priceChart).toContain('function resolveAxisFontPx')
    expect(priceChart).toMatch(/resolveAxisFontPx\(fallback = \d+\)/)
  })
})
