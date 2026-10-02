/**
 * Combining independent verdicts. Pure — no I/O, no clock.
 *
 * ⚠️ OWNER-ONLY. T2; see lib/ai/signalSchema.mjs.
 *
 * §15 is explicit that weights start EQUAL and stay there: letting the system
 * "learn" that one model deserves 1.34x after three good calls is fitting to
 * noise, and a weight fitted mid-experiment makes the whole record
 * uninterpretable. Weights may only change between frozen evaluation periods,
 * which is a decision for a human with months of data — not something this
 * module does on its own.
 *
 * §23 is equally explicit: never hide disagreement behind a single AI
 * recommendation. So the consensus is reported ALONGSIDE the spread, not
 * instead of it. Two models splitting BUY/SELL is a genuinely different state
 * from two models agreeing on HOLD, and a scalar score erases that difference
 * exactly when it matters most.
 *
 * The honest default is to decline. An ensemble that always produces a view
 * has no way to say "the panel does not know", and a forward record full of
 * manufactured conviction teaches nothing.
 */

/** Directional actions carry a sign; the rest express no view. */
const DIRECTION = Object.freeze({ BUY: 1, HOLD: 0, SELL: -1 });

/**
 * Combine validated signals.
 *
 * `minVotes` is how many DIRECTIONAL verdicts are needed before a consensus is
 * stated at all. Default 2 — a single voice is not a panel, and reporting one
 * model's opinion as "the committee" would be the central dishonesty this
 * whole structure exists to avoid.
 */
export function combine(signals, { minVotes = 2 } = {}) {
  const list = Array.isArray(signals) ? signals.filter(valid) : [];

  const votes = list.filter((s) => s.directional && s.action in DIRECTION);
  const abstentions = list.filter((s) => !s.directional);

  const byAction = {};
  for (const s of list) byAction[s.action] = (byAction[s.action] || 0) + 1;

  // Unanimity is about the DIRECTIONAL voters only. Two BUYs and an abstention
  // is a unanimous panel of two, not a split panel of three — the abstainer
  // expressed no view to disagree with.
  const actions = [...new Set(votes.map((s) => s.action))];
  const unanimous = votes.length > 0 && actions.length === 1;
  const split = actions.length > 1;

  // Opposed = at least one BUY and at least one SELL. A BUY against a HOLD is
  // a difference of conviction; a BUY against a SELL is a contradiction, and
  // the two should never be summarised the same way.
  const opposed = actions.includes("BUY") && actions.includes("SELL");

  if (votes.length < minVotes) {
    return {
      ok: false,
      code: votes.length === 0 ? "no_directional_votes" : "insufficient_votes",
      votes: votes.length, abstentions: abstentions.length, required: minVotes,
      by_action: byAction, unanimous: false, split, opposed,
      // Still reported, so a round that declined is auditable rather than blank.
      per_model: perModel(list),
    };
  }

  // Equal weight. §15 — deliberately not confidence-weighted either: a model's
  // self-reported confidence is not calibrated against any other model's, so
  // weighting by it silently hands the loudest model the most influence.
  const score = votes.reduce((sum, s) => sum + DIRECTION[s.action], 0) / votes.length;

  const consensus = score > 0.5 ? "BUY" : score < -0.5 ? "SELL" : "HOLD";

  // Mean confidence among those who voted the consensus direction. Reported as
  // context, never used as a weight.
  const agreeing = votes.filter((s) => s.action === consensus);
  const meanConfidence = agreeing.length
    ? agreeing.reduce((a, s) => a + (s.confidence ?? 0), 0) / agreeing.length
    : null;

  return {
    ok: true,
    consensus,
    score,                       // -1 .. +1, equal-weighted
    agreement: votes.length ? agreeing.length / votes.length : 0,
    unanimous, split, opposed,
    votes: votes.length,
    abstentions: abstentions.length,
    by_action: byAction,
    mean_confidence: meanConfidence,
    // The spread, always carried beside the number (§23).
    per_model: perModel(list),
    // A horizon the panel can actually be scored over: the shortest any
    // agreeing model named, because the first invalidation is what matters.
    horizon_days: agreeing.reduce((m, s) => {
      const h = Number(s.horizon_days);
      return Number.isFinite(h) && h > 0 ? (m === null ? h : Math.min(m, h)) : m;
    }, null),
  };
}

/** Each model's own verdict, preserved verbatim for attribution (§16). */
function perModel(list) {
  return list.map((s) => ({
    provider: s.provider ?? null,
    model: s.model ?? null,
    action: s.action,
    confidence: s.confidence ?? null,
    horizon_days: s.horizon_days ?? null,
    expected_return_pct: s.expected_return_pct ?? null,
    downside_pct: s.downside_pct ?? null,
    risk_flags: Array.isArray(s.risk_flags) ? s.risk_flags.slice(0, 6) : [],
  }));
}

function valid(s) {
  return s && typeof s === "object" && typeof s.action === "string";
}

/**
 * Should this consensus be acted on at all, were the strategy ever taken out
 * of shadow?
 *
 * Deliberately strict and deliberately separate from `combine`: reporting what
 * a panel thinks and deciding to trade on it are different questions, and
 * collapsing them is how a research tool quietly becomes an execution one.
 *
 * Nothing calls this today — the panel runs in SHADOW and cannot reach a
 * broker. It exists so the bar is written down BEFORE there is any pressure to
 * lower it.
 */
export function actionable(result, { minAgreement = 1, requireUnanimous = true } = {}) {
  if (!result?.ok) return { ok: false, code: result?.code || "no_consensus" };
  if (result.opposed) return { ok: false, code: "opposed" };
  if (requireUnanimous && !result.unanimous) return { ok: false, code: "not_unanimous" };
  if (result.agreement < minAgreement) return { ok: false, code: "weak_agreement" };
  if (result.consensus === "HOLD") return { ok: false, code: "no_direction" };
  return { ok: true, action: result.consensus };
}
