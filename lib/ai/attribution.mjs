/**
 * Scoring what the panel said against what actually happened.
 * Pure — no I/O, no clock of its own.
 *
 * ⚠️ OWNER-ONLY. T2; see lib/ai/signalSchema.mjs. Nothing derived from this
 * may appear in marketing or a digest email — strategy performance figures are
 * off-limits in public material regardless of disclaimers.
 *
 * This is the module most able to produce a flattering lie, so the guards
 * matter more than the metrics:
 *
 * 1. A VERDICT IS NOT SCORABLE UNTIL ITS HORIZON ELAPSES. A model that said
 *    BUY on a 90-day view is not wrong on day three. Scoring open positions
 *    lets you harvest whichever ones currently look good, which is the single
 *    easiest way to manufacture a track record.
 *
 * 2. DIRECTION IS NOT ENOUGH. A model right 60% of the time and wrong by large
 *    amounts is worse than one right 45% and wrong by small ones. Accuracy is
 *    reported next to magnitude, never alone.
 *
 * 3. EXCESS, NOT RAW. A BUY returning +5% while SPUS returned +8% is a bad
 *    call. Raw return measures the market; excess measures the model.
 *
 * 4. CALIBRATION IS SEPARATE FROM ACCURACY. A model saying 0.9 and being right
 *    90% of the time is calibrated; one saying 0.9 and being right half the
 *    time is overconfident and more dangerous than a model that says 0.5.
 *    Brier score captures what a win rate cannot.
 *
 * 5. AN ABSTENTION IS NOT A WRONG ANSWER. Declining before a crash is a good
 *    call and declining before a rally is a missed one, but neither is a
 *    directional error. Abstentions are tracked separately and never folded
 *    into a win rate.
 *
 * 6. A SMALL SAMPLE IS REPORTED AS A SMALL SAMPLE. §17 — a short forward
 *    record cannot evidence an edge, so the scorer refuses to state a win rate
 *    below a minimum and says why.
 */

export const MIN_SAMPLE = 20;

/** Directions that make a falsifiable claim about price. */
const DIRECTIONAL = Object.freeze(new Set(["BUY", "SELL"]));

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Resolve ONE verdict against what happened.
 *
 * Returns `{ state: "open" }` when the horizon has not elapsed — deliberately
 * carrying no score at all, so an unresolved verdict cannot leak into a
 * statistic. `holdBandPct` is how far price may move before a HOLD is
 * considered wrong; a HOLD is a claim that nothing much happens, and without a
 * band it would be unfalsifiable.
 */
export function resolveVerdict(input) {
  // NOT a destructuring default. `= {}` fires only for `undefined`, never for
  // `null`, and `null` is exactly what a failed lookup hands you. I have made
  // this mistake three times in this codebase in a single session, including
  // once AFTER writing a note about it — so the guard is explicit and first.
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { state: "invalid", code: "no_input" };
  }
  const {
    action, confidence = null, expectedReturnPct = null, horizonDays = null,
    priceAtDecision = null, priceNow = null,
    benchmarkAtDecision = null, benchmarkNow = null,
    daysElapsed = null, holdBandPct = 5,
  } = input;

  const act = typeof action === "string" ? action.toUpperCase() : null;
  if (!act) return { state: "invalid", code: "no_action" };

  const p0 = num(priceAtDecision), p1 = num(priceNow);
  const d = num(daysElapsed), h = num(horizonDays);

  if (p0 === null || p1 === null || p0 <= 0) return { state: "invalid", code: "no_prices" };

  // Guard 1. An open verdict carries NO score — not a provisional one.
  if (h !== null && d !== null && d < h) {
    return { state: "open", days_elapsed: d, horizon_days: h, action: act };
  }

  const ret = ((p1 - p0) / p0) * 100;

  // Guard 3. Excess over the benchmark is what measures the model.
  const b0 = num(benchmarkAtDecision), b1 = num(benchmarkNow);
  const benchRet = b0 !== null && b1 !== null && b0 > 0 ? ((b1 - b0) / b0) * 100 : null;
  const excess = benchRet === null ? null : ret - benchRet;

  // Guard 5. An abstention makes no directional claim and is never scored
  // right or wrong — only recorded, with what it passed up.
  if (!DIRECTIONAL.has(act) && act !== "HOLD") {
    return {
      state: "resolved", action: act, scored: false,
      return_pct: ret, benchmark_return_pct: benchRet, excess_pct: excess,
      days_elapsed: d, horizon_days: h,
    };
  }

  let correct;
  if (act === "BUY")       correct = excess !== null ? excess > 0 : ret > 0;
  else if (act === "SELL") correct = excess !== null ? excess < 0 : ret < 0;
  else                     correct = Math.abs(ret) <= Math.abs(num(holdBandPct) ?? 5);

  // Guard 2. Magnitude travels with direction. For a directional call, the
  // signed benefit is the excess in the direction claimed.
  const signed = act === "SELL" ? -(excess ?? ret) : (excess ?? ret);

  // Guard 4. Brier needs a probability and an outcome. Only meaningful where
  // the model staked a confidence on a falsifiable claim.
  const c = num(confidence);
  const brier = c !== null && c >= 0 && c <= 1 ? Math.pow(c - (correct ? 1 : 0), 2) : null;

  const expected = num(expectedReturnPct);
  return {
    state: "resolved", action: act, scored: true, correct,
    return_pct: ret, benchmark_return_pct: benchRet, excess_pct: excess,
    signed_excess_pct: act === "HOLD" ? null : signed,
    confidence: c, brier,
    expected_return_pct: expected,
    // Positive = delivered more than promised. A model directionally right but
    // wildly over its own forecast is miscalibrated on magnitude, which a win
    // rate would never show.
    expectation_error_pct: expected !== null && act !== "HOLD" ? signed - expected : null,
    days_elapsed: d, horizon_days: h,
  };
}

