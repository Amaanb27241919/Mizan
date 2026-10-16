/**
 * Pure (no React, no I/O): how much of a strategy's Sharpe ratio survives the
 * fact that we ran FOURTEEN strategies and are about to pick the best one.
 *
 * Why this exists (2026-10-16). The Trade Lab compares 14 strategies and the
 * end goal is to put real money behind the winner. Selecting the best of N
 * candidates inflates its Sharpe even when every one of them is skill-less:
 * the winner is the luckiest draw, not the best system. With N = 14 the
 * inflation is ~1.74 standard errors, so over 10 trading days a completely
 * random strategy book produces a "best" annualised Sharpe near 8.7. Nothing
 * in labMetrics.js accounted for that, so every ranking we showed was
 * silently optimistic.
 *
 * The fix is Bailey & López de Prado's Probabilistic and Deflated Sharpe
 * Ratios (2012; "The Deflated Sharpe Ratio", 2014):
 *   PSR — the probability the TRUE Sharpe exceeds a benchmark, given the
 *         sample's length, skew and fat tails.
 *   DSR — the same probability measured against the Sharpe you would expect
 *         from the best of N skill-less trials. DSR > 0.95 is the usual bar.
 * Both correct for the two things a raw Sharpe ignores: short samples, and
 * returns that are skewed or fat-tailed (which ours are — a swing book of
 * stops and targets is nothing like a normal distribution).
 *
 * EVERYTHING HERE IS PER-OBSERVATION (daily), because the formulas require
 * the Sharpe and the observation count to share a frequency. Annualised
 * figures are derived only for display, via `annualise`.
 *
 * An unknown stays unknown: too few observations, zero variance, or fewer
 * than two trials all return null rather than a confident-looking number.
 */
const arr = (v) => (Array.isArray(v) ? v : []);
const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** Trading days per year — the same 252 the rest of the lab annualises with. */
export const PERIODS_PER_YEAR = 252;
/** Below this many observations the moment estimates are too noisy to deflate. */
export const MIN_OBSERVATIONS = 20;
/** Euler–Mascheroni, in the expected-maximum formula. */
const EULER_MASCHERONI = 0.5772156649015329;

/**
 * Complementary error function (Numerical Recipes Chebyshev fit, ~1e-15).
 * JS has no erfc, and the whole module is a normal-distribution argument, so
 * an approximation that is merely "close" would show up directly in a
 * probability the owner reads as a go/no-go.
 */
function erfc(x) {
  const z = Math.abs(x);
  const t = 2 / (2 + z);
  const ty = 4 * t - 2;
  const cof = [
    -1.3026537197817094, 6.4196979235649026e-1, 1.9476473204185836e-2, -9.561514786808631e-3,
    -9.46595344482036e-4, 3.66839497852761e-4, 4.2523324806907e-5, -2.0278578112534e-5,
    -1.624290004647e-6, 1.30365583558e-6, 1.5626441722e-8, -8.5238095915e-8,
    6.529054439e-9, 5.059343495e-9, -9.91364156e-10, -2.27365122e-10,
    9.6467911e-11, 2.394038e-12, -6.886027e-12, 8.94487e-13,
    3.13092e-13, -1.12708e-13, 3.81e-16, 7.106e-15,
  ];
  let d = 0, dd = 0;
  for (let j = cof.length - 1; j > 0; j--) { const tmp = d; d = ty * d - dd + cof[j]; dd = tmp; }
  const ans = t * Math.exp(-z * z + 0.5 * (cof[0] + ty * d) - dd);
  return x >= 0 ? ans : 2 - ans;
}

/** Standard normal CDF, Φ(z). */
export function normalCdf(z) {
  const x = num(z);
  if (x === null) return null;
  return 0.5 * erfc(-x / Math.SQRT2);
}

/**
 * Standard normal quantile, Φ⁻¹(p) (Acklam's rational approximation, ~1e-9).
 * Returns null outside (0, 1) rather than ±Infinity, so a caller cannot
 * accidentally render "Infinity days".
 */
