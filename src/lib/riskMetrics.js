/**
 * Concentration and drawdown for the paper desk. Pure — no React, no I/O.
 *
 * The live halal momentum book holds 25 names and roughly sixteen of them are
 * the same bet: AI datacentre hardware. Inverse-vol sizing makes the position
 * WEIGHTS look even, which is precisely what hides it — twenty-five tidy 4%
 * slices of one trade still behave like one trade. Nothing in the app said so.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ────────────────────────────────────
 * It computes no risk-adjusted score, no "risk level", and no suggestion.
 * Every number here is a property of the book the user already holds, which
 * keeps it Tier 1 / ACCOUNT_SERVICING: describing their own position, never
 * judging it or implying an action. "Your top 5 names are 38% of the book" is
 * arithmetic. "You are over-concentrated, trim NVDA" is a recommendation and
 * is the RIA line (docs/COMPLIANCE.md, CLAUDE.md §1).
 *
 * ── PARTIAL DATA IS REPORTED, NEVER PAPERED OVER ──────────────────────────
 * Industry comes from the cached screening verdicts and some names will not
 * have one. A clustering number computed over 60% of the book, presented as
 * if it covered all of it, is worse than no number — the same failure as a
 * rate-limited screen reading as mass non-compliance. Every grouping here
 * carries its own coverage, and a caller is expected to show it.
 */

/** Sum of squared weights. 1/HHI is the "effective number of positions". */
export function herfindahl(weights) {
  const w = (Array.isArray(weights) ? weights : [])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n > 0);
  const total = w.reduce((t, n) => t + n, 0);
  if (total <= 0) return null;
  return w.reduce((t, n) => t + (n / total) ** 2, 0);
}

/**
 * Position-level concentration.
 *
 * `effectiveNames` is the one worth reading: 25 equally weighted positions
 * give 25, and the more lopsided the book the lower it goes. It answers "how
 * many bets is this really" in a way a position count cannot.
 */
export function concentration(positions, { topK = 5 } = {}) {
  const list = (Array.isArray(positions) ? positions : [])
    .map((p) => ({
      symbol: String(p?.symbol ?? "").toUpperCase(),
      value: Number(p?.value) || 0,
    }))
    .filter((p) => p.symbol && p.value > 0)
    .sort((a, b) => b.value - a.value);

  const total = list.reduce((t, p) => t + p.value, 0);
  if (!list.length || total <= 0) {
    return { count: 0, total: 0, rows: [], top: [], topWeight: null,
      hhi: null, effectiveNames: null, largest: null };
  }

  const rows = list.map((p) => ({ ...p, weight: p.value / total }));
  const top = rows.slice(0, Math.max(1, topK));
  const hhi = herfindahl(rows.map((r) => r.value));

  return {
    count: rows.length,
    total,
    rows,
    top,
    topWeight: top.reduce((t, r) => t + r.weight, 0),
    hhi,
    // Rounded to one decimal: the precision beyond that is noise.
    effectiveNames: hhi ? Math.round((1 / hhi) * 10) / 10 : null,
    largest: rows[0],
  };
}

/**
 * Group the book by any label — industry, sector, whatever the caller has.
 *
 * `labelFor` returns a string, or null when unknown. Unknowns are tracked as
 * COVERAGE, not as a bucket called "Other" that silently competes with real
 * ones for the top spot.
 */
export function groupExposure(positions, labelFor, { minShare = 0 } = {}) {
  const list = (Array.isArray(positions) ? positions : [])
    .map((p) => ({
      symbol: String(p?.symbol ?? "").toUpperCase(),
      value: Number(p?.value) || 0,
    }))
    .filter((p) => p.symbol && p.value > 0);

  const total = list.reduce((t, p) => t + p.value, 0);
  const get = typeof labelFor === "function" ? labelFor : () => null;

  const buckets = new Map();
  let labelledValue = 0;
  let unknown = 0;

  for (const p of list) {
    let label = null;
    try { label = get(p.symbol); } catch { label = null; }
    const name = typeof label === "string" && label.trim() ? label.trim() : null;
    if (!name) { unknown += 1; continue; }
    labelledValue += p.value;
    const b = buckets.get(name) || { label: name, value: 0, symbols: [] };
    b.value += p.value;
    b.symbols.push(p.symbol);
    buckets.set(name, b);
  }

  // Shares are of the LABELLED value, so a bucket's percentage is honest
  // about the slice of the book it was actually computed over.
  const groups = [...buckets.values()]
    .map((b) => ({ ...b, share: labelledValue > 0 ? b.value / labelledValue : 0 }))
    .filter((b) => b.share >= minShare)
    .sort((a, b) => b.value - a.value);

  return {
    groups,
    total,
    labelledValue,
    labelled: list.length - unknown,
    unknown,
    // 1.0 means every position had a label. A caller MUST surface anything less.
    coverage: list.length ? (list.length - unknown) / list.length : 0,
    largest: groups[0] || null,
    hhi: herfindahl(groups.map((g) => g.value)),
  };
}

/**
 * Peak-to-trough on an equity series.
 *
 * Returns null rather than 0 when there is not enough history — a brand new
 * account has NOT had a 0% drawdown, it has had no measurable drawdown, and
 * the two read very differently next to a number.
 */
export function maxDrawdown(points, { minPoints = 3 } = {}) {
  const series = (Array.isArray(points) ? points : [])
    .map((p) => (typeof p === "number" ? { value: p } : p))
    .map((p) => ({ date: p?.date ?? null, value: Number(p?.value) }))
    .filter((p) => Number.isFinite(p.value) && p.value > 0);

  if (series.length < minPoints) {
    return { depth: null, peak: null, trough: null, points: series.length, measurable: false };
  }

  let peak = series[0], trough = series[0], worst = 0;
  let runPeak = series[0];
  for (const p of series) {
    if (p.value > runPeak.value) runPeak = p;
    const dd = (runPeak.value - p.value) / runPeak.value;
    if (dd > worst) { worst = dd; peak = runPeak; trough = p; }
  }

  return {
    depth: worst,              // 0.043 = a 4.3% drawdown
    peak: worst > 0 ? peak : null,
    trough: worst > 0 ? trough : null,
    points: series.length,
    measurable: true,
  };
}
