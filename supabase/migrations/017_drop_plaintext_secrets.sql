-- 017_drop_plaintext_secrets.sql
--
-- PREPARED BUT NOT YET APPLIED.
--
-- Run this ONLY after:
--   1. Migration 016_encrypt_secrets.sql has been applied.
--   2. scripts/encrypt-existing-secrets.mjs ran to completion with 0 errors.
--   3. You have verified that the application reads secrets correctly from
--      the ciphertext columns in production (check /api/snaptrade/accounts
--      and /api/snaptrade/holdings return data for real users).
--   4. ENCRYPTION_KEY is set in all Vercel environments (Production + Preview).
--
-- What this does:
--   - Drops the plaintext snaptrade_user_secret from user_snaptrade.
--   - Drops the plaintext finnhub_key and polygon_key from user_keys.
--
-- After this runs there is NO plaintext fallback. Any row that was not
-- migrated by encrypt-existing-secrets.mjs will be permanently inaccessible
-- via the read path. Confirm 100% migration before applying.

-- ── user_snaptrade ───────────────────────────────────────────────────────────

-- Verify all rows are migrated before dropping. This will ERROR if any
-- un-migrated row exists, preventing an accidental drop.
DO $$
DECLARE
  unmigrated_count integer;
BEGIN
  SELECT COUNT(*) INTO unmigrated_count
  FROM public.user_snaptrade
  WHERE snaptrade_user_secret IS NOT NULL
    AND secret_ciphertext IS NULL;

  IF unmigrated_count > 0 THEN
    RAISE EXCEPTION
      'BLOCKED: % user_snaptrade row(s) still have plaintext secrets with no ciphertext. '
      'Run scripts/encrypt-existing-secrets.mjs first.',
      unmigrated_count;
  END IF;
END $$;

ALTER TABLE public.user_snaptrade DROP COLUMN IF EXISTS snaptrade_user_secret;

-- ── user_keys ────────────────────────────────────────────────────────────────

DO $$
DECLARE
  unmigrated_count integer;
BEGIN
  SELECT COUNT(*) INTO unmigrated_count
  FROM public.user_keys
  WHERE (finnhub_key IS NOT NULL AND finnhub_key_ciphertext IS NULL)
     OR (polygon_key IS NOT NULL AND polygon_key_ciphertext IS NULL);

  IF unmigrated_count > 0 THEN
    RAISE EXCEPTION
      'BLOCKED: % user_keys row(s) still have plaintext keys with no ciphertext. '
      'Run scripts/encrypt-existing-secrets.mjs first.',
      unmigrated_count;
  END IF;
END $$;

ALTER TABLE public.user_keys
  DROP COLUMN IF EXISTS finnhub_key,
  DROP COLUMN IF EXISTS polygon_key;
