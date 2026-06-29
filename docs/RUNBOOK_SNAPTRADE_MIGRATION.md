# Runbook — Migrate to SnapTrade Pay As You Go Commercial

Use this when SnapTrade support confirms they can't upgrade your Personal
account to Commercial in place. Estimated time: **~30 minutes**, almost
all of it waiting on you to log into SnapTrade and reconnect brokers.

The plan ensures zero risk: at every step, only one place has authority,
and there is no "half-migrated" state where some traffic uses old keys
and some uses new keys.

---

## Prerequisites

- [ ] New SnapTrade Commercial account created (separate email, e.g.
      `akhan.industries+commercial@gmail.com`)
- [ ] Pay As You Go **Real-time** selected on signup
- [ ] New `client_id` copied (visible in Dashboard → API Keys)
- [ ] New `consumer_key` copied (visible in Dashboard → API Keys; revealed
      via the eye icon)
- [ ] `.env.local` has `VITE_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
      (used by the wipe script)

---

## Step 1 — Verify the new keys work (2 min)

```bash
cd /Users/amaankhan/Documents/mizan-app
SNAPTRADE_NEW_CLIENT_ID="<paste new id>" \
SNAPTRADE_NEW_CONSUMER_KEY="<paste new secret>" \
node scripts/snaptrade-test-keys.mjs
```

Expect:

```
✓ listBrokerages: 200  (N brokerages returned)
✓ listUsers     : 200  (0 users currently registered)
✓ Keys are valid. Safe to proceed with migration.
```

If you see a 401/403, the keys are wrong. Re-copy from SnapTrade dashboard
and try again. Do not proceed past this step until you get a clean ✓.

---

## Step 2 — Add the new keys to Vercel (3 min)

These commands will prompt you to paste the secret values. They are NOT
visible in this terminal session afterward.

```bash
# Update CONSUMER_KEY across all environments (server-only secret).
vercel env rm SNAPTRADE_CONSUMER_KEY production -y 2>/dev/null
vercel env rm SNAPTRADE_CONSUMER_KEY preview -y 2>/dev/null
vercel env rm SNAPTRADE_CONSUMER_KEY development -y 2>/dev/null

vercel env add SNAPTRADE_CONSUMER_KEY production
vercel env add SNAPTRADE_CONSUMER_KEY preview
vercel env add SNAPTRADE_CONSUMER_KEY development

# Update CLIENT_ID. The VITE_ prefix is required because the frontend
# code path also reads it from import.meta.env at build time.
vercel env rm VITE_SNAPTRADE_CLIENT_ID production -y 2>/dev/null
vercel env rm VITE_SNAPTRADE_CLIENT_ID preview -y 2>/dev/null
vercel env rm VITE_SNAPTRADE_CLIENT_ID development -y 2>/dev/null

vercel env add VITE_SNAPTRADE_CLIENT_ID production
vercel env add VITE_SNAPTRADE_CLIENT_ID preview
vercel env add VITE_SNAPTRADE_CLIENT_ID development
```

After:

```bash
vercel env ls | grep SNAPTRADE
```

Should show both `SNAPTRADE_CONSUMER_KEY` and `VITE_SNAPTRADE_CLIENT_ID`
present on Development, Preview, Production.

**Important: do NOT redeploy yet.** The new env vars are staged but
not active. Wipe credentials first (Step 3) so when the redeploy lands
both the keys AND the database are aligned to the new account.

---

## Step 3 — Wipe stale credentials (1 min)

Stale `(snaptrade_user_id, snaptrade_user_secret)` pairs in the
`user_snaptrade` table only work against the OLD client_id. After Step 4
they'd cause 404s on every `/api/snaptrade/*` call until manually
deleted. We wipe them now so the next call enters the registerUser
path against the new account.

```bash
# Dry run first to confirm what will be deleted
node scripts/snaptrade-wipe-credentials.mjs

# Actually wipe (saves a JSON backup under scripts/_snaptrade-backups/)
CONFIRM=YES node scripts/snaptrade-wipe-credentials.mjs
```

A backup of all wiped rows lands under
`scripts/_snaptrade-backups/wipe-<timestamp>.json` so you can recover
the old user-secrets if anything goes sideways. The backups are
git-ignored by default — do not commit them.

---

## Step 4 — Redeploy (2 min)

```bash
# Triggers a new Production deployment from current main
vercel --prod
```

Or just push any commit (including a no-op) to `main` — Vercel auto-deploys.

Watch the deploy in the Vercel dashboard. When it shows ✓ Ready (~1 min
for this app), the new keys are live.

Quick smoke test from the deploy:

```bash
curl -s https://app.mizan.exchange/api/snaptrade/brokerages | head -c 200
```

Should return a JSON array of brokerages, not a 503 or auth error.

---

## Step 5 — Reconnect your brokers (5 min)

1. Open https://app.mizan.exchange, sign in as yourself
2. Click **Settings → Connect Accounts** (or **+ Connect** in the status bar)
3. Reconnect each broker:
   - [ ] Fidelity
   - [ ] Robinhood
   - [ ] Schwab
   - [ ] Chase
   - [ ] Coinbase

Each reconnect creates a fresh SnapTrade authorization on the NEW
account. The whole flow is OAuth — usually under a minute per broker.

---

## Step 6 — Verify (2 min)

```bash
# Confirm the new account has the expected connections
node scripts/snaptrade-status.mjs
```

Expect: 1 SnapTrade user (`mizan_<your-supabase-uuid>`) with the brokers
you reconnected in Step 5.

Then open the app, head to **Portfolio** — your holdings should populate
within ~10 seconds of the reconnect (SnapTrade pulls initial positions
from each broker on first connection).

---

## Step 7 — Notify previously-stuck users (1 min)

The 3 users who couldn't connect before should retry now. Either:

- Email them directly ("MIZAN's brokerage integration is unblocked —
  please try connecting again at https://app.mizan.exchange")
- Or wait — they may retry on their own and the new account has room

The new account starts at 0 connected users so there's no quota issue.

---

## Rollback

If Steps 3-4 go wrong and SnapTrade isn't working:

```bash
# Restore from the latest backup
ls scripts/_snaptrade-backups/
```

The most recent file contains the deleted rows. You can restore via
the Supabase SQL editor:

```sql
-- For each row in backup.supabase_rows:
INSERT INTO public.user_snaptrade (user_id, snaptrade_user_id, snaptrade_user_secret)
VALUES ('<user_id>', '<snaptrade_user_id>', '<snaptrade_user_secret>');
```

Then revert Vercel env vars to the old keys via `vercel env`, and
redeploy. The old SnapTrade Personal account stays alive until you
explicitly close it, so the old keys keep working.

---

## What happens to the old SnapTrade account

The old Personal account stays open and idle. No charges (you were on
the free tier). You can either:

- Leave it open as a fallback (free, harmless)
- Disconnect all brokers and close the account at the end of the month

Either is fine. No urgency.
