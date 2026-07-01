// Supabase client — graceful degradation when env vars absent.
// If VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are not set, the app
// runs in single-user pass-through mode (see src/lib/auth.jsx).

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const hasCredentials = Boolean(SUPABASE_URL) && Boolean(SUPABASE_ANON_KEY);

export const isSupabaseConfigured = hasCredentials;

// Per-tab session: keep the auth session in sessionStorage instead of the SDK
// default (localStorage). This scopes the login to a single browser tab —
//   • opening the app in a NEW tab or window starts LOGGED OUT
//   • the same tab stays logged in across refreshes (sessionStorage survives reload)
//   • closing the tab (or the browser) ends the session
// localStorage is shared across every tab of a browser profile, which is why a
// new tab used to inherit the session. sessionStorage is not shared, so it can't.
// (Private/incognito windows were already storage-isolated; the only way one ever
// inherited a session is via auth tokens in a URL — see the one-time purge below.)
// Falls back to the SDK default only if sessionStorage is unavailable (SSR/prerender),
// which never happens in the live SPA.
const tabStorage =
  typeof window !== 'undefined' && window.sessionStorage ? window.sessionStorage : undefined;

// One-time migration: purge any pre-existing session left in localStorage by the
// old (cross-tab) config so a stale shared token can't linger. Harmless and
// idempotent — once cleared there's nothing to remove on subsequent loads.
if (typeof window !== 'undefined' && window.localStorage) {
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const k = window.localStorage.key(i);
      if (k && /^sb-.*-auth-token$/.test(k)) window.localStorage.removeItem(k);
    }
  } catch { /* private-mode / disabled storage — nothing to purge */ }
}

export const supabase = hasCredentials
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: tabStorage,
      },
    })
  : null;

export default supabase;
