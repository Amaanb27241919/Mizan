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
  'mizan_debts',                      // debt-payoff tracker (manual + linked-account)
  'mizan_disabled_accts',             // per-account on/off toggle
  'mizan_networth_history',           // daily net-worth snapshots
  'mizan_notifications',              // in-app notification feed (read state included)
  'mizan_screening_baseline',         // Sharia alert baseline
  'mizan_seen_dividends',             // notified dividend IDs
  'mizan_seen_dividends_initialized', // first-run flag for dividend alerts
  'mizan_brokers',                    // broker connection display state
  'mizan_keys',                       // user-entered API keys
  'mizan_sadaqah',                    // user-entered donation history
  'mizan_user_docs',                  // user-uploaded files (csv/pdf/docx)
  'mizan_sadaqah_seeded',             // one-time owner backfill marker
  'mizan_onboarded',                  // "1" once the user finishes the 5-step tour
  'mizan_rebalance_targets',          // target allocation % per asset class
  'mizan_purification_log',           // { [fingerprint]: { purified_at, amount, ticker, dividend_amount, purification_owed } }
  'mizan_purification_overrides',     // { [ticker]: impurityPct } — user-set ratio overrides
  'mizan_zakat_worksheet',            // comprehensive Zakat worksheet (cash, metals, retirement, business, receivables, debts)
  'mizan_name_prompt_skips',          // times the "add your name" nudge was skipped — synced so the 3 skips are per-user, not per-device
  'mizan_tour_seen',                  // "1" once the first-login guided-tour offer has been seen/dismissed — synced so the offer shows once per user, not per device
  'mizan_subscription_overrides',     // { [normalizedMerchant]: { name?, estMonthly?, active? } } — user edits to DERIVED recurring subscriptions (detection is re-run every load, so edits live here, keyed by the ORIGINAL merchant)
  'mizan_ethical_overlay',            // "1" when the ethical/BDS overlay is on. Added 2026-08-20: the setter had always called persistUserState for this key, but an untracked key returns early, so the choice was silently per-device for the overlay's whole life
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
  'mizan_plaid_accounts',     // Plaid /accounts response (institutions + balances)
  'mizan_bank_balance',       // derived Plaid net (depository − credit/loan)
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

/**
 * Read-merge-write for a tracked key, instead of blindly overwriting it.
 *
 * persistUserState() upserts the WHOLE value, so last writer wins. For an
 * append-only key like net-worth history that is a data-loss bug: on
 * 2026-07-30 the nightly cron merged a user's history at 19:22 and a browser
 * tab that had been open since before then wrote its stale in-memory array
 * back over it at 20:07, discarding two months of backfilled points. The tab
 * wasn't wrong — it just hadn't re-hydrated since sign-in.
 *
 * So: re-read the row, let the caller merge its own contribution into whatever
 * is actually stored, then write. `mergeFn(remoteValue)` must be pure and
 * idempotent — two tabs can race here, and the loser's write must still be
 * correct. Falls back to merging against `localFallback` when the read fails
 * (offline, RLS), so a snapshot is never silently dropped.
 *
 * Returns the merged value that was written (or the local fallback).
 */
export async function persistMergedUserState(key, mergeFn, localFallback = null) {
  const applyLocal = () => {
    const merged = mergeFn(localFallback);
    try { localStorage.setItem(key, JSON.stringify(merged)); } catch { /* quota */ }
    return merged;
  };
  if (!TRACKED_KEYS.includes(key) || !isSupabaseConfigured || !supabase) return applyLocal();

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData?.session?.user?.id;
    if (!userId) return applyLocal();

    const { data, error } = await supabase
      .from('user_state').select('value')
      .eq('user_id', userId).eq('key', key).maybeSingle();
    // A read error means we don't know what's stored. Merging into the local
    // copy and writing would risk clobbering exactly what this exists to
    // protect, so keep it local-only and let the next attempt reconcile.
    if (error) return applyLocal();

    const merged = mergeFn(data?.value ?? localFallback);
    try { localStorage.setItem(key, JSON.stringify(merged)); } catch { /* quota */ }
    await supabase.from('user_state').upsert(
      { user_id: userId, key, value: merged, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,key' },
    );
    return merged;
  } catch {
    return applyLocal();
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
