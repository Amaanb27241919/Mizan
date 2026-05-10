# MĪZAN — Shariah-Compliant Investment Super-App

> The first fully automated halal trading platform — Shariah compliance screening, multi-broker aggregation, and algorithmic execution for Muslim retail investors.

---

## ⚡ Deploy to Vercel in 15 Minutes

### Step 1 — Prerequisites (5 min)
- [ ] [GitHub account](https://github.com) — free
- [ ] [Vercel account](https://vercel.com) — free, sign up with GitHub
- [ ] [Node.js 18+](https://nodejs.org) installed on your machine

### Step 2 — Create GitHub Repository (3 min)
1. Go to github.com → **New repository**
2. Name it: `mizan`
3. Set to **Private** (your financial data)
4. Click **Create repository**
5. On your computer, open Terminal and run:

```bash
# Clone your new empty repo
git clone https://github.com/YOUR_USERNAME/mizan.git
cd mizan

# Copy all files from this folder into it
# (drag and drop or cp -r /path/to/mizan-app/. .)

# Push to GitHub
git add .
git commit -m "Initial MĪZAN deployment"
git push origin main
```

### Step 3 — Deploy to Vercel (3 min)
1. Go to [vercel.com/new](https://vercel.com/new)
2. Click **Import Git Repository**
3. Select your `mizan` repo
4. Framework preset: **Vite** (auto-detected)
5. Click **Deploy**
6. ✅ Your app is live at `mizan.vercel.app`

### Step 4 — Add Environment Variables (2 min)
In Vercel dashboard → your project → **Settings → Environment Variables**:

| Variable | Value | Priority |
|---|---|---|
| `VITE_FINNHUB_KEY` | Your Finnhub key | ⭐ Do first |
| `VITE_POLYGON_KEY` | Your Polygon key | Do second |
| `VITE_ALPACA_KEY_ID` | Your Alpaca key ID | Later |
| `VITE_ALPACA_SECRET` | Your Alpaca secret | Later |
| `VITE_SNAPTRADE_CLIENT_ID` | Your SnapTrade client ID | Later |
| `VITE_SNAPTRADE_CONSUMER_KEY` | Your SnapTrade key | Later |

After adding variables → **Redeploy** (one click).

### Step 5 — Custom Domain (Optional, $12/yr)
1. Buy `getmizan.com` at [Namecheap](https://namecheap.com) (~$12/yr)
2. Vercel → Settings → Domains → Add `getmizan.com`
3. Follow DNS instructions (5 min)

---

## 🏃 Run Locally

```bash
# Install dependencies
npm install

# Create your local env file
cp .env.example .env.local
# Edit .env.local and add your API keys

# Start development server
npm run dev
# Opens at http://localhost:3000

# Build for production
npm run build
```

---

## 🔑 API Keys — Get These Free Tonight

### Stage 1: Finnhub (2 min — do this first)
1. Go to [finnhub.io](https://finnhub.io)
2. Click **Get free API key**
3. Sign up with email
4. Copy your API key
5. Add to `.env.local` as `VITE_FINNHUB_KEY=your_key_here`

**What you get:** Real-time stock quotes, pre/post market prices, company news, basic fundamentals for all your holdings.

### Stage 2: Polygon.io (2 min)
1. Go to [polygon.io](https://polygon.io)
2. Click **Get started free**
3. Sign up, verify email
4. Go to Dashboard → API Keys → copy key
5. Add as `VITE_POLYGON_KEY=your_key_here`

**What you get:** 2 years of historical OHLCV data for real charts (15-min delayed on free tier).

### Stage 3: Alpaca (10 min — for bot trading)
1. Go to [alpaca.markets](https://alpaca.markets)
2. Sign up for **Paper Trading** account (free forever)
3. Dashboard → API Keys → Generate new key
4. Add `VITE_ALPACA_KEY_ID` and `VITE_ALPACA_SECRET`

**What you get:** The bot places real orders against real market prices using fake money. Test your strategy risk-free.

### Stage 4: SnapTrade (for connecting your real brokerages)
1. Go to [snaptrade.com/developers](https://snaptrade.com/developers)
2. Sign up for developer account
3. Create an app → get Client ID + Consumer Key
4. Add `VITE_SNAPTRADE_CLIENT_ID` and `VITE_SNAPTRADE_CONSUMER_KEY`

**What you get:** Connect Fidelity, Robinhood, Schwab, Empower 401k — real balances pull automatically.

---

## 📱 Connecting Your Accounts (SnapTrade)

Once SnapTrade keys are added:

1. Click **+ CONNECT ACCOUNTS** in the top header
2. Select your broker (Fidelity, Robinhood, Schwab, Empower)
3. SnapTrade opens a secure popup → log into your broker directly
4. MĪZAN **never sees your credentials** — OAuth only
5. Your real holdings appear in Portfolio tab automatically

**Supported brokers:** Fidelity, Robinhood, Charles Schwab, Empower (401k), E*Trade, Vanguard, Webull, Alpaca, Interactive Brokers, and 20+ more.

---

## 🏗 Project Structure

```
mizan/
├── src/
│   ├── main.jsx              # React entry point
│   ├── App.jsx               # Root wrapper
│   └── components/
│       └── MizanApp.jsx      # The entire app (2,900+ lines)
├── public/
│   └── favicon.svg
├── index.html                # HTML shell
├── package.json
├── vite.config.js
├── vercel.json               # Vercel deployment config
├── .env.example              # Template for your API keys
└── .gitignore                # Keeps .env.local out of Git
```

---

## 🗓 Deployment Timeline

| Timeline | What You Build | Cost |
|---|---|---|
| **Tonight** | Deploy to Vercel, add Finnhub key, real prices live | $0 |
| **This week** | Add Polygon (charts), connect Robinhood/Fidelity via SnapTrade | $0 |
| **Month 1** | Add Alpaca paper trading, bot places automated trades | $0 |
| **Month 2** | Add Supabase auth, data persists between sessions | $0-25/mo |
| **Month 3** | Add price alerts, Telegram notifications | $0-10/mo |
| **Month 4** | Switch Alpaca to live trading, real money automation | $0 |
| **Month 6** | First paying users, Stripe subscription | Revenue covers costs |

---

## ⚖️ Legal Disclaimer

MĪZAN is an educational and informational tool. It is not a registered investment advisor, broker-dealer, or financial planning service. All data and analysis is for informational purposes only and does not constitute investment advice. Past performance does not guarantee future results. Please consult a qualified financial advisor and a qualified Islamic finance scholar before making investment decisions.

---

## 🕌 Sharia Compliance

MĪZAN applies AAOIFI and DJIM screening standards:
- **No Riba** — cash-only accounts, no margin or interest
- **No Gharar** — no options, futures, or derivatives
- **No Maisir** — systematic edge required, not speculation
- **Debt screening** — Total Debt/Assets < 33%
- **Revenue screening** — Haram income < 5% of revenue
- **Purification** — mixed income flagged for charitable donation

Sharia rulings are for guidance only. Consult your local scholar for personal rulings.
# Mizan
