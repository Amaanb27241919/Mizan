# Supabase setup for MIZAN

MIZAN supports optional multi-user mode backed by Supabase. Without these
env vars, MIZAN runs in **single-user pass-through mode** — the app still
works locally, just without per-user accounts.

## Enable multi-user mode

1. Sign up at [supabase.com](https://supabase.com).
2. Create a new project. Pick any region near you.
3. In the Supabase dashboard, go to **Project Settings → API**. Copy:
   - `Project URL` → this is `VITE_SUPABASE_URL`
   - `anon` `public` key → this is `VITE_SUPABASE_ANON_KEY`
4. Open `.env.local` at the project root and uncomment / fill in:

   ```
   VITE_SUPABASE_URL=https://xxxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```

5. In the Supabase dashboard, open **SQL Editor → New query**, paste the
   entire contents of `supabase/schema.sql`, and run it. This creates the
   `user_snaptrade`, `user_state`, and `user_keys` tables with row-level
   security policies.
6. Restart the dev server: `npm run dev`.

## Single-user pass-through mode

If `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` is missing, MIZAN injects
a synthetic user (`local@mizan`) and skips the login screen. This keeps the
local dev experience friction-free.
