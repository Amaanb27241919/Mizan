# MĪZAN → Rebrand Inventory

> **Purpose:** every place the "Mizan" name is baked in, so a rebrand misses nothing.
> Generated 2026-07-12 from a full scan of both repos + the known external surfaces.
> The name has been in place since **early March 2026**; this maps ~4 months of accumulation.
>
> **The two genuinely hard parts** (everything else is find-and-replace): (1) the **domain**
> `mizan.exchange` — it's wired into OAuth redirect URIs, the Plaid webhook, email DKIM/SPF/DMARC,
> Supabase Site URL, and CSP; and (2) the **~52 `mizan_*` storage keys** — renaming them orphans
> every existing user's saved data. Read "Migration risks" before touching either.

Name today: **MĪZAN** (display) / **Mizan** / **mizan** (code) · Arabic wordmark **ميزان** ("balance/scale")
Tagline: **"Balance your wealth. Honor your deen."** · Descriptor: "Sharia-compliant investing"

---

## Scope at a glance

| Surface | Where | Rough size |
|---|---|---|
| App repo code/docs | `~/Documents/mizan-app` | **798** occurrences across **~65 files** |
| Landing repo | `~/Desktop/AI Projects/mizan-landing` | **38** occurrences across **7 files** |
| Brand assets (logos/marks/wordmarks/favicons/OG) | both repos + `legal/logos` | ~16 files to regenerate |
| Storage keys (`mizan_*`) | localStorage + Supabase `user_state` | **~52 keys** (⚠️ user-data migration) |
| External services | GitHub, Vercel, Supabase, Resend, Plaid, SnapTrade, Sentry, Push, DNS | see §H |

---

## A. The name & brand identity (string content)
- Display name **MĪZAN** (with macron Ī = `&#298;` / `Ī`), plain **Mizan**, lowercase **mizan**.
- Arabic wordmark **ميزان** — in `src/components/MizanApp.jsx` (the fixed canvas watermark) and `public/logo-ar.svg` / `public/wordmark-ar.png`.
- Tagline **"Balance your wealth. Honor your deen."** (`lib/alerts.mjs` email shell, landing, app).
- Descriptors: "Sharia-compliant investing", "the Sharia-compliant platform to track, screen, and grow your wealth".
- Decide the new name + whether it keeps an Arabic wordmark + a new tagline before anything else.

