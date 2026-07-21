-- 025_messages.sql
--
-- In-app support/contact thread: a lightweight two-way async message channel
-- between each user and the operator (admin). Motivated by users having no way
-- to reply to Mizan's send-only email address (alerts@mizan.exchange has no
-- inbound mailbox), so the app itself is the contact channel.
--
-- One row per message; `sender` is 'user' or 'admin'. `read_at` marks when the
-- OTHER party has seen it (drives unread badges — user reads clear admin msgs,
-- admin reads clear user msgs).
--
-- Writes happen exclusively through service-role handlers (POST /api/messages,
-- POST /api/admin/messages), so — like plaid_transactions — only a SELECT-own
-- RLS policy is needed for the browser's anon-key reads.

CREATE TABLE IF NOT EXISTS public.messages (
  id          bigserial   PRIMARY KEY,
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender      text        NOT NULL CHECK (sender IN ('user','admin')),
  body        text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz
);

CREATE INDEX IF NOT EXISTS messages_user_created_idx
  ON public.messages (user_id, created_at);

-- Fast "any unread user messages?" scan for the admin thread list.
CREATE INDEX IF NOT EXISTS messages_unread_idx
  ON public.messages (user_id) WHERE read_at IS NULL AND sender = 'user';

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Browser reads its own thread via the anon-key client. Inserts/updates happen
-- exclusively through the service-role key on the server, so no write policy.
DROP POLICY IF EXISTS "messages_select_own" ON public.messages;
CREATE POLICY "messages_select_own"
  ON public.messages FOR SELECT
  USING (auth.uid() = user_id);
