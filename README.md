# MĪZAN

The Shariah-compliant financial super-app. Brokerages, banking, trading, and AI insights — unified, halal-screened, in one place.

> 🚧 **Personal-use software, not financial or religious advice.** Consult a qualified scholar for personal jurisprudence.

---

## What it does

| Section | Replaces | Highlights |
|---|---|---|
| 💳 **Finances** | Origin, Mint | Live net worth across every connected brokerage + manual assets (gold, real estate, business equity). Daily snapshots. Zakat calculation with per-asset eligibility. |
| 📈 **Investments** | Zoya, Personal Capital | Unified portfolio via SnapTrade. Real-time Sharia screening across **7 frameworks** (AAOIFI, Dow Jones Islamic, S&P Shariah, FTSE Shariah, MSCI Islamic, SC Malaysia, IFSB). Tax-loss harvesting with halal replacement suggestions. |
| ⚡ **Trading** | Robinhood, Schwab | Order ticket with preview/confirm flow. Pre/post-market quotes, browser-native price alerts, watchlist. Sharia pre-check on every order — spot equity only, no margin, no derivatives, no shorts. |
| 🤖 **Backtest / FIRE** | Backtrader | Polygon historical bars + SMA-50/200 crossover engine. FIRE retirement projector with nominal vs. inflation-adjusted curves. |
| 🧠 **Intelligence** | Yahoo Finance, Bloomberg | Sentiment-tagged news (Finnhub). Sharia-aware **AI advisor** (Anthropic Claude) with full portfolio context. Auto-notifications for non-compliance changes + dividend payments. |

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | Vite + React 18, recharts, inline styles + CSS vars (auto-themed sunrise/sunset) |
| Backend | Node 22 ESM, single catch-all Vercel serverless function (`api/[...path].mjs`) |
| Local dev | Same handler reused as Node http server with Vite middleware (`server.js`) |
| Auth | Supabase email + password (sign-in / sign-up / reset, all same-tab) |
| Per-user state | Postgres via Supabase (RLS-enforced) |
| Brokerages | SnapTrade (60+ brokers) |
| Market data | Finnhub (real-time quotes + news), Polygon (historical OHLC) |
| AI | Anthropic Claude Sonnet 4 |
| Email | Resend SMTP (transactional) |
| Hosting | Vercel (frontend + serverless), Supabase (auth + DB) |
| PWA | Service worker + Web manifest — installable on iOS/Android/desktop |

---

## Local development

```bash
git clone https://github.com/Amaanb27241919/Mizan.git
cd Mizan
npm install
cp .env.example .env.local   # then edit with your keys
npm run dev
```

One terminal. One port (`3000`). Vite middleware + API on the same Node server.

### Required environment variables

```dotenv
# SnapTrade — sign up at snaptrade.com/developers (free sandbox)
VITE_SNAPTRADE_CLIENT_ID=your-client-id
VITE_SNAPTRADE_CONSUMER_KEY=your-consumer-key      # server-only

# Market data (free tiers available)
VITE_FINNHUB_KEY=your-finnhub-key
VITE_POLYGON_KEY=your-polygon-key                  # promoted server-side
VITE_ANTHROPIC_KEY=sk-ant-api03-...                # promoted server-side

# Supabase — optional; leave blank for single-user pass-through mode
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=ey...
SUPABASE_SERVICE_ROLE_KEY=ey...                    # server-only, bypasses RLS

# Owner email — this user inherits any legacy mizan_primary SnapTrade connections
OWNER_EMAIL=you@example.com
```

### Multi-user setup (Supabase)

1. Create a Supabase project
2. Settings → API → copy URL + anon key into `.env.local`
3. Settings → API → Legacy tab → copy service_role JWT
4. SQL Editor → paste `supabase/schema.sql` → Run
5. Authentication → URL Configuration → Site URL + Redirect URLs to `http://localhost:3000` (add Vercel URL after deploy)
6. Authentication → Providers → Email → **disable "Confirm email"** so sign-up lands authenticated in the same tab (no email click-through). Password reset emails still work — that flow uses a recovery link.
7. Restart dev server — login screen appears

Each authenticated user gets isolated state via Postgres + Row Level Security.

### Custom SMTP (Resend)

Supabase's default email throttles to 2 magic links / hour. For more, hook up Resend:

