// apiFetch — drop-in replacement for fetch() that attaches the current
// Supabase access token as an Authorization header so the server can
// resolve the per-user identity.
//
// In single-user pass-through mode (no Supabase env), this is a no-op
// and the server falls back to the shared mizan_primary record.

import { supabase, isSupabaseConfigured } from "./supabase";
import { isDemoMode } from "./userState";

// Demo mode is a closed system. Every figure it shows comes from the fixtures
// in MizanApp.jsx, and the demo is run at conferences on wifi that fails — a
// call issued here and then rejected is a spinner, a retry, or a blank panel
// on stage. So in demo mode nothing is issued at all.
//
// This is a BACKSTOP, not the mechanism: each surface still feeds itself from
// its own fixture (useLiveNisab, DEMO_PURIFICATION_ITEMS, DEMO_ACCOUNTS). What
// it buys is that a call site added later cannot quietly reintroduce a network
// dependency the demo can't satisfy — an audit on 2026-08-30 found sixteen of
// them, including the nisab feed that renders the demo's closing number.
//
// It also stops demo activity writing to the signed-in user's real account,
// which is the inverse of the leak CLAUDE.md §13 warns about.
/** An inert 200 so callers take their empty-data branch, never their error one. */
function inertResponse() {
  return new Response("{}", {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function apiFetch(input, init = {}) {
  if (isDemoMode()) return inertResponse();
  const headers = new Headers(init.headers || {});
  if (isSupabaseConfigured && supabase) {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      if (token) headers.set("Authorization", `Bearer ${token}`);
    } catch {
      // session unreadable — proceed unauthenticated
    }
  }
  return fetch(input, { ...init, headers });
}

// Fire-and-forget client-side audit. Server uses the JWT to derive user_id —
// callers can't forge it. Safe to call without awaiting.
export function recordAudit(action, { target, metadata } = {}) {
  try {
    apiFetch("/api/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, target, metadata }),
    }).catch(() => { /* swallow — audit is best-effort */ });
  } catch { /* swallow */ }
}
