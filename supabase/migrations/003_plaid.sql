-- 003_plaid.sql
--
-- Plaid banking integration tables.
--   plaid_tokens   — one row per linked Plaid Item, holds access_token.
--                    Server-only via service-role; access_token MUST NOT
--                    leak to the browser.
--   plaid_accounts — flat account list per Item, for display.
--                    Updated on every /api/plaid/accounts call.

-- ── plaid_tokens ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.plaid_tokens (
  id               bigserial PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token     text NOT NULL,
  item_id          text NOT NULL UNIQUE,
  institution_name text,
  institution_id   text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS plaid_tokens_user_idx ON public.plaid_tokens (user_id);

ALTER TABLE public.plaid_tokens ENABLE ROW LEVEL SECURITY;
-- No client-side policies — every read/write goes through the server using
-- the service-role key. Browser can NEVER see access_token under any path.

-- ── plaid_accounts ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.plaid_accounts (
  id            bigserial PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id       text NOT NULL,
  account_id    text NOT NULL UNIQUE,
  name          text,
  official_name text,
  type          text,
  subtype       text,
  mask          text,
  current_bal   numeric,
  available_bal numeric,
  iso_currency  text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS plaid_accounts_user_idx ON public.plaid_accounts (user_id);
CREATE INDEX IF NOT EXISTS plaid_accounts_item_idx ON public.plaid_accounts (item_id);

ALTER TABLE public.plaid_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plaid_accounts_select_own" ON public.plaid_accounts;
CREATE POLICY "plaid_accounts_select_own"
  ON public.plaid_accounts FOR SELECT
  USING (auth.uid() = user_id);
