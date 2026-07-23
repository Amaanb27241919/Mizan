-- 026_user_names.sql
--
-- First / last name on the profile. Motivated by the admin panel: a list of
-- bare email addresses is unreadable when you're trying to recognise who a
-- user actually is (support threads, broadcasts, audit log).
--
-- Columns are nullable on purpose — every existing user pre-dates this
-- migration, so the app prompts them for a name on next load rather than
-- the DB rejecting rows that legitimately have none yet.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name  text;

-- Sign-up passes names through auth metadata (supabase.auth.signUp
-- options.data), so the trigger that fans auth.users → profiles has to carry
-- them across. NULLIF keeps an empty string out of the column.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, first_name, last_name)
  VALUES (
    NEW.id,
    NEW.email,
    NULLIF(btrim(COALESCE(NEW.raw_user_meta_data ->> 'first_name', '')), ''),
    NULLIF(btrim(COALESCE(NEW.raw_user_meta_data ->> 'last_name',  '')), '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Backfill anything auth already knows (invited users, OAuth providers that
-- returned a name). Only fills blanks — never overwrites a name the user set.
-- A single-word full_name yields a first name and no last name, rather than
-- duplicating the same word into both columns.
WITH src AS (
  SELECT
    u.id,
    btrim(COALESCE(u.raw_user_meta_data ->> 'first_name', '')) AS meta_first,
    btrim(COALESCE(u.raw_user_meta_data ->> 'last_name',  '')) AS meta_last,
    btrim(COALESCE(u.raw_user_meta_data ->> 'full_name',
                   u.raw_user_meta_data ->> 'name', ''))       AS meta_full
  FROM auth.users u
)
UPDATE public.profiles p
SET first_name = COALESCE(
      p.first_name,
      NULLIF(src.meta_first, ''),
      NULLIF(split_part(src.meta_full, ' ', 1), '')
    ),
    last_name = COALESCE(
      p.last_name,
      NULLIF(src.meta_last, ''),
      CASE WHEN strpos(src.meta_full, ' ') > 0
           THEN NULLIF(btrim(substr(src.meta_full, strpos(src.meta_full, ' ') + 1)), '')
      END
    )
FROM src
WHERE src.id = p.id
  AND (p.first_name IS NULL OR p.last_name IS NULL);

-- Name search for the admin user list (small table; keeps ILIKE cheap).
CREATE INDEX IF NOT EXISTS profiles_name_idx
  ON public.profiles (lower(last_name), lower(first_name));
