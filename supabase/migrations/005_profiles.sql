-- 005_profiles.sql
--
-- Per-user profile: role flags + soft-delete/suspend state. One row per
-- auth.users id, auto-created on signup by the handle_new_user trigger.
--
-- is_root replaces the OWNER_EMAIL env-var check for admin gating —
-- env-var fallback still works for the initial bootstrap, but once a
-- user is marked is_root=true via SQL they're admin regardless of env.

CREATE TABLE IF NOT EXISTS public.profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       text,
  is_root     boolean NOT NULL DEFAULT false,
  suspended   boolean NOT NULL DEFAULT false,
  suspended_at timestamptz,
  suspended_reason text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS profiles_email_idx   ON public.profiles (email);
CREATE INDEX IF NOT EXISTS profiles_is_root_idx ON public.profiles (is_root) WHERE is_root = true;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile. is_root + suspended are admin-only
-- write — service role bypasses RLS for those updates.
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

-- ── Auto-create profile on signup ─────────────────────────────────────────
-- Supabase signup writes to auth.users; this trigger fans out into the
-- public.profiles row so the rest of the app can rely on it existing.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- DROP + recreate so re-applying the migration is idempotent.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ── Backfill profiles for any existing users that pre-date this migration.
-- ON CONFLICT keeps it safe to re-run.
INSERT INTO public.profiles (id, email)
SELECT id, email FROM auth.users
ON CONFLICT (id) DO NOTHING;
