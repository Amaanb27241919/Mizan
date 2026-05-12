-- 008_push_subscriptions.sql
--
-- Stores Web Push subscriptions (endpoint + VAPID keypair) per user.
-- Used by lib/notify.mjs sendPushToUser() to fan out notifications.
--
-- One user can have multiple subscriptions (different devices/browsers).
-- The UNIQUE constraint on (user_id, endpoint) keeps a single browser
-- from registering twice. ON DELETE CASCADE wipes a user's subs when
-- the auth.users row goes away.

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx
  ON public.push_subscriptions(user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can read their own subscriptions (useful for showing "registered
-- devices" in settings). Writes always go through the server using the
-- service-role key, so no INSERT/UPDATE/DELETE policies are needed.
DROP POLICY IF EXISTS "push_select_own" ON public.push_subscriptions;
CREATE POLICY "push_select_own" ON public.push_subscriptions
  FOR SELECT USING (auth.uid() = user_id);