export function normalInv(p) {
  const q = num(p);
  if (q === null || q <= 0 || q >= 1) return null;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425, pHigh = 1 - pLow;
  let x;
  if (q < pLow) {
    const u = Math.sqrt(-2 * Math.log(q));
    x = (((((c[0] * u + c[1]) * u + c[2]) * u + c[3]) * u + c[4]) * u + c[5]) / ((((d[0] * u + d[1]) * u + d[2]) * u + d[3]) * u + 1);
  } else if (q <= pHigh) {
    const u = q - 0.5, r = u * u;
    x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * u /
        (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const u = Math.sqrt(-2 * Math.log(1 - q));
    x = -(((((c[0] * u + c[1]) * u + c[2]) * u + c[3]) * u + c[4]) * u + c[5]) / ((((d[0] * u + d[1]) * u + d[2]) * u + d[3]) * u + 1);
  }
  // One Halley step: Acklam's own refinement, cheap and takes it to ~1e-15.
  const e = 0.5 * erfc(-x / Math.SQRT2) - q;
  const u2 = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  return x - u2 / (1 + (x * u2) / 2);
}

/**
 * Sample moments of a daily return series: the per-day Sharpe plus the skew
 * and kurtosis the PSR needs. Kurtosis is NON-EXCESS (a normal returns 3),
 * which is the convention Bailey & López de Prado's formula expects —
 * passing excess kurtosis here would silently overstate every probability.
 */
export function returnMoments(returns) {
  const r = arr(returns).map(num).filter((x) => x !== null);
  const n = r.length;
  if (n < 2) return null;
  const mean = r.reduce((s, x) => s + x, 0) / n;
  const dev = r.map((x) => x - mean);
  // Population SD, matching the maximum-likelihood moments the formula assumes.
  const m2 = dev.reduce((s, x) => s + x * x, 0) / n;
  const sd = Math.sqrt(m2);
  if (!(sd > 0)) return null;
  const m3 = dev.reduce((s, x) => s + x ** 3, 0) / n;
  const m4 = dev.reduce((s, x) => s + x ** 4, 0) / n;
  return { n, mean, sd, sharpe: mean / sd, skew: m3 / sd ** 3, kurtosis: m4 / sd ** 4 };
}

/** Daily Sharpe → annualised, the only place the two frequencies meet. */
export function annualise(dailySharpe) {
  const s = num(dailySharpe);
  return s === null ? null : s * Math.sqrt(PERIODS_PER_YEAR);
}

/**
 * Probabilistic Sharpe Ratio: P(true Sharpe > `benchmark`), given a sample of
 * `n` observations with this skew and kurtosis. All Sharpes are per-day.
 */
export function probabilisticSharpe(input) {
  const { sharpe, n, skew = 0, kurtosis = 3, benchmark = 0 } = input || {};
  const sr = num(sharpe), obs = num(n), g3 = num(skew) ?? 0, g4 = num(kurtosis) ?? 3, b = num(benchmark) ?? 0;
  if (sr === null || obs === null || obs < 2) return null;
  // The variance of the Sharpe estimator under non-normal returns.
  const variance = 1 - g3 * sr + ((g4 - 1) / 4) * sr * sr;
  if (!(variance > 0)) return null;
  return normalCdf(((sr - b) * Math.sqrt(obs - 1)) / Math.sqrt(variance));
}

/**
 * The Sharpe you should EXPECT from the best of `trials` skill-less
 * strategies, given how much their Sharpes vary. This is the bar a winner
 * has to clear to be called better than luck.
 *
 * `sharpeSd` is the spread of the trial Sharpes (per-day). Pass the real
 * spread across the strategies actually compared — using a guessed one is
 * what makes a deflated number meaningless.
 */
export function expectedMaxSharpe(trials, sharpeSd) {
  const nT = num(trials), sd = num(sharpeSd);
  if (nT === null || sd === null || nT < 2 || !(sd > 0)) return null;
  const a = normalInv(1 - 1 / nT);
  const b = normalInv(1 - 1 / (nT * Math.E));
  if (a === null || b === null) return null;
  return sd * ((1 - EULER_MASCHERONI) * a + EULER_MASCHERONI * b);
}

/**
 * How many observations this strategy would need before its Sharpe could be
 * called real at `confidence`. The honest answer to "is it too early?" —
 * null when the strategy is already below the bar, where no amount of time
 * helps without the returns themselves improving.
 */
export function minTrackRecordLength(input) {
  const { sharpe, skew = 0, kurtosis = 3, benchmark = 0, confidence = 0.95 } = input || {};
  const sr = num(sharpe), g3 = num(skew) ?? 0, g4 = num(kurtosis) ?? 3, b = num(benchmark) ?? 0;
  const z = normalInv(num(confidence) ?? 0.95);
  if (sr === null || z === null || !(sr > b)) return null;
  const variance = 1 - g3 * sr + ((g4 - 1) / 4) * sr * sr;
  if (!(variance > 0)) return null;
  return 1 + variance * (z / (sr - b)) ** 2;
}

/**
 * The whole assessment for one strategy, given the daily returns of EVERY
 * strategy it is being compared against.
 *
 *   returns      this strategy's daily simple returns
 *   trialSharpes the per-day Sharpe of each strategy in the comparison,
 *                including this one — the N we are selecting from
 *   confidence   the bar, default 0.95
 *
 * → { ready, n, sharpe, sharpeAnnual, skew, kurtosis, psr, dsr, trials,
 *     benchmarkSharpe, benchmarkSharpeAnnual, decidable, needsDays, shortfallDays }
 * `ready:false` (with `needed`) when there are too few days to say anything.
 */
export function assessStrategy(input) {
  const { returns, trialSharpes, confidence = 0.95, minObservations = MIN_OBSERVATIONS } = input || {};
  const m = returnMoments(returns);
  const need = num(minObservations) ?? MIN_OBSERVATIONS;
  if (!m) return { ready: false, n: arr(returns).length, needed: need };
  if (m.n < need) return { ready: false, n: m.n, needed: need };

  const trials = arr(trialSharpes).map(num).filter((x) => x !== null);
  const nT = trials.length;
  let srStar = null;
  if (nT >= 2) {
    const tMean = trials.reduce((s, x) => s + x, 0) / nT;
    const tSd = Math.sqrt(trials.reduce((s, x) => s + (x - tMean) ** 2, 0) / (nT - 1));
    srStar = expectedMaxSharpe(nT, tSd);
  }
  const moments = { sharpe: m.sharpe, n: m.n, skew: m.skew, kurtosis: m.kurtosis };
  const psr = probabilisticSharpe({ ...moments, benchmark: 0 });
  const dsr = srStar === null ? null : probabilisticSharpe({ ...moments, benchmark: srStar });
  const conf = num(confidence) ?? 0.95;
  const trl = srStar === null ? null : minTrackRecordLength({ ...moments, benchmark: srStar, confidence: conf });

  return {
    ready: true,
    n: m.n,
    sharpe: m.sharpe,
    sharpeAnnual: annualise(m.sharpe),
    skew: m.skew,
    kurtosis: m.kurtosis,
    psr,
    dsr,
    trials: nT,
    benchmarkSharpe: srStar,
    benchmarkSharpeAnnual: annualise(srStar),
    // The verdict, and the only thing a reader needs: is this distinguishable
    // from the best of N coin flips?
    decidable: dsr !== null && dsr >= conf,
    needsDays: trl === null ? null : Math.ceil(trl),
    shortfallDays: trl === null ? null : Math.max(0, Math.ceil(trl) - m.n),
  };
}

/**
 * Daily simple returns from a curve of CUMULATIVE percentage returns
 * ([{day, returnPct}], as /api/bot/curves returns them). The lab stores each
 * strategy as a cumulative line, so this is the bridge into the moment math.
 */
export function dailyFromCumulativePct(points) {
  const pts = arr(points).filter((p) => p && typeof p.day === "string" && num(p.returnPct) !== null);
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    const prev = 1 + num(pts[i - 1].returnPct) / 100;
    const cur = 1 + num(pts[i].returnPct) / 100;
    if (prev > 0 && cur > 0) out.push(cur / prev - 1);
  }
  return out;
}

