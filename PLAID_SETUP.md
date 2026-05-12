# Plaid Setup

How to wire up Plaid banking aggregation for MĪZAN's Finances tab. This is a one-time setup; once the keys + schema are in place, every signed-in user can connect their bank.

Estimated time: **15 minutes** end-to-end.

---

## What this enables

Once configured, the **Finances** tab in MĪZAN gives every authenticated user:

- Connect any of ~12,000 US banks via Plaid Link (one-tap OAuth)
- Live checking / savings / credit / loan balances
- Spending breakdown by category (Food, Transport, Entertainment, etc.)
- Recurring subscription detection (Netflix, gym, SaaS tools)
- 200 most-recent transactions with merchant name + category
- Net bank position rolled into the Overview "Total Portfolio Value"

Read-only by design — Plaid never sees your password, MĪZAN never sees your bank credentials, and `access_token`s never leave the server.

---

## Prerequisites

- [ ] Working MĪZAN deploy on Vercel + Supabase already configured
- [ ] Access to the Supabase SQL Editor for your project
- [ ] Access to Vercel project settings → Environment Variables

---

## Step 1 — Get Plaid sandbox keys

1. Go to [dashboard.plaid.com/signup](https://dashboard.plaid.com/signup) and create an account. No payment required for sandbox.
2. Once in the dashboard, the **Keys** page (left nav) shows:
   - `client_id` — public identifier
   - `Sandbox secret` — server-only secret
3. Copy both. You'll paste them into Vercel in Step 3.

The sandbox environment uses fake test banks (Tartan Bank, First Platypus, Houndstooth, etc.) with canned credentials — perfect for development without touching real bank data. Free, unlimited usage.

---

## Step 2 — Add Supabase tables

Open Supabase → SQL Editor → New query, and paste the block below. Run.

```sql
-- plaid_tokens — one row per linked Plaid Item (bank connection).
-- Server-only. The access_token must never leak to the browser.
CREATE TABLE IF NOT EXISTS public.plaid_tokens (
  id               bigserial PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token     text NOT NULL,
  item_id          text NOT NULL UNIQUE,
  institution_name text,
  institution_id   text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS plaid_tokens_user_idx ON public.plaid_tokens (user_id);

ALTER TABLE public.plaid_tokens ENABLE ROW LEVEL SECURITY;
-- No client-side policies — every read/write goes through the server.

-- plaid_accounts — flat account list per Item, for display.
CREATE TABLE IF NOT EXISTS public.plaid_accounts (
  id            bigserial PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id       text NOT NULL,
  account_id    text NOT NULL UNIQUE,
  name          text,
  official_name text,
  type          text,
  subtype       text,
  mask          text,
  current_bal   numeric,
  available_bal numeric,
  iso_currency  text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS plaid_accounts_user_idx ON public.plaid_accounts (user_id);
CREATE INDEX IF NOT EXISTS plaid_accounts_item_idx ON public.plaid_accounts (item_id);

ALTER TABLE public.plaid_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "plaid_accounts_select_own"
  ON public.plaid_accounts FOR SELECT
  USING (auth.uid() = user_id);
```

Verify both tables show up under **Database → Tables**.

The full block also lives in `supabase/schema.sql` for new deployments.

---

## Step 3 — Add Vercel env vars

Vercel → Project → **Settings** → **Environment Variables**. Add three:

| Name | Value | Notes |
|---|---|---|
| `PLAID_CLIENT_ID` | from dashboard.plaid.com → Keys | Server-only |
| `PLAID_SECRET` | sandbox secret from same page | Server-only |
| `PLAID_ENV` | `sandbox` | Use `development` or `production` later |

Add to **Production**, **Preview**, and **Development** environments — Vercel asks per-env when you add.

**Trigger a redeploy** (Deployments → click latest → "…" → Redeploy). Vercel doesn't hot-swap env vars into running functions.

After redeploy, the function log on first cold start should print:
```
plaid: sandbox environment ready
```
If it prints `plaid: not configured — banking aggregation disabled`, the env vars weren't picked up. Double-check the Vercel Settings page + redeploy.

---

## Step 4 — Test in sandbox

1. Open your deployed MĪZAN, sign in
2. Click the new **Finances** tab in the dock
3. Click **+ Connect Bank**
4. Plaid Link opens. Pick any bank from the list (try "First Platypus" or "Tartan Bank")
5. Enter sandbox credentials:
   - Username: `user_good`
   - Password: `pass_good`
6. Optional MFA prompt: code `1234`
7. Select accounts to share → Continue
8. Back in MĪZAN, you should see:
   - "Linked First Platypus Bank" success toast
   - Hero tile: total bank net position
   - Institution card with all the sandbox accounts
   - Spending by category bar chart populated
   - Recurring subscriptions detected
   - Transactions table at the bottom

If you see errors:

- **403 / "Plaid not configured"** — env vars weren't picked up. Check Vercel, redeploy.
- **401 / "Unauthenticated"** — sign in first; all Plaid endpoints require a Supabase JWT.
- **500 / "INVALID_API_KEYS"** — `PLAID_SECRET` doesn't match `PLAID_CLIENT_ID`'s environment. Make sure both are the **sandbox** values.
- **CSP error in console** — your `vercel.json` is out of date. The latest version includes `cdn.plaid.com` and `*.plaid.com` in CSP allowlists.

---

## Sandbox test credentials reference

| Scenario | Username | Password | MFA |
|---|---|---|---|
| Standard happy path | `user_good` | `pass_good` | `1234` (if asked) |
| Multi-factor | `user_good` | `mfa_device` | `1234` |
| Invalid login | `user_bad` | `pass_bad` | — |
| Locked account | `user_good` | `pass_good_locked` | — |
| Custom user (faster sandbox iteration) | `user_custom` | (skip) | — |

[Full list in Plaid docs](https://plaid.com/docs/sandbox/test-credentials/).

---

## Moving to real banks (development environment)

Plaid's `development` environment hits real bank APIs but is rate-limited to 100 Items. Free.

1. Plaid dashboard → **API → Keys** → reveal the **Development secret**
2. Vercel → set `PLAID_ENV=development`, update `PLAID_SECRET` to the development secret
3. Redeploy

Real bank credentials work; data is real. Good for personal use up to 100 connections.

---

## Moving to production

Production requires Plaid review + approval. Free up to 100 Items, then paid.

1. Plaid dashboard → **Account → Production access**
2. Submit the production access form. Plaid reviews use case, data handling, security posture. Usually 1–3 business days.
3. Once approved, generate a production secret
4. Vercel → set `PLAID_ENV=production`, update `PLAID_SECRET`
5. Redeploy

Things Plaid checks for during review:
- Privacy policy + terms of service URLs on your site
- Description of why you're collecting financial data
- Data retention policy
- Security posture (HTTPS ✓, encrypted storage ✓, MFA ✓, etc.)

MĪZAN's existing setup already covers the technical bar — privacy/policy pages are the most common gap.

---

## Architecture — data flow

```
┌─────────────┐    1. link-token req     ┌────────────────┐
│  Browser    │ ───────────────────────> │ Vercel /api/   │
│  (Finances) │                          │  plaid/...     │
└─────────────┘ <───── link_token ─────  └────────┬───────┘
       │                                          │
       │  2. user logs into bank in iframe        │
       v                                          v
┌─────────────┐                          ┌────────────────┐
│ Plaid Link  │                          │   Plaid API    │
│   iframe    │ <─── access_token ────── │ (sandbox /     │
└─────────────┘                          │  prod)         │
       │ public_token                    └────────────────┘
       v                                          ^
┌─────────────┐    3. exchange           ┌────────┴───────┐
│  Browser    │ ───────────────────────> │ Vercel /api/   │
│             │                          │ plaid/exchange │
└─────────────┘ <─── ok + institution ── └────────┬───────┘
                                                  │
                                                  v
                                          ┌────────────────┐
                                          │ Supabase       │
                                          │ plaid_tokens   │
                                          │ plaid_accounts │
                                          └────────────────┘
```

**What lives where:**
- `access_token` — Supabase `plaid_tokens` table. Server reads via service-role. **Never** sent to the browser.
- Account metadata, balances — `plaid_accounts` table, RLS so each user only reads their own
- Transactions — not persisted (fetched live each time via `/transactions/sync`). Avoids stale data + reduces storage growth

**Rate limit posture:**
- 90s auto-sync from MĪZAN pulls fresh balances per linked Item
- Plaid sandbox is unlimited; production has Item-level rate limits (varies by endpoint)
- Cron job NOT wired to Plaid currently — purely on-demand from the client. Add a daily refresh cron later if needed

---

## Cost notes

| Tier | Monthly cost | Use case |
|---|---|---|
| Sandbox | $0 | Development; fake banks; unlimited Items |
| Development | $0 | 100 real-bank Items max; personal use |
| Production / Pay-as-you-go | ~$0.30 per Item per month + free first 100 | Public launch |
| Production / Plus | Custom pricing | High volume / enterprise |

For MĪZAN's expected user count (<100 active users), Development tier suffices and costs $0. Beyond that, Production at ~$30/month per 100 active users.

---

## Disconnect / cleanup

A user can disconnect a bank via the **Disconnect** button on their institution tile. That:
1. Calls Plaid `/item/remove` to revoke the access_token at Plaid's end
2. Deletes the row from `plaid_tokens`
3. Deletes all rows from `plaid_accounts` for that Item
4. Writes a `bank.disconnect` entry to `audit_log`

If a user deletes their MĪZAN account entirely, the `ON DELETE CASCADE` on `user_id` removes all their Plaid rows automatically. To also revoke at Plaid's end, the app should call `/item/remove` for each token before the cascade fires — currently not implemented; add to the GDPR delete flow when that ships.

---

## Troubleshooting

**"Could not start Plaid Link" toast**
The server's `/api/plaid/link-token` call failed. Check Vercel function logs — usually an env-var issue or a Plaid product entitlement (sandbox should have all products enabled by default).

**Plaid Link iframe shows "Sorry, we had trouble..."**
Network issue talking to `cdn.plaid.com`. Check the browser console for CSP errors. The deployed `vercel.json` must include `https://cdn.plaid.com` in `script-src` and `https://*.plaid.com` in `connect-src` and `frame-src`.

**Transactions return empty but balances are populated**
First call to `/transactions/sync` per Item only returns what Plaid has cached. Plaid's bank-side poller normally fills history within a few minutes of first link. Hit the Finances tab again after a couple of minutes.

**"Item login_required" error after weeks of working fine**
The user's bank requires re-auth (typical after password change, MFA reset, or bank-side session expiry). Plaid's update-mode Link flow handles this — not wired yet. Workaround: disconnect + reconnect the bank.

**Spending categories all show "Other"**
Plaid's `personal_finance_category` is more accurate but newer; older Plaid accounts default to the legacy `category[]` array. MĪZAN falls back automatically, but if both are empty (rare), bucket is "Other".

---

## API endpoint reference

All endpoints require an authenticated Supabase JWT in the `Authorization: Bearer <token>` header. MĪZAN's `apiFetch()` helper attaches this automatically.

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| POST | `/api/plaid/link-token` | — | `{ link_token, expiration }` |
| POST | `/api/plaid/exchange` | `{ public_token, metadata }` | `{ ok, item_id, institution_name }` |
| GET | `/api/plaid/accounts` | — | `{ accounts: [...] }` |
| GET | `/api/plaid/transactions` | — | `{ transactions: [...] }` (newest first, up to 5 pages) |
| DELETE | `/api/plaid/item?itemId=…` | — | `{ ok, item_id }` |

Rate limiting applies (per `lib/handlers.mjs` middleware): 120 req/min per user.

---

## Audit trail

Every Plaid connect / disconnect writes to `audit_log`:

```sql
SELECT user_id, action, target, metadata, created_at
FROM audit_log
WHERE action LIKE 'bank.%'
ORDER BY created_at DESC;
```

Useful for compliance reviews and debugging "why did this user's bank disappear?" questions.
