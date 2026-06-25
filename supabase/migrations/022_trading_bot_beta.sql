-- 022_trading_bot_beta.sql
-- Per-user Trading Bot BETA access + first-use consent.
--
-- WHY: bot access was tied 1:1 to profiles.is_root, so the only way to let a
-- beta user try Trade was to make them root — which ALSO grants the admin user
-- list, API-key surfaces, and anomaly/owner endpoints. trading_bot_enabled
-- decouples bot access from ownership: it grants Trade (Manual/Semi only — see
-- the server gate) WITHOUT any admin/root powers. Opt-in, default false.
--
-- trading_bot_consent_at records acceptance of the experimental / "Mizan is not
-- an RIA" risk disclosure. Non-root users cannot create a strategy or execute a
-- trade until it is set (enforced server-side in handlers.mjs).
--
-- Both columns are written only via the service-role API (sbAdmin); existing
-- profiles RLS (owner-read) already covers reads, so no policy change is needed.

alter table public.profiles
  add column if not exists trading_bot_enabled  boolean     not null default false,
  add column if not exists trading_bot_consent_at timestamptz;

comment on column public.profiles.trading_bot_enabled is
  'Beta allowlist for the Trading Bot, independent of is_root. Grants Manual/Semi trade access only; full-auto stays root-only.';
comment on column public.profiles.trading_bot_consent_at is
  'When the user accepted the experimental/not-an-RIA bot risk disclosure. Required for non-root users before any strategy create or trade execution.';
