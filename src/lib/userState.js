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

// Synced to Supabase user_state. Cross-device truth for user-generated state.
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

// User-scoped *local caches* — not synced (regenerated on next sync), but
// MUST be wiped when a different user signs in on this browser. Skipping
// these caused the prior user's accounts/holdings/activities to render
// for a new account — a privacy breach.
const USER_SCOPED_CACHE_KEYS = [
  'mizan_accounts_cache',     // SnapTrade /accounts response (holdings)
  'mizan_activities_cache',   // SnapTrade /activities response
  'mizan_documents_cache',    // SnapTrade /documents response
  'mizan_live_cache',         // live price snapshot
  'mizan_has_real_data',      // "has connections" flag (controls demo auto-hide)
  'mizan_demo',               // demo mode toggle (per-user)
  'mizan_auto',               // auto-sync toggle (per-user pref)
];

// Marker we set after a successful hydrate so we can detect when a *different*
// user signs in on the same browser. Without this, the previous user's
// localStorage data leaks into the new account.
const CURRENT_USER_KEY = 'mizan_current_user_id';

// Wipe every user-scoped key. Used on user-change and sign-out so one user's
// data can never be rendered while a different user is authenticated.
// Per-device prefs (theme, ticker-keyed caches like sectors/AAOIFI) are
// intentionally preserved — they're not user-identifying.
export function clearTrackedLocalState() {
  [...TRACKED_KEYS, ...USER_SCOPED_CACHE_KEYS].forEach((k) => {
    try { localStorage.removeItem(k); } catch { /* ignore */ }
  });
  try { localStorage.removeItem(CURRENT_USER_KEY); } catch { /* ignore */ }
}

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
//
// CRITICAL: if the browser previously held a *different* user's data, we MUST
// wipe every tracked key before writing the new user's remote state.
// Otherwise the old user's CSV imports / manual assets / watchlist would
// silently appear in the new user's UI — a privacy breach.
export async function hydrateUserState(userId) {
  if (!userId) return [];
  let previousUserId = null;
  try { previousUserId = localStorage.getItem(CURRENT_USER_KEY); } catch { /* ignore */ }
  if (previousUserId !== userId) {
    clearTrackedLocalState();
  }
  const remote = await fetchUserState(userId);
  Object.entries(remote).forEach(([key, value]) => {
    try {
      // Stringify because every component reads localStorage with JSON.parse(...).
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // localStorage full — give up silently
    }
  });
  try { localStorage.setItem(CURRENT_USER_KEY, userId); } catch { /* ignore */ }
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
