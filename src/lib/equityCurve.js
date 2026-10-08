/**
 * Equity-curve geometry for the Trade Lab. Pure — no React, no DOM, no I/O.
 *
 * Alpaca's portfolio-history endpoint returns two parallel arrays, `timestamp`
 * (unix seconds) and `equity`. Everything a chart needs is derived here so the
 * component only paints.
 *
 * Three things this guards, each of which is a way a chart lies:
 *
 * 1. PARALLEL ARRAYS CAN DISAGREE IN LENGTH, and a chart that zips them
 *    blindly will happily plot a price against the wrong moment. Points are
 *    built only where BOTH sides exist and are finite.
 *
 * 2. NULLS ARE HOLES, NOT ZEROS. Alpaca emits null equity for a timestamp with
 *    no data (a halt, a gap). Plotted as 0 they become a cliff to the floor of
 *    the chart, which reads as catastrophic loss. They are dropped.
 *
 * 3. A FLAT SERIES HAS NO RANGE. Every value identical — exactly what a funded
 *    account that has never traded looks like, which is where Mizan starts —
 *    makes (v - min) / (max - min) a division by zero. A flat line is drawn
 *    down the middle rather than as NaN.
 *
 * Alpaca is also inconsistent about types across its own API: the Order schema
 * returns every numeric as a JSON string, while this endpoint returns floats.
 * Both are accepted.
 */

/** Alpaca sends floats here and strings elsewhere. Accept either, reject junk. */
const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * { timestamp[], equity[] } → [{ t, v }], oldest first.
 * Pairs are kept only where both halves are usable.
 */
export function toPoints(raw) {
  // NOT a destructuring default. `= {}` fires only for `undefined`, never for
  // `null`, and a fetch that failed hands you exactly null. This threw on its
  // own garbage test — the same shape of bug this codebase has now hit six
  // times, so the guard is explicit rather than clever.
  if (!raw || typeof raw !== "object") return [];
  const { timestamp, equity } = raw;
  if (!Array.isArray(timestamp) || !Array.isArray(equity)) return [];
  const n = Math.min(timestamp.length, equity.length);
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = num(timestamp[i]);
    const v = num(equity[i]);
    if (t === null || v === null) continue;      // a hole, not a zero
    out.push({ t: t * 1000, v });                 // ms, so it feeds Date directly
  }
  // Days before the account was funded read 0. They are not a balance, and
  // measuring from them reported the $1,000,000 opening deposit as gain on
  // the 2026-10-07 desk ("+$1,000,000.00 OVER 1M"). Only the LEADING run is
  // dropped: a funded account that later falls to 0 keeps every point.
  const funded = out.findIndex((p) => p.v > 0);
  return funded <= 0 ? out : out.slice(funded);
}

/**
 * Change across the window.
 *
 * Measured from the FIRST POINT, not from Alpaca's `base_value`. base_value is
 * the account's starting capital, so on a 1D range it would report the change
 * since the account was opened and label it "today" — a number that is both
 * true and an answer to a different question.
 */
export function curveChange(points) {
  if (!Array.isArray(points) || points.length < 2) {
    return { change: null, changePct: null, first: null, last: null };
  }
  const first = points[0].v, last = points[points.length - 1].v;
  return {
    first, last,
    change: last - first,
    changePct: first !== 0 ? ((last - first) / Math.abs(first)) * 100 : null,
  };
}

/** Min/max with headroom, and a sane band for a perfectly flat series. */
export function curveBounds(points) {
  if (!Array.isArray(points) || !points.length) return { min: 0, max: 1, flat: true };
  let min = Infinity, max = -Infinity;
  for (const p of points) { if (p.v < min) min = p.v; if (p.v > max) max = p.v; }
  if (min === max) {
    // A funded account that has never traded. Give it a visible band so the
    // line sits in the middle rather than dividing by a zero range.
    const pad = Math.abs(min) * 0.01 || 1;
    return { min: min - pad, max: max + pad, flat: true };
  }
  const pad = (max - min) * 0.08;
  return { min: min - pad, max: max + pad, flat: false };
}

/**
 * Points → an SVG path, plus the same path closed into an area.
 *
 * `w`/`h` are the viewBox, not pixels: the chart scales with its container and
 * the geometry never has to be recomputed on resize.
 */
export function curvePath(points, { w = 600, h = 140 } = {}) {
  if (!Array.isArray(points) || points.length === 0) return { line: "", area: "", xy: [] };
  const { min, max } = curveBounds(points);
  const span = max - min || 1;
  const n = points.length;

  const xy = points.map((p, i) => ({
    x: n === 1 ? w / 2 : (i / (n - 1)) * w,
    // SVG y grows downward, so a higher value must map to a SMALLER y.
    y: h - ((p.v - min) / span) * h,
    t: p.t, v: p.v,
  }));

  const line = xy.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
  const area = `${line} L${w.toFixed(2)} ${h.toFixed(2)} L0 ${h.toFixed(2)} Z`;
  return { line, area, xy };
}

/**
 * The point nearest a cursor x, for a crosshair.
 * Index-based: the series is evenly spaced by construction above.
 */
export function pointAtX(xy, x, w = 600) {
  if (!Array.isArray(xy) || !xy.length) return null;
  if (xy.length === 1) return xy[0];
  const ratio = Math.max(0, Math.min(1, x / w));
  return xy[Math.round(ratio * (xy.length - 1))] || null;
}

/**
 * How much of the window actually has data.
 *
 * A 1D range requested before the market opens returns a full set of
 * timestamps with null equity against almost all of them. Without this the
 * chart would render two points and look like a complete, very boring day
 * rather than one that has not started.
 */
export function curveCoverage(raw, points) {
  const timestamp = raw && typeof raw === "object" ? raw.timestamp : null;
  const have = Array.isArray(points) ? points.length : 0;
  // Count intervals from the first funded point: days before the account
  // existed were never "missing" (toPoints drops them on purpose).
  const startT = have ? points[0].t / 1000 : -Infinity;
  const total = Array.isArray(timestamp) ? timestamp.filter((t) => !(Number(t) < startT)).length : 0;
  return { have, total, complete: total > 0 && have === total, empty: have === 0 };
}

/**
 * End the curve at the broker's live equity. Alpaca's daily history has no
 * point for the session in progress (or just closed) until it rolls over, so
 * a desk up $6,181 today charted "$0.00 OVER 1M" next to a header showing the
 * gain. A live point within the last hour replaces the final point instead of
 * crowding it. Non-finite or non-positive live values are ignored.
 */
const PIN_MERGE_MS = 3600 * 1000;
export function pinLiveEquity(points, liveEquity, nowMs = Date.now()) {
  const pts = Array.isArray(points) ? points : [];
  const v = num(liveEquity);
  if (!pts.length || v === null || v <= 0) return pts;
  const last = pts[pts.length - 1];
  if (nowMs - last.t < PIN_MERGE_MS) return [...pts.slice(0, -1), { t: last.t, v }];
  return [...pts, { t: nowMs, v }];
}
