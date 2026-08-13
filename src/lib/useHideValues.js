import { useEffect, useState } from "react";

/**
 * MĪZAN — privacy mode ("hide values").
 *
 * Extracted from MizanApp.jsx 2026-08-13. It had been defined inside the
 * monolith and therefore unreachable from any extracted component, which is
 * why privacy mode was largely decorative: the hook was called in 3 places
 * while ~19 components rendered dollar amounts. The Goals tab took a `mask`
 * prop that nobody passed, so its default `(v) => v` silently made every
 * mask() call a no-op — goal and debt balances sat in cleartext directly
 * beneath the masked net-worth headline on the same screen.
 *
 * State lives in localStorage and changes broadcast on a window event, so every
 * component that calls this hook stays in lockstep without any prop threading.
 * That is the whole reason it can just be imported rather than passed down.
 *
 * MizanApp imports Goals, so Goals cannot import from MizanApp — hence a shared
 * module rather than an export from the monolith.
 */

export const HIDE_VALUES_KEY = "mizan_hide_values";
export const HIDE_VALUES_EVENT = "mizan-hide-values";

export function readHideValues() {
  try { return localStorage.getItem(HIDE_VALUES_KEY) === "1"; } catch { return false; }
}

/** What a masked value renders as. One constant so every surface hides alike. */
export const MASKED = "••••••";

export function useHideValues() {
  const [hidden, setHidden] = useState(readHideValues);

  useEffect(() => {
    const sync = () => setHidden(readHideValues());
    // `storage` covers other tabs; the custom event covers this one, since
    // localStorage writes don't fire `storage` in the tab that made them.
    window.addEventListener("storage", sync);
    window.addEventListener(HIDE_VALUES_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(HIDE_VALUES_EVENT, sync);
    };
  }, []);

  const toggle = () => {
    try {
      const next = !hidden;
      localStorage.setItem(HIDE_VALUES_KEY, next ? "1" : "0");
      setHidden(next);
      try { window.dispatchEvent(new Event(HIDE_VALUES_EVENT)); } catch { /* no-op */ }
    } catch { /* storage unavailable — privacy mode just won't persist */ }
  };

  return { hidden, toggle, mask: (formatted) => (hidden ? MASKED : formatted) };
}
