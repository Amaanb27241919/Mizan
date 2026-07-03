// Supabase client — graceful degradation when env vars absent.
// If VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are not set, the app
// runs in single-user pass-through mode (see src/lib/auth.jsx).

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const hasCredentials = Boolean(SUPABASE_URL) && Boolean(SUPABASE_ANON_KEY);

export const isSupabaseConfigured = hasCredentials;

// Persistent session (the SDK default): keep the auth session in localStorage so
// the login survives until the user explicitly signs out.
//   • the session persists across refreshes, new tabs, new windows, and browser
//     restarts — every tab of the profile shares one login
//   • it ends only on an explicit signOut() (or token expiry with no refresh)
// localStorage is per-origin and shared across tabs, which is exactly what makes
// a new tab stay logged in. Private/incognito windows keep their own isolated
// storage, so this never leaks a session into an incognito session.
const authStorage =
  typeof window !== 'undefined' && window.localStorage ? window.localStorage : undefined;

export const supabase = hasCredentials
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: authStorage,
      },
    })
  : null;

export default supabase;