## B. Code — app repo (`~/Documents/mizan-app`)
Notable, not exhaustive (65 files total — `grep -ril mizan`):
- **`src/components/MizanApp.jsx`** — the 11k-line monolith. **Filename + component name `MizanApp`** + the `ميزان` watermark + dozens of UI strings. (Renaming the file/component is a bigger refactor — it's imported in `src/App.jsx`.)
- UI/strings across: `Login.jsx`, `Contact.jsx`, `Privacy.jsx`, `LegalLayout.jsx`, `BugReportButton.jsx`, `CommandPalette.jsx`, `ConnectionHealth.jsx`, `Goals.jsx`, `Budgeting.jsx`, `BillsCalendar.jsx`, `Icon.jsx`, `Skeleton.jsx`, `PerformancePanel.jsx`.
- **Backend:** `lib/handlers.mjs` (email copy, `APP_BASE_URL` default `https://app.mizan.exchange`, invite/notification text), `lib/alerts.mjs` (email shell + senders + tagline + logo URL), `lib/notify.mjs` (push titles), `lib/crypto.mjs`/`lib/rateLimit.mjs` (comments/labels), `middleware.ts`.
- `src/lib/*` — `apiFetch.js`, `auth.jsx`, `userState.js`, `formatters.js`, `performance.js`, `zakat.js`, `useKeyboard.js` (mostly the `mizan_*` storage keys, see §G).
- `package.json` / `package-lock.json` (`"name"`), `README.md`, `SECURITY.md`, `CHANGELOG.md`, `render.yaml`, `.env.example`, `.github/workflows/*.yml` (cron URLs → `app.mizan.exchange`).
- Docs (internal, lower priority): `CLAUDE.md`, `MIZAN-STATE-AUDIT.md`, `MIZAN-BENCHMARK-ROADMAP.md`, `BACKLOG.md`, `docs/*`, `scripts/*`.

## C. Code — landing repo (`~/Desktop/AI Projects/mizan-landing`, GitHub `Amaanb27241919/mizan-landing`)
- `index.html` (all marketing copy + brand), `vercel.json`, `sitemap.xml`, `robots.txt`, `README.md`, `logo.svg`, `logo-en.svg`. Domains referenced: `mizan-puce.vercel.app` (×16), `mizan.exchange` (×10).

## D. Brand assets — REGENERATE (name is in the pixels, not greppable)
App repo `public/`: `logo.png`, `logo.svg`, `logo-en.svg`, `logo-ar.svg`, `mark.png`, `mark-light.png` (theme-swapped), `wordmark-ar.png`, `mizan-plaid-1024.png` (the Plaid Link institution icon), `favicon.png`, `icon-192.png`, `icon-512.png`.
`legal/logos/`: `mizan-logo.svg`, `mizan-logo-512.png`.
Landing repo: `logo.png/svg`, `logo-en.svg`, `logo-ar.svg`, `mark.png`, `wordmark-ar.png`, `favicon.png`, `og-image.png` (social preview — has the name).
Also: the **PWA manifest** `public/manifest.webmanifest` (`name`/`short_name` = "MĪZAN") and the SW-cached icon set.

## E. Domain & DNS
- **Domain:** `mizan.exchange` (apex) + `www.` + `app.` subdomains. **DNS is on Vercel** (`*.vercel-dns.com`) — manage via `vercel dns ls/add mizan.exchange --scope mizan-s-projects2`.
- **Records that carry the brand / must move to a new domain:** `_dmarc` TXT (`rua=mailto:dmarc@mizan.exchange`, added 2026-07-12), `resend._domainkey` DKIM, `send` SPF (`v=spf1 include:amazonses.com`) + `send` MX (SES bounce), root MX (SES inbound), CAA, ALIAS (Vercel).
- **Legacy:** `mizan.app` (×4, unverified — was migrated away 2026-07-02) and `mizan-puce.vercel.app` still appear — drop entirely in the rebrand.
- A domain change means **buying/verifying the new domain**, repointing DNS, re-doing all email DNS (DKIM/SPF/DMARC) + Resend domain verification, and updating every hardcoded `app.mizan.exchange`/`www.mizan.exchange` URL (44 + 9 hits).

## F. Email (Resend + Supabase)
- **Resend** verified domain `mizan.exchange`; senders `alerts@mizan.exchange` (env `ALERT_FROM`) and `no-reply@mizan.exchange`; `dmarc@mizan.exchange` (DMARC rua).
- **App email shell:** `lib/alerts.mjs` `renderBrandedEmail()` — logo `${APP_URL}/logo.png`, tagline, footer, name throughout.
- **Supabase Auth emails:** the 6 branded templates in `supabase/email-templates/` (`confirmation, invite, magic_link, recovery, email_change, reauthentication`) + `subjects.json` — all say MĪZAN; sent via Supabase custom SMTP → Resend as `no-reply@mizan.exchange`.
- **New domain ⇒ re-verify in Resend, re-issue DKIM/SPF/DMARC, warm the domain, update `ALERT_FROM` + Supabase SMTP sender + Site URL + all 6 templates + the app shell.**

## G. Data & storage — ⚠️ the brand is in USER DATA
**~52 `mizan_*` keys** live in each user's **localStorage** and are mirrored to Supabase **`user_state`** (via `src/lib/userState.js` `TRACKED_KEYS`). Renaming the prefix **orphans every existing user's data** unless migrated. Full list:
`mizan_aaoifi_cache, mizan_account_nicknames, mizan_accounts_cache, mizan_activities_cache, mizan_auto, mizan_bank_balance, mizan_bot_default_layer, mizan_brokers, mizan_ct_*, mizan_current_user_id, mizan_debts, mizan_demo, mizan_disabled_accts, mizan_documents_cache, mizan_etf_overlap_sel, mizan_ethical_overlay, mizan_has_real_data, mizan_hide_values, mizan_imports, mizan_intraday, mizan_ios_hint, mizan_keys, mizan_live_cache, mizan_manual_assets, mizan_metals_cache, mizan_nav, mizan_networth_history, mizan_onboarded, mizan_onboarding_step, mizan_pending_order, mizan_plaid_accounts, mizan_plaid_oauth_token, mizan_primary, mizan_purification_log, mizan_purification_overrides, mizan_rebalance_halal, mizan_rebalance_targets, mizan_sadaqah, mizan_sadaqah_seeded, mizan_screen_standard, mizan_screening_baseline, mizan_sectors, mizan_seen_dividends(_initialized), mizan_sun_*, mizan_theme_mode, mizan_trade_optin, mizan_trade_venue, mizan_user_docs, mizan_watchlist, mizan_zakat_settings`.
- **Recommendation:** these are internal, never user-visible. **Keep the `mizan_` prefix** (or a neutral one) to avoid a data migration — OR ship a one-time migration (read old key → write new → delete old, both localStorage and `user_state`) before flipping.
- Also: **SW cache name** `mizan-v18` (`public/sw.js`) — a rename forces one cache invalidation for all clients (fine, just bump). **DB table/column names are NOT brand-named** (they're `user_state`, `plaid_tokens`, etc.) — the Supabase schema itself needs no rename. ✅

## H. External services / accounts (can't grep — check each dashboard)
- **GitHub:** repos `Amaanb27241919/Mizan` (app) + `Amaanb27241919/mizan-landing`. Rename both (GitHub redirects old URLs; update git remotes + CI).
- **Vercel:** project **`mizan`**, team **`mizan-s-projects2`**, URL `mizan-puce.vercel.app` (+ alias `app.mizan.exchange`). Rename project + re-alias the new domain.
- **Supabase:** project ref `kcghivcvczxaguezurii` (display name currently "Amaanb27241919's Project" — not "Mizan", so DB stays). Update: **Site URL** (`app.mizan.exchange`), **redirect allow-list**, **SMTP sender**, the **6 auth email templates**. Data/schema untouched.
- **Plaid:** ⚠️ users SEE the app name in **Plaid Link** during connect. Rename the Plaid app/client display name; update **`PLAID_WEBHOOK_URL`** → new domain; update redirect/OAuth config.
- **SnapTrade:** ⚠️ users SEE the app name in the brokerage-connect flow. Rename the SnapTrade app registration (client_id/consumer_key stay, display name changes); update any redirect.
- **Sentry:** project name (likely "mizan") — cosmetic.
- **Web Push (VAPID):** `VAPID_SUBJECT` (a `mailto:` on the domain) + push notification titles say "MĪZAN" (`lib/notify.mjs`).
- **API vendors (account names only, not user-visible):** Anthropic, Finnhub, Alpha Vantage, Polygon, Alpaca (paper), Stooq (keyless). No user-facing brand — just rename accounts/keys if desired.
- **Env vars carrying the brand in their VALUE:** `APP_BASE_URL` (=app.mizan.exchange), `ALERT_FROM` (=alerts@mizan.exchange), `PLAID_WEBHOOK_URL`, `VAPID_SUBJECT`, Supabase `SITE_URL`. (Var *names* are generic.)

## I. Legal
- `legal/` PDFs: `PRIVACY_POLICY.pdf`, `TERMS_OF_SERVICE.pdf`, `SECURITY_POLICY.pdf`, `ACCESS_CONTROLS_POLICY.pdf`, `DATA_RETENTION_POLICY.pdf` — all reference the name + **legal entity**.
- In-app: `src/components/Privacy.jsx`, `Terms.jsx`, `LegalLayout.jsx`, `Contact.jsx`. Landing links to `mizan-puce.vercel.app/{privacy,terms,legal/*}`.
- Decide: is the **legal entity/LLC** also renamed? That's paperwork beyond code.

## J. Config / infra
- **`vercel.json` CSP** (app + landing): `connect-src`/`img-src`/`frame-src` etc. list `*.mizan.exchange` + vendor origins — update for the new domain.
- **`middleware.ts`** — references the domain/brand.
- **GitHub Actions** `.github/workflows/cron-backup.yml` + `cron-bot-signals.yml` — hit `app.mizan.exchange` with `CRON_SECRET`.

---

## Migration risks & recommended order
1. **Pick the new name + secure the domain first** (buy it, so DNS/email can be set up in parallel without downtime).
2. **Storage keys:** decide **keep `mizan_` internally** (zero user impact — strongly recommended) **or** write + test a one-time migration. Do NOT rename them casually.
3. **Stand up the new domain in parallel:** DNS on Vercel, Resend domain re-verify (DKIM/SPF/**DMARC**), Supabase Site URL + redirect allow-list, Plaid `webhook` + redirect, SnapTrade redirect — while the old domain still serves, to avoid an outage.
4. **Third-party OAuth display names (Plaid, SnapTrade)** — change these so the connect screens users see are rebranded; they're the most visible external surface.
5. **Code + assets:** find-replace the strings, regenerate logos/marks/wordmark/OG/favicons/PWA icons, update email templates + shell, CSP, hardcoded URLs. Bump SW cache.
6. **Cut over:** repoint `app.` to the new domain (or add the new domain as the primary alias), update `APP_BASE_URL`/`ALERT_FROM`/`PLAID_WEBHOOK_URL`/`VAPID_SUBJECT`, redeploy via a **fresh git build** (Vercel Redeploy reuses the old env snapshot).
7. **Rename repos + Vercel project + Supabase display name** (data safe).
8. **Email warmup + DMARC** on the new domain (start `p=none`, watch reports, then quarantine).
9. Update legal docs (+ entity if applicable), landing SEO (`sitemap.xml`, `robots.txt`, canonical, OG).

## Decisions to lock before starting
- [ ] New name (+ Arabic wordmark? + new tagline?)
- [ ] New domain
- [ ] Keep `mizan_` storage prefix (no migration) **or** migrate user data?
- [ ] Keep the same Supabase project + Vercel project + GitHub repos (rename in place) **or** create fresh?
- [ ] Rename the legal entity too, or just the product?
- [ ] Rename `MizanApp.jsx`/the `MizanApp` component (internal refactor) or leave it?
