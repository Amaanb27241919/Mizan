-- ── 029: per-user Alpaca paper-trading credentials ──────────────────────────
--
-- WHY: every /api/alpaca/* route used ONE shared paper account read from
-- ALPACA_KEY_ID / ALPACA_SECRET. That is honest with exactly one tester. With
-- two, both write into the same blotter, see each other's positions, and share
-- buying power — so neither can trust what they are looking at. Owner decision
-- 2026-08-20: each tester brings their own free Alpaca paper account.
--
-- WHY HERE AND NOT user_state: the live key-entry path in the app today is the
-- `mizan_keys` blob in user_state, which is PLAINTEXT at rest. A Finnhub key
-- leaks read-only market data; an Alpaca secret can PLACE ORDERS. Different
-- risk class, so these live in user_keys, which already carries the
-- AES-256-GCM ciphertext columns added in 016 and is RLS'd to the owning user.
--
-- NOTE ON THE MISSING PLAINTEXT COLUMN: finnhub_key and polygon_key each keep a
-- plaintext column as a backward-compatibility fallback for rows written before
-- encryption was switched on. Alpaca has no such history, so there is
-- deliberately NO `alpaca_secret` plaintext column — there is nowhere for an
-- unencrypted trading credential to land, by construction. The write path
-- refuses to store anything when ENCRYPTION_KEY is unset rather than silently
-- degrading to plaintext.
--
-- alpaca_key_id is an identifier rather than a secret (it is the "username"
-- half), but it is encrypted too: the pair together is what authenticates, and
-- storing half of a credential in the clear buys nothing.

ALTER TABLE public.user_keys
  ADD COLUMN IF NOT EXISTS alpaca_key_id_ciphertext text,
  ADD COLUMN IF NOT EXISTS alpaca_key_id_iv         text,
  ADD COLUMN IF NOT EXISTS alpaca_key_id_auth_tag   text,
  ADD COLUMN IF NOT EXISTS alpaca_secret_ciphertext text,
  ADD COLUMN IF NOT EXISTS alpaca_secret_iv         text,
  ADD COLUMN IF NOT EXISTS alpaca_secret_auth_tag   text,
  -- Last 4 of the key id, stored in the clear on purpose: the Settings screen
  -- has to show WHICH account is connected without decrypting anything, and a
  -- 4-character suffix identifies a key to its owner while being useless alone.
  ADD COLUMN IF NOT EXISTS alpaca_key_last4         text,
  -- Paper vs live. Defaults to true and the server currently refuses false —
  -- see lib/handlers.mjs. The column exists so that flipping it later is a
  -- deliberate, reviewable change rather than a schema migration under time
  -- pressure. Mizan is not licensed to route live discretionary orders.
  ADD COLUMN IF NOT EXISTS alpaca_paper             boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS alpaca_updated_at        timestamptz;

COMMENT ON COLUMN public.user_keys.alpaca_key_last4 IS
  'Last 4 chars of the Alpaca key id, cleartext, for display only.';
COMMENT ON COLUMN public.user_keys.alpaca_paper IS
  'Paper account. The server refuses to store or use a non-paper credential.';

-- A row may exist from the Finnhub/Polygon path with no Alpaca columns set;
-- "configured" means the ciphertext triple for BOTH halves is present.
CREATE INDEX IF NOT EXISTS user_keys_alpaca_configured_idx
  ON public.user_keys (user_id)
  WHERE alpaca_key_id_ciphertext IS NOT NULL
    AND alpaca_secret_ciphertext IS NOT NULL;

-- RLS: user_keys already has select/insert/update/delete-own policies from 002
-- and they are column-agnostic, so these columns inherit them. Writes still go
-- through the service role in handlers.mjs (the route encrypts before storing);
-- the policies matter as defence-in-depth if a client ever reads the table
-- directly, and they scope any such read to the owning user.

