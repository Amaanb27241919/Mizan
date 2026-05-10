// Supabase client — graceful degradation when env vars absent.
// If VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are not set, the app
// runs in single-user pass-through mode (see src/lib/auth.jsx).

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const hasCredentials = Boolean(SUPABASE_URL) && Boolean(SUPABASE_ANON_KEY);

export const isSupabaseConfigured = hasCredentials;

export const supabase = hasCredentials
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export default supabase;
