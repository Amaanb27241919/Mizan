/**
 * The model-output contract for the Trade Lab research committee.
 * Pure — no I/O, no clock, no provider SDKs.
 *
 * ⚠️ OWNER-ONLY SURFACE. The compliance gate classified this output as T2:
 * `{"action":"BUY","expected_return_pct":8.4}` rendered against the owner's own
 * portfolio is merit, personal, and directional — all three discriminators
 * fail. It is permissible only because there is exactly one user and that user
 * is the operator: advice to oneself is not advice to a client. The containment
 * is STRUCTURAL, not linguistic — there is no T0 rewrite that preserves the
 * value, because the value IS the directional call.
 *
 * Consequences that live in code, not in a comment:
 *   · every route serving this must gate on isRootUser, NOT canUseTradingBot
 *     (which also returns true for the trading_bot_enabled beta allowlist, so
 *     re-enabling a tester later would hand them a T2 surface);
 *   · this must NEVER route through /api/advisor — advisor-filter.mjs rewrites
 *     personalized advice into a compliant redirect, which would filter a
 *     committee verdict into uselessness. That it would break the feature is
 *     the proof the feature sits on the other side of the public line;
 *   · nothing derived from this may appear in marketing, the landing page, or
 *     a digest email — strategy performance figures are off-limits in public
 *     material regardless of disclaimers.
 *
 * ── WHY A VALIDATOR, AND WHY IT IS STRICT ─────────────────────────────────
 * §25 requires that "every AI provider returns the same validated schema" and
 * that "invalid schemas cannot reach portfolio construction". Four providers
 * return four dialects of almost-JSON: fenced in markdown, wrapped in prose,
 * with confidence as "77%" or 77 or 0.77, with invented extra fields, or with
 * a thesis where a number belongs.
 *
 * The rule here is REJECT, NEVER REPAIR. A validator that coerces "77%" into
 * 0.77 is guessing at a model's intent, and a guess that lands in a trading
 * decision is worse than a dropped signal. An abstention is free; a
 * misinterpreted conviction is not.
 */

/** The only actions a model may return. ABSTAIN is a first-class answer. */
export const ACTIONS = Object.freeze(["BUY", "HOLD", "SELL", "ABSTAIN", "INSUFFICIENT_DATA"]);

/** Actions that express no directional view — never sized, never traded on. */
export const NON_DIRECTIONAL = Object.freeze(["ABSTAIN", "INSUFFICIENT_DATA"]);

export const SCHEMA_VERSION = 1;

/**
 * Pull the JSON object out of whatever a model actually sent.
 *
 * Deliberately tolerant about PACKAGING and strict about CONTENT: a model
 * fencing its JSON in ```json is a formatting quirk, while a model returning a
 * confidence of 77 when the contract says 0–1 is a semantic disagreement that
 * must surface as a rejection.
 */
export function extractJson(raw) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  if (typeof raw !== "string") return null;

  const text = raw.trim();
  if (!text) return null;

  // A bare ARRAY is a contract violation, not a packaging quirk: the contract
  // is one verdict per model per ticker. Reaching into it for element 0 would
  // silently discard the rest and present a partial answer as the whole one —
  // a repair, which is the thing this module exists not to do.
  if (text.startsWith("[")) return null;

  const direct = tryParse(text);
  if (direct) return direct;

  // ```json ... ``` or ``` ... ```
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const p = tryParse(fenced[1].trim());
    if (p) return p;
  }

  // A JSON object embedded in prose. First balanced {...} only — scanning for
  // the last brace would happily splice two objects together.
  const start = text.indexOf("{");
  if (start !== -1) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) return tryParse(text.slice(start, i + 1));
      }
    }
  }
  return null;
}

function tryParse(s) {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch { return null; }
}

/**
 * Validate one model's verdict.
 *
 * Returns { ok: true, signal } or { ok: false, code, errors[] }. Never throws,
 * never repairs, never fills a missing field with a default that would read as
 * a model's opinion.
 */
export function validateModelSignal(raw, { provider = null, model = null } = {}) {
  const obj = extractJson(raw);
  if (!obj) return fail("unparseable", ["no JSON object found in the response"]);

  const errors = [];

  const action = typeof obj.action === "string" ? obj.action.trim().toUpperCase() : null;
  if (!action) errors.push("action is missing");
  else if (!ACTIONS.includes(action)) errors.push(`action "${action}" is not one of ${ACTIONS.join("|")}`);

  // Confidence is 0–1. A model sending 77 means 77%, but ACTING on that guess
  // is how a weak signal becomes a strong one, so it is rejected instead.
  const confidence = numberOrNull(obj.confidence);
  if (obj.confidence === undefined || obj.confidence === null) errors.push("confidence is missing");
  else if (confidence === null) errors.push("confidence is not a number");
  else if (confidence < 0 || confidence > 1) errors.push(`confidence ${confidence} is outside 0–1 (a model sending 77 for 77% is rejected, not rescaled)`);

  const directional = action && !NON_DIRECTIONAL.includes(action);

  // A directional call must carry its own risk. A model that says BUY without
  // a downside has not finished the thought, and the ensemble cannot weigh it.
  const horizon = numberOrNull(obj.horizon_days);
  const expected = numberOrNull(obj.expected_return_pct);
  const downside = numberOrNull(obj.downside_pct);
  if (directional) {
    if (horizon === null || horizon <= 0) errors.push("horizon_days must be a positive number for a directional call");
    if (expected === null) errors.push("expected_return_pct is required for a directional call");
    if (downside === null) errors.push("downside_pct is required for a directional call");
    else if (downside < 0) errors.push("downside_pct must be stated as a positive magnitude");
  }

  const thesis = stringArray(obj.thesis);
  const bear = stringArray(obj.bear_case);
  // A BUY with no bear case is a model that did not look for one.
  if (directional && bear.length === 0) errors.push("bear_case must not be empty for a directional call");

  if (errors.length) return fail("invalid", errors);

  return {
    ok: true,
    signal: Object.freeze({
      v: SCHEMA_VERSION,
      provider: provider || null,
      model: model || null,
      action,
      confidence,
      directional,
      horizon_days: horizon,
      expected_return_pct: expected,
      downside_pct: downside,
      thesis, bear_case: bear,
      catalysts: stringArray(obj.catalysts),
      invalidation_conditions: stringArray(obj.invalidation_conditions),
      risk_flags: stringArray(obj.risk_flags),
      evidence_ids: stringArray(obj.evidence_ids),
    }),
  };
}

/**
 * Validate a whole committee round.
 *
 * Invalid verdicts are DROPPED, never repaired, and the drop is reported. A
 * round where three of four models failed schema is not a three-model
 * consensus — it is a broken round wearing one, and the caller has to be able
 * to tell the difference.
 */
export function validateRound(responses) {
  const list = Array.isArray(responses) ? responses : [];
  const valid = [], rejected = [];
  for (const r of list) {
    const res = validateModelSignal(r?.raw, { provider: r?.provider, model: r?.model });
    if (res.ok) valid.push(res.signal);
    else rejected.push({ provider: r?.provider ?? null, model: r?.model ?? null, code: res.code, errors: res.errors });
  }
  return {
    valid, rejected,
    total: list.length,
    // The caller decides what "enough" means; this only reports the shape.
    complete: list.length > 0 && rejected.length === 0,
    directional: valid.filter((s) => s.directional).length,
    abstained: valid.filter((s) => !s.directional).length,
  };
}

function fail(code, errors) { return { ok: false, code, errors }; }

function numberOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function stringArray(v) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean).slice(0, 20);
}
