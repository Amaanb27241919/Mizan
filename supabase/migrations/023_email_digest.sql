-- 023_email_digest.sql
-- Per-user opt-out flag for the weekly digest email.
--
-- Defaults to TRUE so existing users keep receiving the Monday digest: before
-- this column existed, the weekly-digest cron's `.eq("email_digest", true)`
-- filter threw and silently fell back to emailing ALL profiles. Making the
-- column real (default true) preserves that behavior while giving users a real
-- toggle (Settings → Notifications → Weekly Email Digest).
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS email_digest boolean NOT NULL DEFAULT true;
