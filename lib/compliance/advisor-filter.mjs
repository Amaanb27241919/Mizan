/**
 * MĪZAN — advisor output filter (defense in depth).
 *
 * The hardened system prompt (advisor-prompt.mjs) is the primary guardrail;
 * this is the belt-and-suspenders backstop that scans GENERATED text for
 * personalized-recommendation patterns and, on a hit, rewrites the answer to
 * the compliant redirect. Pure + deterministic (a regex pass over the text) so
 * it is unit-testable and adds no latency — see PROHIBITED_PATTERNS in policy.mjs.
 *
 * Design choices:
 *  - Fail toward compliance: on a match we REPLACE the answer rather than trying
 *    to surgically edit it. A false positive costs one over-cautious answer; a
 *    false negative would ship advice we mustn't give.
 *  - Skip the model's own refusals: a match sitting inside a negated/refusal
 *    clause ("I can't tell you to sell your X") is not a recommendation.
 *  - Every flag is returned so the caller can log it for human review + tuning.
 *
 * An optional secondary cheap-model check is intentionally NOT wired by default:
 * it adds latency, cost, and a non-deterministic path. The hook is documented at
 * the bottom for when tuning data justifies it.
 */
import { PROHIBITED_PATTERNS, COMPLIANCE_REDIRECT } from "./policy.mjs";

// Negation/refusal cues that, when they appear anywhere earlier in the SAME
// sentence as a match, mean the model is declining or negating — not
// recommending ("I can't tell you whether to buy or sell your X"). Sentence-
// scoped (not a fixed char window) so a refusal lead-in early in the sentence
// still shields a match near its end.
const NEGATION_CUE =
  /\b(?:can(?:'|no)?t|cannot|won'?t|would ?n'?t|do(?:es)?n'?t|did ?n'?t|never|not|unable to|neither|avoid|refuse|whether to|instead of|rather than)\b/i;

// Start index of the sentence containing position `idx`.
function sentenceStart(s, idx) {
  let start = 0;
  for (const ch of [".", "!", "?", "\n"]) {
    const p = s.lastIndexOf(ch, idx - 1);
    if (p + 1 > start) start = p + 1;
  }
  return start;
}

/**
 * Scan text for personalized-recommendation patterns. Returns the list of
 * matches (empty ⇒ clean). Each match: { name, snippet }.
 * @param {string} text
 */
export function scanForProhibited(text) {
  const s = String(text || "");
  const matched = [];
  for (const { name, re } of PROHIBITED_PATTERNS) {
    const m = s.match(re);
    if (!m || m.index == null) continue;
    const before = s.slice(sentenceStart(s, m.index), m.index);
    if (NEGATION_CUE.test(before)) continue; // model is refusing/negating within this sentence
    matched.push({ name, snippet: m[0] });
  }
  return matched;
}

/**
 * Filter a single text answer. Returns { flagged, matched, text } where `text`
 * is the compliant redirect when flagged, else the original unchanged.
 * @param {string} text
 */
export function filterAdvisorText(text) {
  const matched = scanForProhibited(text);
  if (matched.length === 0) return { flagged: false, matched: [], text };
  return { flagged: true, matched, text: COMPLIANCE_REDIRECT };
}

/**
 * Filter an Anthropic Messages API response body in place-safely (immutably).
 * Only text blocks carry advice; tool_use blocks (e.g. web_search) pass through
 * untouched. On a flag, the text blocks collapse to a single compliant redirect.
 * Returns { body, flagged, matched } — `body` is a new object when rewritten.
 *
 * @param {{content?: Array<{type:string, text?:string}>}} body
 */
export function filterAdvisorResponse(body) {
  if (!body || typeof body !== "object" || !Array.isArray(body.content)) {
    return { body, flagged: false, matched: [] };
  }
  const combined = body.content
    .filter(b => b?.type === "text" && typeof b.text === "string")
    .map(b => b.text)
    .join("\n");
  if (!combined) return { body, flagged: false, matched: [] };

  const { flagged, matched } = filterAdvisorText(combined);
  if (!flagged) return { body, flagged: false, matched: [] };

  let replaced = false;
  const content = [];
  for (const b of body.content) {
    if (b?.type === "text") {
      if (!replaced) { content.push({ ...b, text: COMPLIANCE_REDIRECT }); replaced = true; }
      // drop any additional text blocks — the single redirect stands in
    } else {
      content.push(b); // preserve tool_use / other blocks
    }
  }
  return { body: { ...body, content }, flagged: true, matched };
}

// ── Optional secondary check (disabled) ─────────────────────────────────────
// If regex tuning proves insufficient, a cheap-model pass can run only on
// borderline answers (e.g. those mentioning a ticker + an action verb but not
// caught above). Kept off by default: it adds latency, cost, and a
// non-deterministic path. Shape when enabled:
//   export async function secondaryCheck(text, callModel) {
//     const verdict = await callModel(`Does this contain personalized buy/sell/
//       hold advice or a suitability judgment? Answer yes/no:\n\n${text}`);
//     return /^\s*yes/i.test(verdict);
//   }
