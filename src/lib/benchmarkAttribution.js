/**
 * Strategy vs benchmark attribution. Pure — no React, no DOM, no I/O.
 *
 * The Trade Lab proposal (§16, §23) is blunt about this surface: the dashboard
 * must state the alpha even when it is negative, and must never hide a losing
 * strategy behind a flattering win rate. So this module computes the comparison
 * and refuses to compute it when the comparison would be dishonest.
 *
 * THE RULE THAT MATTERS: a strategy and its benchmark must be measured over the
 * SAME window, from the SAME starting point. The strategy's equity series
 * begins the day it was funded; SPUS has existed for years. Comparing "strategy
 * since Thursday" against "SPUS year-to-date" produces a number that is
 * arithmetically correct and completely meaningless. `alignSeries` exists to
 * make that mistake impossible: it intersects the two series and reports what
 * it had to drop.
 *
 * Mizan has already paid for a version of this — the net-worth chart pinned its
 * tip to a bank-inclusive total while its history held brokerage-only values,
 * and the difference silently became "gain".
 */

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** A day key (YYYY-MM-DD) in UTC, so two series bucket identically. */
export function dayKey(ms) {
  const n = num(ms);
  if (n === null) return null;
  const d = new Date(n);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Intersect two {t, v} series on calendar day, oldest first.
 *
 * Returns { days, strategy, benchmark, dropped } where the two value arrays are
 * the same length and index-aligned. `dropped` says how many points of each
 * input had no counterpart — a caller showing alpha should surface that rather
 * than quietly comparing mismatched windows.
 */
export function alignSeries(strategyPoints, benchmarkPoints) {
  const out = { days: [], strategy: [], benchmark: [], dropped: { strategy: 0, benchmark: 0 } };
  const a = Array.isArray(strategyPoints) ? strategyPoints : [];
  const b = Array.isArray(benchmarkPoints) ? benchmarkPoints : [];

  // Last value wins within a day: an intraday series ends the day at its close.
  const index = (pts) => {
    const m = new Map();
    for (const p of pts) {
      const k = dayKey(p?.t);
      const v = num(p?.v);
      if (k === null || v === null) continue;
      m.set(k, v);
    }
    return m;
  };
  const A = index(a), B = index(b);

  for (const k of [...A.keys()].sort()) {
    if (!B.has(k)) continue;
    out.days.push(k);
    out.strategy.push(A.get(k));
    out.benchmark.push(B.get(k));
  }
  out.dropped.strategy = A.size - out.days.length;
  out.dropped.benchmark = B.size - out.days.length;
  return out;
}

/** Percent change from the first value to the last. Null if it cannot be stated. */
export function pctReturn(values) {
  if (!Array.isArray(values) || values.length < 2) return null;
  const first = num(values[0]), last = num(values[values.length - 1]);
  if (first === null || last === null || first === 0) return null;
  return ((last - first) / Math.abs(first)) * 100;
}

/**
 * The largest peak-to-trough fall, as a NEGATIVE percent (0 if never down).
 * Reported because a strategy that beat its benchmark by taking twice the
 * drawdown has not beaten it in any sense worth acting on.
 */
export function maxDrawdown(values) {
  if (!Array.isArray(values) || values.length < 2) return null;
  let peak = num(values[0]);
  if (peak === null) return null;
  let worst = 0;
  for (const raw of values) {
    const v = num(raw);
    if (v === null) continue;
    if (v > peak) peak = v;
    if (peak > 0) {
      const dd = ((v - peak) / peak) * 100;
      if (dd < worst) worst = dd;
    }
  }
  return worst;
}

/**
 * Strategy against benchmark over the aligned window.
 *
 * `alpha` is excess return in percentage POINTS, not a ratio — "+1.4 pp", not
 * "1.4%". The two read almost identically and mean different things.
 *
 * Every field is null rather than 0 when it cannot be honestly computed. Zero
 * means "flat"; null means "not enough data to say", and a dashboard must be
 * able to tell those apart.
 */
export function attribution(strategyPoints, benchmarkPoints, { benchmarkName = "SPUS" } = {}) {
  const aligned = alignSeries(strategyPoints, benchmarkPoints);
  const n = aligned.days.length;

  const sRet = pctReturn(aligned.strategy);
  const bRet = pctReturn(aligned.benchmark);

  return {
    benchmarkName,
    days: n,
    // Fewer than two aligned days is not a comparison, it is a single point.
    comparable: n >= 2 && sRet !== null && bRet !== null,
    strategyReturn: sRet,
    benchmarkReturn: bRet,
    alpha: sRet !== null && bRet !== null ? sRet - bRet : null,
    strategyDrawdown: maxDrawdown(aligned.strategy),
    benchmarkDrawdown: maxDrawdown(aligned.benchmark),
    // Honest-window reporting: a caller must be able to say "measured over 3 of
    // your 5 days" rather than implying full coverage.
    window: { from: aligned.days[0] || null, to: aligned.days[n - 1] || null, dropped: aligned.dropped },
  };
}

/**
 * How a one-day reading should be LABELLED, not whether to show it.
 *
 * The proposal's forward-testing section (§17) says a short forward record
 * cannot evidence an edge. The dashboard still shows day one — hiding it would
 * be its own distortion — but it must not let a day's noise read as a result.
 */
export function confidenceLabel(days) {
  const n = num(days) || 0;
  if (n < 2)   return { level: "none",        note: "Not yet a comparison — one data point." };
  if (n < 21)  return { level: "noise",       note: "Too short to mean anything. This is noise, not evidence." };
  if (n < 63)  return { level: "early",       note: "Early. A trend, not a result." };
  if (n < 126) return { level: "developing",  note: "Developing. Still inside the range where luck dominates." };
  return { level: "meaningful", note: "Long enough to discuss — still not proof of a persistent edge." };
}