/**
 * Assess every strategy against the same N. One call for the whole lab:
 * `curves` is { [id]: { points } } and the comparison set is every strategy
 * with enough history — which is exactly the set we are selecting from.
 * → { [id]: assessment }, plus `trials` on each so the UI can say "best of N".
 */
export function assessAll(curves, opts) {
  const c = curves && typeof curves === "object" && !Array.isArray(curves) ? curves : {};
  const minObs = num(opts?.minObservations) ?? MIN_OBSERVATIONS;
  // EVERY strategy with a curve gets an entry, even one too short to assess —
  // it comes back `ready:false`. Dropping it instead would make a strategy
  // silently disappear from the comparison, which is the failure this module
  // exists to prevent.
  const series = {};
  for (const [id, curve] of Object.entries(c)) {
    if (!curve || typeof curve !== "object") continue;
    series[id] = dailyFromCumulativePct(curve.points);
  }
  // The trial set: every strategy long enough to have a usable Sharpe. A
  // strategy with 3 days does not get a vote on how lucky the winner is.
  const trialSharpes = [];
  for (const r of Object.values(series)) {
    const m = returnMoments(r);
    if (m && m.n >= minObs) trialSharpes.push(m.sharpe);
  }
  const out = {};
  for (const [id, r] of Object.entries(series)) {
    out[id] = assessStrategy({ returns: r, trialSharpes, confidence: opts?.confidence ?? 0.95, minObservations: minObs });
  }
  return out;
}
