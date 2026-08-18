/**
 * The screening standard a user has chosen, and the verdict that follows from it.
 *
 * WHY THIS EXISTS (2026-08-18, user-reported): the Screener offered a standard
 * picker — AAOIFI, Dow Jones Islamic, S&P Shariah, … — and the copy promised it
 * set "row badges". It didn't. The server returns a `status` computed as a
 * CROSS-STANDARD VOTE (`lib/sharia.mjs`: halal if >= 5 of 7 frameworks pass,
 * haram if >= 4 fail), and every compliance surface in the app read that single
 * vote. Switching standard changed one checkmark column and nothing else — not
 * the badges, not the filter counts, not Overview's COMPLIANCE %.
 *
 * That is wrong on its own terms. Standards genuinely disagree — AAOIFI caps
 * receivables at 49% where Dow Jones caps them at 33% — and a user who picks the
 * stricter madhhab-aligned framework is asking to be judged by it. A vote across
 * seven of them is nobody's methodology.
 *
 * So the verdict is now a function of (server data, chosen standard). The server
 * stays the single source of truth for the FACTS — ratios, per-standard pass/fail
 * — and this module turns those facts into the one verdict every surface shows.
 * See CLAUDE.md §4.
 */
import { useEffect, useState } from "react";

export const SCREEN_STANDARD_KEY = "mizan_screen_standard";
export const SCREEN_STANDARD_EVENT = "mizan:screen-standard";
export const DEFAULT_STANDARD = "AAOIFI";

export function readScreenStandard() {
  try {
    return localStorage.getItem(SCREEN_STANDARD_KEY) || DEFAULT_STANDARD;
  } catch {
    return DEFAULT_STANDARD;
  }
}

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
 * Shared chosen-standard flag. Mirrors useHideValues: localStorage plus a window
 * event, so the Screener's picker and the root's mapPosition stay in lockstep
 * without threading props through the whole Portfolio tree. If someone converts
 * this to component state, surfaces will disagree about the same holding —
 * which is the exact bug this module was written to kill.
 */
export function useScreenStandard() {
  const [standard, setStandardState] = useState(readScreenStandard);

  useEffect(() => {
    const sync = () => setStandardState(readScreenStandard());
    // `storage` covers other tabs; the custom event covers this one, since
    // localStorage writes don't fire `storage` in the tab that made them.
    window.addEventListener("storage", sync);
    window.addEventListener(SCREEN_STANDARD_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(SCREEN_STANDARD_EVENT, sync);
    };
  }, []);

  const setStandard = (next) => {
    try {
      localStorage.setItem(SCREEN_STANDARD_KEY, next);
    } catch { /* storage unavailable — the choice just won't persist */ }
    setStandardState(next);
    try { window.dispatchEvent(new Event(SCREEN_STANDARD_EVENT)); } catch { /* no-op */ }
  };

  return { standard, setStandard };
}
