/**
 * MĪZAN — compliance policy (the read-only boundary, in code).
 *
 * This module is the single source of truth for WHERE the line sits between
 * what MIZAN may generate and what it may not. It is imported by the market
 * data routes (which are IMPERSONAL) and by the advisor filter (which blocks
 * PROHIBITED output). See docs/COMPLIANCE.md for the full rationale.
 *
 * ⚠️ This is an ENGINEERING guardrail, not legal advice. It encodes a
 * conservative reading of the line between impersonal information / account
 * servicing and personalized investment advice, pending formal legal review
 * and any required RIA registration.
 *
 * Every piece of output belongs to exactly one tier:
 *
 *   IMPERSONAL        — identical for all users. Market data, charts, halal
 *                       screening verdicts, educational content, general
 *                       company facts. A pure function of the request, never
 *                       of who is asking.
 *   ACCOUNT_SERVICING — displays the USER'S OWN factual data (their holdings,
 *                       cost basis, transactions, zakat on their assets).
 *                       Allowed as display only — a statement of fact, never a
 *                       judgment about it.
 *   PROHIBITED        — tailored to the individual as advice: buy/sell/hold
 *                       recommendations, suitability assessments, security
 *                       rankings "for your goals", personalized target/entry/
 *                       exit prices, "given your portfolio, do X", tailored
 *                       model portfolios.
 *
 * Rule the code enforces: you may DISPLAY the user's own data and you may
 * state IMPERSONAL facts, but you must never GENERATE a tailored
 * recommendation or suitability judgment. Halal screening is IMPERSONAL — the
 * same religious/factual classification for everyone — and is allowed.
 */

/** @typedef {'impersonal'|'account_servicing'|'prohibited'} DataTier */

export const DATA_TIERS = Object.freeze({
  IMPERSONAL: "impersonal",
  ACCOUNT_SERVICING: "account_servicing",
  PROHIBITED: "prohibited",
});

// One-line policy string suitable for embedding in prompts / docs / logs.
export const COMPLIANCE_POLICY =
  "MIZAN may show a user their own account data (account servicing) and state " +
  "impersonal facts — market data, charts, halal screening, education — but must " +
  "never generate a personalized buy/sell/hold recommendation, suitability " +
  "judgment, security ranking for the user, or tailored target price. The " +
  "investment decision is the user's; personalized advice requires a licensed adviser.";

// The redirect the advisor gives (and the filter rewrites to) whenever a
// personalized recommendation is requested or slips into a draft answer.
// Deliberately worded so it contains NONE of the prohibited patterns below —
// re-scanning it must return zero matches.
export const COMPLIANCE_REDIRECT =
  "I can explain the halal status and walk through the data with you — but I can't " +
  "tell you what to do with your money. The investment decision is yours, and for " +
  "advice tailored to your situation you'd want a licensed financial adviser (and, " +
  "for the fiqh, a qualified scholar).";

// ── Prohibited-output patterns ──────────────────────────────────────────────
// Regexes that flag PERSONALIZED investment advice in generated text. Tuned to
// catch imperative recommendations, suitability framing, security rankings, and
// tailored price levels while leaving impersonal facts, education, halal
// verdicts, and account-servicing statements alone. No `g` flag (stateful
// lastIndex) — these are used only with .test()/.match() one at a time.
//
// Investment-action verbs. Note "donate"/"give"/"purify" are intentionally
// absent so zakat & purification guidance (a religious obligation, impersonal)
// is never flagged.
const ACTION =
  "buy|sell|hold|short|add|trim|dump|purchase|acquire|offload|liquidate|divest|" +
  "invest in|allocate|rebalance|reduce (?:your )?position|increase (?:your )?position|double down";
const ACTION_ING =
  "buying|selling|holding|shorting|adding|trimming|purchasing|divesting|allocating|rebalancing";

export const PROHIBITED_PATTERNS = Object.freeze([
  {
    name: "imperative-recommendation",
    // "you should buy", "you ought to sell", "you might want to add"
    re: new RegExp(`\\byou (?:should|ought to|need to|must|had better|could|might want to|may want to|want to)\\s+(?:${ACTION})\\b`, "i"),
  },
  {
    name: "i-recommend-action",
    // "I recommend you buy", "I'd suggest selling", "I would advise adding"
    re: new RegExp(`\\bI(?:'d| would)?\\s*(?:recommend|suggest|advise)\\b[^.?!\\n]{0,60}\\b(?:${ACTION}|${ACTION_ING})\\b`, "i"),
  },
  {
    name: "recommend-gerund",
    // "recommend buying", "suggest selling", "advise holding"
    re: new RegExp(`\\b(?:recommend|suggest|advise)\\s+(?:${ACTION_ING})\\b`, "i"),
  },
  {
    name: "act-on-your-position",
    // "sell your NVDA", "trim your position", "dump your holdings"
    re: /\b(?:sell|buy|dump|offload|trim|liquidate|divest)\s+your\b/i,
  },
  {
    name: "best-for-you",
    // "the best stock for you", "a good buy for your portfolio"
    re: /\b(?:a good|the best|a smart|a solid|a great|a strong)\s+(?:buy|sell|investment|stock|pick|option|time to (?:buy|sell))\b[^.?!\n]{0,40}\bfor (?:you|your)\b/i,
  },
  {
    name: "suitability-framing",
    // "given your portfolio, sell...", "based on your goals, I recommend..."
    re: /\b(?:given|based on|considering|for)\s+your\s+(?:portfolio|holdings|goals?|situation|risk(?:\s+tolerance)?|allocation)\b[^.?!\n]{0,60}\b(?:buy|sell|hold|add|trim|allocate|rebalance|recommend|should|shift|move)\b/i,
  },
  {
    name: "security-ranking-for-you",
    // "ranked for your goals", "the top picks for you"
    re: /\b(?:rank(?:ed|ing)?|top (?:picks?|choices?)|best options?)\b[^.?!\n]{0,40}\bfor (?:you|your)\b/i,
  },
  {
    name: "tailored-price-target",
    // "price target of $200", "set a stop-loss at 150", "take profit at"
    re: /\b(?:price target|target price|entry point|exit point|stop[- ]?loss|take[- ]?profit|set (?:a|your) (?:stop|target|limit))\b/i,
  },
  {
    name: "act-at-price-level",
    // "buy below $150", "sell around 42", "enter at $10"
    re: /\b(?:buy|sell|enter|exit|accumulate|scale in)\s+(?:at|below|above|around|under|near)\s+\$?\d/i,
  },
]);

/**
 * Dev-time marker asserting that a code path is contractually IMPERSONAL: its
 * output must be a pure function of the request params, never of user identity.
 * A documentation + fail-loud-in-dev aid; a no-op in production so it can sit on
 * hot paths without cost.
 *
 * @param {string} description what impersonal path this guards (for the error)
 */
export function assertImpersonal(description) {
  if (process.env.NODE_ENV === "production") return;
  if (typeof description !== "string" || description.length === 0) {
    throw new Error("assertImpersonal requires a non-empty description of the impersonal path");
  }
}
