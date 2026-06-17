-- 016_encrypt_secrets.sql
--
-- Add application-layer encryption columns for secrets currently stored
-- in plaintext.  Old plaintext columns are KEPT (nullable) so existing
-- rows continue to work until the one-time migration script
-- scripts/encrypt-existing-secrets.mjs has been run and verified.
--
-- Migration 017_drop_plaintext_secrets.sql (prepared, not yet applied)
-- drops the plaintext columns once encryption is confirmed end-to-end.
--
-- Encrypted storage shape — three columns per secret:
--   <name>_ciphertext  TEXT   AES-256-GCM ciphertext, base64-encoded
--   <name>_iv          TEXT   96-bit IV, base64-encoded (random per write)
--   <name>_auth_tag    TEXT   128-bit GCM auth tag, base64-encoded
--
-- Decryption key: ENCRYPTION_KEY env var (32-byte hex, 64 chars).
-- Generate: openssl rand -hex 32

-- ── user_snaptrade ───────────────────────────────────────────────────────────
ALTER TABLE public.user_snaptrade
  ADD COLUMN IF NOT EXISTS secret_ciphertext text,
  ADD COLUMN IF NOT EXISTS secret_iv         text,
  ADD COLUMN IF NOT EXISTS secret_auth_tag   text;

-- ── user_keys ────────────────────────────────────────────────────────────────
ALTER TABLE public.user_keys
  ADD COLUMN IF NOT EXISTS finnhub_key_ciphertext  text,
  ADD COLUMN IF NOT EXISTS finnhub_key_iv          text,
  ADD COLUMN IF NOT EXISTS finnhub_key_auth_tag    text,
  ADD COLUMN IF NOT EXISTS polygon_key_ciphertext  text,
  ADD COLUMN IF NOT EXISTS polygon_key_iv          text,
  ADD COLUMN IF NOT EXISTS polygon_key_auth_tag    text;

-- encrypted column already exists from 002_user_state.sql (boolean, default false).
-- It is set to true by handlers.mjs whenever a row is written with ciphertext.