1. Sign up at [resend.com](https://resend.com), verify a domain
2. Generate an API key
3. Supabase → Project Settings → Auth → SMTP Settings:
   - Host: `smtp.resend.com` · Port: `465` · Username: `resend` · Password: API key
   - Sender: `auth@your-verified-domain`

---

## Deployment

### Vercel auto-deploys from `main`

```bash
git push origin main
```

That's it. Vercel detects the push, builds, deploys. Production URL stays the same — usually 30-60s for the bundle to swap.

### First-time Vercel setup

1. Import the GitHub repo via [vercel.com](https://vercel.com)
2. Framework preset: **Other**
3. Build command: `npm run build`
4. Output directory: `dist`
5. Add **all** env vars from `.env.local` to Vercel → Settings → Environment Variables (Production + Preview)
6. Deploy

After the first deploy, add your Vercel URL to **Supabase → Auth → URL Configuration → Redirect URLs**:
- `https://your-vercel-url.vercel.app`
- `https://your-vercel-url.vercel.app/**`

### Updating environment variables

Either:
- **Dashboard**: Vercel → Settings → Environment Variables → edit → trigger redeploy
- **CLI** (faster): `vercel env rm KEY production --yes && echo "value" | vercel env add KEY production`

Env vars only take effect on the **next deploy** — Vercel doesn't hot-swap them into running functions.

---

## Architecture decisions

### Single serverless function
`api/[...path].mjs` catches everything under `/api/*` and dispatches to `lib/handlers.mjs`. Trade-offs:
- ✅ 1 function (Vercel Hobby limit is 12)
- ✅ Local dev (`server.js`) and Vercel use the **exact same route logic**
- ❌ All routes share one cold start (~500ms first hit)

### Per-user SnapTrade isolation
Each Supabase user gets a SnapTrade `userId` of the form `mizan_<supabase-uuid>`, stored in the `user_snaptrade` Postgres table with RLS. The server resolves which `userSecret` to use per-request based on the JWT in the `Authorization` header.

### Owner-claim
`OWNER_EMAIL` lets one user inherit a pre-existing `mizan_primary` SnapTrade `userSecret` from `.snaptrade-users.json` on first sign-in. This preserves brokerage connections that existed before multi-user support shipped. For production deployments where the file isn't present, seed the owner's row manually:

```sql
INSERT INTO public.user_snaptrade (user_id, snaptrade_user_id, snaptrade_user_secret)
SELECT id, 'mizan_primary', '<your-existing-userSecret>'
  FROM auth.users WHERE email = '<your-email>'
ON CONFLICT (user_id) DO UPDATE
  SET snaptrade_user_id     = EXCLUDED.snaptrade_user_id,
      snaptrade_user_secret = EXCLUDED.snaptrade_user_secret;
```

### Static pricing by default
Auto-sync defaults OFF. Live prices fetch on the Sync All button or via the optional 10-minute auto-refresh. Prices cache to localStorage so reloads preserve last-known values without re-hitting Finnhub.

### Demo mode
A fictional ~$42M halal portfolio built into the bundle. Defaults **on** for new users (so they don't land on an empty app) and auto-hides from the header once a user has real broker connections. Re-enable from Settings → Connect Accounts.

---

## Free-tier ceilings

| Service | Limit | Notes |
|---|---|---|
| Vercel Hobby | 100 GB-hours functions / mo | Cold start ~500ms |
| Supabase | 500 MB DB, 50k MAU | Plenty for personal + a few friends |
| SnapTrade | 5 users per developer | Upgrade if scaling |
| Finnhub | 60 calls / min | Sector results cache in localStorage |
| Polygon | 5 calls / min, 2yr history | Backtester respects |
| Anthropic | Pay-as-you-go | ~$0.01 / advisor message |
| Resend | 3,000 emails / mo | Way more than magic-link demand |

---

## Project structure

```
.
├── api/
│   └── [...path].mjs        # Vercel catch-all serverless function
├── lib/
│   ├── handlers.mjs         # Shared route logic (used by api + server.js)
│   ├── auth.jsx             # React auth context + useAuth hook
│   ├── supabase.js          # Supabase browser client (graceful when env absent)
│   └── apiFetch.js          # Wrapper that attaches Supabase JWT to /api calls
├── public/
│   ├── manifest.webmanifest # PWA manifest
│   └── sw.js                # Service worker (cache-first static, network-first API)
├── scripts/
│   └── gen-pwa-icons.mjs    # PNG generator (no deps, pure zlib + Buffer)
├── src/
│   ├── App.jsx              # AuthProvider + Gate
│   ├── main.jsx
│   └── components/
│       ├── MizanApp.jsx     # The whole UI (~3500 lines)
│       └── Login.jsx        # Magic-link sign-in card
├── supabase/
│   ├── schema.sql           # user_snaptrade, user_state, user_keys + RLS
│   └── README.md            # Supabase setup notes
├── server.js                # Node http server for local dev (uses lib/handlers.mjs)
├── vercel.json              # Catch-all rewrite + security headers
└── render.yaml              # Alternate Render deployment config
```

---

## License

Private personal-use software. No public license granted. Contact owner before redistributing.
