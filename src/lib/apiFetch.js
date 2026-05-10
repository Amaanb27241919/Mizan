// apiFetch — drop-in replacement for fetch() that attaches the current
// Supabase access token as an Authorization header so the server can
// resolve the per-user identity.
//
// In single-user pass-through mode (no Supabase env), this is a no-op
// and the server falls back to the shared mizan_primary record.

import { supabase, isSupabaseConfigured } from "./supabase";

export async function apiFetch(input, init = {}) {
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
