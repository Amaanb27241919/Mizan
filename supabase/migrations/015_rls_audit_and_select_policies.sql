-- 015_rls_audit_and_select_policies.sql
--
-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  RLS AUDIT — SELECT policies on every user-scoped table               ║
-- ╚═══════════════════════════════════════════════════════════════════════╝
--
-- Pre-launch audit context
-- ------------------------
-- Every table in the public schema was surveyed (migrations 001-014). Each
-- was classified as:
--
--   (A) user-scoped, already has a select_own policy
--   (B) user-scoped, MISSING a select_own policy
--   (C) intentionally service-role only (sensitive secrets that must never
--       reach the browser, even to the row's owner)
--   (D) shared / non-user-scoped (no user_id column — market-data caches,
--       cron job ledgers, etc.)
--
-- The original concern was that audit_log might be in bucket (B) and accidentally
-- surface cross-user activity if a future admin feature queried it via the
-- anon key. The audit confirms audit_log is in bucket (A) (migration 001
-- already creates "audit_log_select_own"), so this migration's job is to:
--
--   1. Re-emit every existing select_own policy idempotently. Re-running this
--      migration is safe — every CREATE POLICY is preceded by DROP POLICY
--      IF EXISTS, so the policies converge to the same final state.
--   2. Be the canonical place where someone reading the migrations folder
--      can confirm "yes, every user-scoped public table has explicit RLS
--      SELECT scoping" without piecing it together from 14 separate files.
--   3. Document every (C) and (D) table inline so a future reviewer
--      doesn't "fix" a deliberate gap by adding a select_own that would
--      leak a secret (looking at you, plaid_tokens.access_token).
--
-- Table-by-table classification
-- -----------------------------
--   audit_log              (A) select_own exists           — 001
--   user_snaptrade         (A) full CRUD policies          — 002
--   user_state             (A) full CRUD policies          — 002
--   user_keys              (A) full CRUD policies          — 002
--   plaid_tokens           (C) service-role only           — 003   ⚠ holds access_token
--   plaid_accounts         (A) select_own exists           — 003
--   rate_limits            (C) service-role only           — 004   atomic counter integrity
--   profiles               (A) select_own (auth.uid()=id)  — 005   PK is id, not user_id
--   sessions (auth.*)      (D) not a public.* table        — 006   RPC bridge only
--   cron_jobs              (D) shared scheduler ledger     — 007
--   push_subscriptions     (A) select_own exists           — 008
--   polygon_cache          (D) shared market-data cache    — 009
--   plaid_transactions     (A) select_own exists           — 010
--   account_nicknames      (A) full CRUD policies          — 012
--   budgets                (A) full CRUD policies          — 013
--   goals                  (A) full CRUD policies          — 014
--
-- Net result: no (B) tables found. Every user-scoped public table has an
-- explicit SELECT policy scoping reads to auth.uid() = user_id (or = id
-- for profiles, where the PK IS the user_id).

-- ════════════════════════════════════════════════════════════════════════
--   (A) Re-emit every existing select_own policy idempotently
-- ════════════════════════════════════════════════════════════════════════

-- 001  audit_log — append-only sensitive-action log
DROP POLICY IF EXISTS "audit_log_select_own" ON public.audit_log;
CREATE POLICY "audit_log_select_own" ON public.audit_log
  FOR SELECT USING (auth.uid() = user_id);

-- 002  user_snaptrade — per-user SnapTrade identifiers
DROP POLICY IF EXISTS "user_snaptrade_select_own" ON public.user_snaptrade;
CREATE POLICY "user_snaptrade_select_own" ON public.user_snaptrade
  FOR SELECT USING (auth.uid() = user_id);

-- 002  user_state — generic per-user key/value store
DROP POLICY IF EXISTS "user_state_select_own" ON public.user_state;
CREATE POLICY "user_state_select_own" ON public.user_state
  FOR SELECT USING (auth.uid() = user_id);

-- 002  user_keys — per-user 3rd-party API keys
DROP POLICY IF EXISTS "user_keys_select_own" ON public.user_keys;
CREATE POLICY "user_keys_select_own" ON public.user_keys
  FOR SELECT USING (auth.uid() = user_id);

-- 003  plaid_accounts — flat account list per Plaid Item
DROP POLICY IF EXISTS "plaid_accounts_select_own" ON public.plaid_accounts;
CREATE POLICY "plaid_accounts_select_own" ON public.plaid_accounts
  FOR SELECT USING (auth.uid() = user_id);

-- 005  profiles — per-user role + suspension state.
--      NOTE: PK column is `id`, NOT `user_id`. The policy must match the
--      actual column name; do not "fix" this to auth.uid() = user_id —
--      that column does not exist on profiles and would fail at apply time.
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

-- 008  push_subscriptions — Web Push endpoints per device
DROP POLICY IF EXISTS "push_select_own" ON public.push_subscriptions;
CREATE POLICY "push_select_own" ON public.push_subscriptions
  FOR SELECT USING (auth.uid() = user_id);

-- 010  plaid_transactions — synced Plaid transactions per user
DROP POLICY IF EXISTS "plaid_transactions_select_own" ON public.plaid_transactions;
CREATE POLICY "plaid_transactions_select_own" ON public.plaid_transactions
  FOR SELECT USING (auth.uid() = user_id);

-- 012  account_nicknames — per-user display overrides
DROP POLICY IF EXISTS "account_nicknames_select_own" ON public.account_nicknames;
CREATE POLICY "account_nicknames_select_own" ON public.account_nicknames
  FOR SELECT USING (auth.uid() = user_id);

-- 013  budgets — per-category monthly spending caps
DROP POLICY IF EXISTS "budgets_select_own" ON public.budgets;
CREATE POLICY "budgets_select_own" ON public.budgets
  FOR SELECT USING (auth.uid() = user_id);

-- 014  goals — savings goals + projections
DROP POLICY IF EXISTS "goals_select_own" ON public.goals;
CREATE POLICY "goals_select_own" ON public.goals
  FOR SELECT USING (auth.uid() = user_id);

-- ════════════════════════════════════════════════════════════════════════
--   (C) Deliberately service-role only — DO NOT add a select_own here
-- ════════════════════════════════════════════════════════════════════════
-- plaid_tokens
--   Holds access_token, the long-lived credential Plaid issues per linked
--   Item. Anything that reaches the browser is reachable by any script on
--   the page (extensions, third-party SDKs, XSS). A select_own policy here
--   would expose access_token to the anon-key client and break the
--   "credentials never leave the server" invariant. All reads go through
--   server.js using the service-role key. RLS remains enabled with zero
--   client policies → anon-key SELECT returns nothing.
--
-- rate_limits
--   Increment counter for the increment_rate_limit() SECURITY DEFINER RPC.
--   Letting an authenticated user SELECT their own rows is mostly harmless,
--   but the table is intentionally opaque so users cannot probe their
--   own throttling state and time abuse around it. RLS remains enabled
--   with zero client policies; the RPC is the only sanctioned read path.

-- ════════════════════════════════════════════════════════════════════════
--   (D) Non-user-scoped — no user_id column, no per-user policy applies
-- ════════════════════════════════════════════════════════════════════════
-- cron_jobs
--   Singleton-per-job-name ledger of last-run timestamps used by the
--   /api/admin/db-status dashboard. Has no user_id column; the data is
--   global to the install, not per-user. RLS enabled, no client policies.
--
-- polygon_cache
--   Shared 24-hour OHLC cache for the backtester. Cached bars are
--   identical for every user, keyed on (ticker, from_date, to_date,
--   timespan). No user_id column. RLS enabled, no client policies.
--
-- auth.sessions (referenced by 006 only via RPC functions)
--   Lives in the auth schema, not public, and is not directly addressable
--   by PostgREST. The three RPC functions in 006_sessions.sql
--   (get_user_sessions, revoke_session, revoke_other_sessions) are the
--   only sanctioned access path and are EXECUTE-granted to service_role
--   only. No public.* table exists to add a policy to.
