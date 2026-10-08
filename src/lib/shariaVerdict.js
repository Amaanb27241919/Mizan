/**
 * The verdict for a holding under ONE screening standard — pure, no React, no
 * storage. Split out of shariaStatus.js (2026-10-07) so the server can use the
 * exact same rule: every trading strategy screens against AAOIFI with it, and
 * a second server-side definition of "halal under AAOIFI" would eventually
 * disagree with what the app shows. Like netWorth.js, this is imported by
 * lib/handlers.mjs.
 */
export const DEFAULT_STANDARD = "AAOIFI";

/**
 * The verdict for one holding under one standard.
 *
 * Returns "halal" | "haram" | "review" | "unknown".
 *
 * Deliberate rules, each one load-bearing:
 *  - `pass === true`  -> halal, `pass === false` -> haram. Straightforward.
 *  - `pass == null` (the standard was not evaluated — crypto has no balance
 *    sheet to run ratios against) -> **review, never halal**. Flag it, never
 *    bless it. This is the same rule that fixed crypto being auto-blessed in
 *    2026-08-10; do not "improve" it into a pass.
 *  - A prohibited SECTOR outranks every ratio. The server already marks all
 *    standards failed in that case, but a verdict whose top-level status is
 *    "haram" is honoured directly so a data gap in `byStandard` can never
 *    launder an alcohol or conventional-finance name into "review".
 *  - No verdict at all -> "unknown", so callers can tell "not screened yet"
 *    apart from "screened and inconclusive".
 */
export function statusForStandard(verdict, standard = DEFAULT_STANDARD) {
  if (!verdict) return "unknown";

  // Sector prohibition is categorical — never re-derive it from ratios.
  if (verdict.status === "haram" && verdict.reason) return "haram";

  const bs = verdict.byStandard && verdict.byStandard[standard];
  if (bs) {
    if (bs.pass === true) return "halal";
    if (bs.pass === false) return "haram";
    return "review";            // evaluated but inconclusive, or not evaluated
  }

  // The chosen standard is missing from the payload (older cached verdict, or a
  // provider like Zoya that only returns AAOIFI). Fall back to the server's own
  // status rather than inventing one — but never upgrade an unknown to a pass.
  const s = verdict.status;
  return s === "halal" || s === "haram" || s === "review" ? s : "unknown";
}

/** Same, but for a whole `{ [ticker]: verdict }` map. */
export function statusMapForStandard(results = {}, standard = DEFAULT_STANDARD) {
  const out = {};
  for (const [tk, v] of Object.entries(results)) out[tk] = statusForStandard(v, standard);
  return out;
}

/**
 * Stamped on every verdict the server produces. Bump it whenever a change
 * makes verdicts computed by older code untrustworthy: clients and the shared
 * cache treat an entry with a different stamp as stale and re-screen it.
 * v2 (2026-10-07): before it, a Finnhub 429 degraded a verdict to "review"
 * (or a blank standard) that LOOKED settled and was cached for the day.
 */
export const SCREEN_ENGINE_VERSION = 2;

/** A verdict that came from a completed screen (not a throttle, outage or "pending"). */
export function isSettledVerdict(v) {
  return Boolean(v && typeof v === "object" && v.status && v.status !== "unknown");
}

/**
 * Merge freshly fetched verdicts into the cache. A failed or pending screen
 * never overwrites a good verdict — `{...cache, ...incoming}` did exactly that,
 * so one throttled request blanked holdings the cache had already screened.
 */
export function mergeVerdicts(prev, incoming) {
  const base = prev && typeof prev === "object" ? prev : {};
  const out = { ...base };
  if (!incoming || typeof incoming !== "object") return out;
  for (const [tk, v] of Object.entries(incoming)) {
    if (isSettledVerdict(v) || !isSettledVerdict(base[tk])) out[tk] = v;
  }
  return out;
}

/** Symbols whose cached verdict is missing, unsettled, or not from `today`. */
export function symbolsToScreen(symbols, cache, today) {
  const c = cache && typeof cache === "object" ? cache : {};
  const list = Array.isArray(symbols) ? symbols : [];
  return [...new Set(list.map((s) => String(s || "").toUpperCase()).filter(Boolean))]
    .filter((tk) => !isSettledVerdict(c[tk]) || c[tk].asOf !== today || c[tk].engine !== SCREEN_ENGINE_VERSION);
}
