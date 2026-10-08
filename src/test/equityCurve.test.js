import { describe, it, expect } from 'vitest'
import { toPoints, curveChange, curveBounds, curvePath, pointAtX, curveCoverage, pinLiveEquity } from '../lib/equityCurve.js'

const series = (equity, t0 = 1_700_000_000) => ({
  timestamp: equity.map((_, i) => t0 + i * 300),
  equity,
})

describe('toPoints', () => {
  it('zips the parallel arrays into ms-stamped points', () => {
    const p = toPoints(series([100, 101, 102]))
    expect(p).toHaveLength(3)
    expect(p[0].v).toBe(100)
    expect(p[0].t).toBe(1_700_000_000 * 1000)   // ms, so it feeds Date directly
  })

  it('drops nulls as HOLES rather than plotting them as zero', () => {
    // A null equity plotted as 0 is a cliff to the floor of the chart, which
    // reads as a total loss. This is the single most important case here.
    const p = toPoints({ timestamp: [1, 2, 3], equity: [100, null, 102] })
    expect(p).toHaveLength(2)
    expect(p.map(x => x.v)).toEqual([100, 102])
    expect(p.some(x => x.v === 0)).toBe(false)
  })

  it('refuses to pair values with the wrong timestamps', () => {
    // Mismatched lengths are real; zipping blindly plots a value against a
    // moment it did not happen at.
    expect(toPoints({ timestamp: [1, 2, 3, 4], equity: [10, 20] })).toHaveLength(2)
    expect(toPoints({ timestamp: [1], equity: [10, 20, 30] })).toHaveLength(1)
  })

  it('accepts both of the types Alpaca uses for a number', () => {
    // portfolio/history returns floats; the Order schema returns strings.
    expect(toPoints({ timestamp: ['1', '2'], equity: ['100.5', '101'] })).toEqual([
      { t: 1000, v: 100.5 }, { t: 2000, v: 101 },
    ])
  })

  it('survives garbage without throwing', () => {
    // null specifically: a destructuring default (`= {}`) fires only for
    // undefined, and a failed fetch hands you null. This test caught exactly
    // that, which is why the signature no longer destructures.
    for (const bad of [null, undefined, {}, { timestamp: 'x', equity: 'y' }, 42, 'str', []]) {
      expect(Array.isArray(toPoints(bad)), String(bad)).toBe(true)
    }
    expect(toPoints({ timestamp: [1, 2], equity: [NaN, Infinity] })).toHaveLength(0)
    expect(() => curveCoverage(null, [])).not.toThrow()
    expect(curveCoverage(null, []).empty).toBe(true)
  })
})

describe('curveChange', () => {
  it('measures from the first point, not from base_value', () => {
    // base_value is the account's STARTING CAPITAL, so on a 1D range it would
    // report the change since the account opened while labelled "today" —
    // true, and an answer to a different question.
    const c = curveChange(toPoints(series([100, 110])))
    expect(c.change).toBeCloseTo(10, 10)
    expect(c.changePct).toBeCloseTo(10, 10)
  })

  it('has no opinion with fewer than two points', () => {
    expect(curveChange(toPoints(series([100]))).change).toBeNull()
    expect(curveChange([]).change).toBeNull()
    expect(curveChange(null).change).toBeNull()
  })
})

describe('curveBounds', () => {
  it('gives a flat series a visible band instead of a zero range', () => {
    // A funded account that has never traded — where Mizan starts. A zero
    // range makes every normalised value NaN.
    const b = curveBounds(toPoints(series([100000, 100000, 100000])))
    expect(b.flat).toBe(true)
    expect(b.max).toBeGreaterThan(b.min)
  })

  it('pads a real range so the line is not flush to the edges', () => {
    const b = curveBounds(toPoints(series([100, 200])))
    expect(b.min).toBeLessThan(100)
    expect(b.max).toBeGreaterThan(200)
    expect(b.flat).toBe(false)
  })
})

