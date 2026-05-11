// Per-user state sync between localStorage and Supabase user_state table.
//
// Pattern:
// - localStorage is the source of truth at runtime (fast, synchronous reads)
// - Supabase is the cross-device backup (slow, async)
// - hydrateUserState(userId) pulls Postgres → localStorage on sign-in
// - persistUserState(key, value) writes localStorage → Postgres on every change
//
// Tracked keys carry user-specific data that must survive a device switch.
// Per-device-only keys (theme, demo toggle, sector cache) stay local.

import { supabase, isSupabaseConfigured } from './supabase';

export const TRACKED_KEYS = [
  'mizan_imports',                    // CSV-imported activity rows
  'mizan_watchlist',                  // watchlist + price alerts
  'mizan_manual_assets',              // gold, real estate, business equity
  'mizan_disabled_accts',             // per-account on/off toggle
  'mizan_networth_history',           // daily net-worth snapshots
  'mizan_screening_baseline',         // Sharia alert baseline
  'mizan_seen_dividends',             // notified dividend IDs
  'mizan_seen_dividends_initialized', // first-run flag for dividend alerts
  'mizan_brokers',                    // broker connection display state
  'mizan_keys',                       // user-entered API keys
];

// Best-effort fetch of all user_state rows. Returns a map { key → parsed value }.
export async function fetchUserState(userId) {
  if (!isSupabaseConfigured || !supabase || !userId) return {};
  try {
    const { data, error } = await supabase
      .from('user_state')
      .select('key, value')
      .eq('user_id', userId);
    if (error || !Array.isArray(data)) return {};
    const out = {};
    data.forEach((row) => {
      if (TRACKED_KEYS.includes(row.key)) out[row.key] = row.value;
    });
    return out;
  } catch {
    return {};
  }
}

// Write Postgres → localStorage. Run once after sign-in BEFORE the rest of the
// app initializes (so component state hydrates from the correct local cache).
export async function hydrateUserState(userId) {
  const remote = await fetchUserState(userId);
  Object.entries(remote).forEach(([key, value]) => {
    try {
      // Stringify because every component reads localStorage with JSON.parse(...).
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // localStorage full — give up silently
    }
  });
  return Object.keys(remote);
}

// Write localStorage → Postgres. Fire-and-forget on every tracked-key update.
// Accepts either a JSON string (mirroring localStorage usage) or a raw value.
export async function persistUserState(key, value) {
  if (!TRACKED_KEYS.includes(key)) return;
  if (!isSupabaseConfigured || !supabase) return;
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData?.session?.user?.id;
    if (!userId) return;
    // Normalize: if caller passed a JSON string, parse it. If a raw object/array,
    // use as-is. Supabase's jsonb column accepts native JS values directly.
    let parsed = value;
    if (typeof value === 'string') {
      try { parsed = JSON.parse(value); } catch { parsed = value; }
    }
    await supabase.from('user_state').upsert(
      { user_id: userId, key, value: parsed, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,key' },
    );
  } catch {
    // Network down, RLS denial, etc. — localStorage still has the truth.
  }
}

// Convenience wrapper: localStorage.setItem + persistUserState in one call.
// Use this in place of localStorage.setItem for any tracked key.
export function setLocalAndSync(key, value) {
  try {
    const s = typeof value === 'string' ? value : JSON.stringify(value);
    localStorage.setItem(key, s);
  } catch {
    // localStorage write failed — skip persistence too
    return;
  }
  // Fire and forget — caller doesn't await
  persistUserState(key, value);
}