/**
 * Aggregate resolved verdicts for one model.
 *
 * Refuses to state a win rate below MIN_SAMPLE and says so, rather than
 * publishing a number that a handful of lucky calls produced.
 */
export function scoreModel(resolved, opts) {
  const { minSample = MIN_SAMPLE } = opts || {};
  const list = Array.isArray(resolved) ? resolved.filter((r) => r && r.state === "resolved") : [];
  const scored = list.filter((r) => r.scored);
  const abstentions = list.filter((r) => !r.scored);

  const hits = scored.filter((r) => r.correct);
  const misses = scored.filter((r) => !r.correct);

  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const excesses = scored.map((r) => r.signed_excess_pct).filter((v) => v !== null && Number.isFinite(v));
  const briers = scored.map((r) => r.brier).filter((v) => v !== null);

  const enough = scored.length >= minSample;

  return {
    n_resolved: list.length,
    n_scored: scored.length,
    n_abstained: abstentions.length,

    // Guard 6. Null until there is enough to mean anything.
    win_rate: enough ? hits.length / scored.length : null,
    sample_sufficient: enough,
    min_sample: minSample,
    note: enough ? null
      : `${scored.length} of ${minSample} scored verdicts — too few to state a win rate.`,

    // Guard 2. Magnitude, always, even below the sample floor: the average
    // outcome is informative where a ratio is not.
    mean_excess_pct: mean(excesses),
    mean_win_excess_pct: mean(hits.map((r) => r.signed_excess_pct).filter((v) => v !== null)),
    mean_loss_excess_pct: mean(misses.map((r) => r.signed_excess_pct).filter((v) => v !== null)),

    // Guard 4. Lower is better; 0.25 is what you get by always saying 0.5.
    brier: mean(briers),
    brier_baseline: 0.25,

    // Guard 2 again, stated outright: being right more often than not is
    // worthless if the losses are bigger than the wins.
    edge_positive: mean(excesses) !== null ? mean(excesses) > 0 : null,

    // Guard 5. Reported, never folded into the win rate.
    abstention_rate: list.length ? abstentions.length / list.length : null,
    mean_abstained_excess_pct: mean(abstentions.map((r) => r.excess_pct).filter((v) => v !== null)),
  };
}

/**
 * Compare models against each other AND against doing nothing.
 *
 * `rows` is [{ provider, model, resolved[] }]. The comparison that matters is
 * not which model ranks first — with two models and a short record that is
 * mostly noise — but whether ANY of them beat the benchmark, which is the
 * question the whole experiment exists to answer.
 */
export function compareModels(rows, opts) {
  const { minSample = MIN_SAMPLE } = opts || {};
  const list = Array.isArray(rows) ? rows.filter((r) => r && typeof r === "object") : [];
  const scored = list.map((r) => ({
    provider: r.provider ?? null,
    model: r.model ?? null,
    ...scoreModel(r.resolved, { minSample }),
  }));

  const withEdge = scored.filter((s) => s.mean_excess_pct !== null);
  const anyBeatBenchmark = withEdge.some((s) => s.mean_excess_pct > 0);

  return {
    models: scored,
    // Deliberately not a leaderboard. Ranking two models on a short record
    // invites reading noise as skill.
    any_beat_benchmark: withEdge.length ? anyBeatBenchmark : null,
    all_sufficient: scored.length > 0 && scored.every((s) => s.sample_sufficient),
    verdict: !scored.length ? "no_data"
      : !scored.every((s) => s.sample_sufficient) ? "too_early"
      : anyBeatBenchmark ? "some_edge_observed"
      // The outcome the plan calls most valuable: cheap, early, and decisive.
      : "no_edge_observed",
  };
}
