-- 021_full_auto_per_account.sql — per-connected-account full-auto opt-in.
--
-- Layer 3 (full-auto) now requires BOTH the profile master switch
-- (profiles.full_auto_enabled) AND an explicit per-account opt-in stored
-- here, which defaults to FALSE even for the owner. The owner must turn on
-- each connected account deliberately.
--
-- COMPLIANCE: enabling full-auto for non-owner accounts likely requires RIA
-- registration. Do not change without legal review.

CREATE TABLE IF NOT EXISTS account_full_auto (
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id  text NOT NULL,
  enabled     bool NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, account_id)
);

ALTER TABLE account_full_auto ENABLE ROW LEVEL SECURITY;
CREATE POLICY "account_full_auto_owner" ON account_full_auto
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
