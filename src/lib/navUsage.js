/**
 * Which parts of Mizan actually get used.
 *
 * Owner-requested 2026-08-18 to answer "are there too many tabs?" with evidence
 * — the app has 6 top-level tabs, 21 destinations and one depth-3 branch, and
 * nothing knew which of them anyone opens.
 *
 * WHAT THIS DELIBERATELY IS NOT: an analytics SDK, a session recorder, or an
 * event stream. It calls one RPC that increments a counter. There is no
 * timeline, so it cannot reconstruct when someone used the app or in what
 * order; the only payload that ever leaves the browser is a nav path string
 * like "portfolio/tools/backtest". No balances, tickers, categories or amounts
 * — nothing financial can reach it, because nothing financial is passed to it.
 *
 * CLAUDE.md §8 forbids adding tracking without an explicit owner instruction.
 * This exists under that instruction; anything beyond counting destinations
 * needs a fresh one.
 */
import { apiFetch } from "./apiFetch.js";

// Don't re-count the same destination while a user reads it. Someone leaving
// the Zakat tab open should read as one visit, not a metronome — and flipping
// between two tabs to compare numbers is one look at each, not twenty.
const THROTTLE_MS = 60_000;
const lastSent = new Map();

/** Nav path → is it one of ours? Guards against logging junk or user text. */
const SAFE_PATH = /^[a-z0-9]+(?:\/[a-z0-9 /-]+)*$/i;

/**
 * Record a view. Fire-and-forget by design: this must never block navigation,
 * never surface an error, and never retry. If it fails, the honest outcome is
 * a slightly low count — which is strictly better than a UI that stutters
 * because a metrics call is slow.
 */
export function recordNavView(path) {
  try {
    // Type-check BEFORE stringifying. String(null) is "null" and String(42) is
    // "42" — both sail through the path regex and would land as real rows.
    // (Caught by the junk-input test, not by reading the code.)
    if (typeof path !== "string") return;
    const p = path.trim().toLowerCase();
    if (!p || p.length > 96 || !SAFE_PATH.test(p)) return;

    const now = Date.now();
    const prev = lastSent.get(p) || 0;
    if (now - prev < THROTTLE_MS) return;
    lastSent.set(p, now);

    // No await, and the rejection is swallowed: a metrics failure is not a
    // user-visible event.
    apiFetch("/api/nav-usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: p }),
    }).catch(() => {});
  } catch {
    /* never let instrumentation break navigation */
  }
}

/** Test seam — lets a spec assert the throttle without waiting a minute. */
export function _resetNavUsageThrottle() {
  lastSent.clear();
}
