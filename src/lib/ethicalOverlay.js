/**
 * The ethical / BDS overlay preference, shared across every surface.
 *
 * WHY THIS EXISTS (2026-08-20): the overlay shipped 2026-07-02 as `useState`
 * inside the Screener. That made it a Screener-only feature by construction —
 * `mapPosition` computed `h.bds_` for every holding and nothing could read it,
 * because no other component could see the flag. A user could hold a listed
 * name for months and only ever learn about it by going to the Screener and
 * toggling a switch they had no reason to touch.
 *
 * So the preference now lives here, mirroring useScreenStandard: localStorage
 * plus a window event, so Overview, Holdings and the Screener stay in lockstep
 * without threading props through the whole Portfolio tree.
 *
 * It also actually persists now. The old setter called
 * `persistUserState("mizan_ethical_overlay", …)`, but that function returns
 * early for any key not in TRACKED_KEYS — so the call had never once written
 * anything and the choice was silently per-device. The key is tracked as of
 * this change.
 *
 * The overlay is opt-in and defaults OFF, and that is deliberate: it is an
 * additional ethical filter layered on the Sharia verdict, not a second
 * religious ruling. See lib/sharia.mjs for the list and its attribution rules.
 */
import { useEffect, useState } from "react";
import { persistUserState } from "./userState.js";

export const ETHICAL_OVERLAY_KEY = "mizan_ethical_overlay";
export const ETHICAL_OVERLAY_EVENT = "mizan:ethical-overlay";

export function readEthicalOverlay() {
  try {
    return localStorage.getItem(ETHICAL_OVERLAY_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Shared overlay flag. Returns `{ ethical, setEthical }`.
 *
 * If someone converts this back to component state, the flag will disagree
 * with itself across tabs — which is the exact bug this module was written to
 * kill. Keep the event dispatch: localStorage writes do not fire `storage` in
 * the tab that made them, so without it the other components never re-render.
 */
export function useEthicalOverlay() {
  const [ethical, setEthicalState] = useState(readEthicalOverlay);

  useEffect(() => {
    const sync = () => setEthicalState(readEthicalOverlay());
    window.addEventListener("storage", sync);            // other tabs
    window.addEventListener(ETHICAL_OVERLAY_EVENT, sync); // this one
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(ETHICAL_OVERLAY_EVENT, sync);
    };
  }, []);

  const setEthical = (next) => {
    const v = next ? "1" : "0";
    try {
      localStorage.setItem(ETHICAL_OVERLAY_KEY, v);
    } catch { /* storage unavailable — the choice just won't persist locally */ }
    setEthicalState(!!next);
    persistUserState(ETHICAL_OVERLAY_KEY, v);
    try { window.dispatchEvent(new Event(ETHICAL_OVERLAY_EVENT)); } catch { /* no-op */ }
  };

  return { ethical, setEthical };
}

/**
 * The flag for one holding, honouring the overlay switch.
 *
 * Returns the `ethical` object from the screen verdict when the overlay is ON
 * and the name is listed, otherwise null — so a caller can render a pill with
 * `const bds = ethicalFlag(h, on)` and never has to repeat the two conditions.
 * Display-only: this must never feed a sell prompt or a suitability judgment.
 */
export function ethicalFlag(holding, overlayOn) {
  if (!overlayOn || !holding) return null;
  const e = holding.bds_ || (holding._screen && holding._screen.ethical);
  return e && e.excluded ? e : null;
}