describe('curvePath', () => {
  it('maps a higher value to a SMALLER y, because SVG grows downward', () => {
    // Getting this backwards draws every gain as a fall, and the chart still
    // looks entirely plausible.
    const { xy } = curvePath(toPoints(series([100, 200])), { w: 100, h: 50 })
    expect(xy[1].v).toBeGreaterThan(xy[0].v)
    expect(xy[1].y).toBeLessThan(xy[0].y)
  })

  it('spans the full width and starts with a moveto', () => {
    const { line, xy } = curvePath(toPoints(series([1, 2, 3])), { w: 600, h: 140 })
    expect(line.startsWith('M')).toBe(true)
    expect(xy[0].x).toBe(0)
    expect(xy[xy.length - 1].x).toBe(600)
  })

  it('produces finite coordinates for a flat series', () => {
    const { xy, line } = curvePath(toPoints(series([5, 5, 5])), { w: 100, h: 40 })
    expect(xy.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
    expect(line).not.toMatch(/NaN/)
  })

  it('centres a single point rather than pinning it to x=0', () => {
    const { xy } = curvePath(toPoints(series([42])), { w: 100, h: 40 })
    expect(xy).toHaveLength(1)
    expect(xy[0].x).toBe(50)
  })

  it('returns empty geometry, never a broken path, for no data', () => {
    expect(curvePath([], { w: 10, h: 10 })).toEqual({ line: '', area: '', xy: [] })
    expect(curvePath(null)).toEqual({ line: '', area: '', xy: [] })
  })

  it('closes the area down to the baseline', () => {
    const { area } = curvePath(toPoints(series([1, 2])), { w: 100, h: 40 })
    expect(area.endsWith('Z')).toBe(true)
    expect(area).toContain('L0 40.00')
  })
})

describe('pointAtX', () => {
  it('finds the nearest point for a crosshair', () => {
    const { xy } = curvePath(toPoints(series([1, 2, 3])), { w: 100, h: 40 })
    expect(pointAtX(xy, 0, 100).v).toBe(1)
    expect(pointAtX(xy, 100, 100).v).toBe(3)
    expect(pointAtX(xy, 50, 100).v).toBe(2)
  })

  it('clamps outside the viewBox instead of returning undefined', () => {
    const { xy } = curvePath(toPoints(series([1, 2, 3])), { w: 100, h: 40 })
    expect(pointAtX(xy, -999, 100).v).toBe(1)
    expect(pointAtX(xy, 9999, 100).v).toBe(3)
    expect(pointAtX([], 10)).toBeNull()
  })
})

describe('curveCoverage', () => {
  it('reports a day that has not started yet', () => {
    // A 1D range requested pre-open returns a full timestamp set with null
    // equity against nearly all of it. Without this the chart renders two
    // points and looks like a complete, very boring day.
    const raw = { timestamp: [1, 2, 3, 4, 5], equity: [100, null, null, null, null] }
    const c = curveCoverage(raw, toPoints(raw))
    expect(c.have).toBe(1)
    expect(c.total).toBe(5)
    expect(c.complete).toBe(false)
    expect(c.empty).toBe(false)
  })

  it('flags a genuinely empty window', () => {
    const raw = { timestamp: [1, 2], equity: [null, null] }
    expect(curveCoverage(raw, toPoints(raw)).empty).toBe(true)
  })
})

describe('toPoints — days before the account was funded', () => {
  it('drops the leading zero-equity run so the deposit is not counted as gain', () => {
    const raw = { timestamp: [1, 2, 3, 4], equity: [0, 0, 1000000, 1006000] }
    const pts = toPoints(raw)
    expect(pts.map((p) => p.v)).toEqual([1000000, 1006000])
    expect(curveChange(pts).change).toBe(6000)
  })
  it('keeps a later fall to zero', () => {
    expect(toPoints({ timestamp: [1, 2, 3], equity: [100, 0, 50] }).map((p) => p.v)).toEqual([100, 0, 50])
  })
})

describe('curveCoverage — unfunded days are not missing intervals', () => {
  it('reports complete coverage once funded', () => {
    const raw = { timestamp: [1, 2, 3, 4], equity: [0, 0, 1000000, 1006000] }
    expect(curveCoverage(raw, toPoints(raw))).toMatchObject({ have: 2, total: 2, complete: true })
  })
  it('still reports genuine holes after funding', () => {
    const raw = { timestamp: [1, 2, 3], equity: [100, null, 120] }
    expect(curveCoverage(raw, toPoints(raw))).toMatchObject({ have: 2, total: 3, complete: false })
  })
})

describe('pinLiveEquity', () => {
  const day = 86400000
  const pts = [{ t: 0, v: 1000000 }, { t: day, v: 1000000 }]
  it('appends the live value when the history has no point for today', () => {
    const out = pinLiveEquity(pts, '1006181.11', 2 * day)
    expect(out.at(-1)).toEqual({ t: 2 * day, v: 1006181.11 })
    expect(curveChange(out).change).toBeCloseTo(6181.11)
  })
  it('replaces a final point from the last hour rather than crowding it', () => {
    expect(pinLiveEquity(pts, 1000500, day + 60000)).toEqual([{ t: 0, v: 1000000 }, { t: day, v: 1000500 }])
  })
  it('ignores missing or junk live values and empty history', () => {
    expect(pinLiveEquity(pts, null, 2 * day)).toBe(pts)
    expect(pinLiveEquity(pts, '0', 2 * day)).toBe(pts)
    expect(pinLiveEquity([], 5, 1)).toEqual([])
  })
})
