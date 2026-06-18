# MĪZAN — Claude Code Brief

> Read this before every session. It overrides any generic defaults.

---

## What This App Is

MĪZAN is a Sharia-compliant personal finance app for Muslim investors. It aggregates brokerage accounts (SnapTrade), bank accounts (Plaid), and manual assets into a single dashboard with Sharia screening, Zakat calculation, purification tracking, tax-loss harvesting, and an AI advisor.

**Stack:** React 18 (single JSX file), Vite, Supabase (auth + data), Vercel (edge functions + deploy), SnapTrade API (brokerage), Plaid API (banking), Finnhub (screening), Recharts (charts).

**The entire frontend lives in one file: `src/components/MizanApp.jsx`.** This is intentional. Do not split it unless explicitly asked.

---

## Design System — Non-Negotiable

### Color Tokens (from `const T`)
```
T.blue   = #c9a24b  — gold, primary accent (NOT actually blue — named historically)
T.gold   = #cf9e54  — amber, warnings, Zakat
T.gain   = #6fae8e  — jade green, Halal / positive
T.loss   = #c46a52  — rust red, non-compliant / negative
T.muted              — low-contrast labels, captions
T.textHi             — primary readable text
T.text               — secondary text
T.dim                — borders, dividers
```

Never introduce new hex colors outside of `T`. Use the existing tokens.

### Typography
```
FU = Fraunces (serif)   — hero numbers, big stat values, section titles
FP = IBM Plex Sans      — body text, descriptions, explanations
FM = IBM Plex Mono      — ALL labels, tickers, chips, eyebrows, percentages, numbers in tables
```

The mono font (`FM`) is used for every label, eyebrow, tag, and numeric display. This is a deliberate design choice — it gives the app its editorial financial feel. Do not use `FP` for numbers or `FU` for body text.

### Spacing Scale
All spacing uses CSS custom properties from `T.s1`–`T.s12` (4px–48px). Never hardcode padding/margin values.

### Glass Material
`className="glass"` and `className="glass-strong"` are for chrome only:
- ✅ Nav bars, tab bars, modals, overlays, tooltips
- ❌ Data tables, stat cards, charts, bento tiles

### Bento Layout
The app uses a bento grid system (`className="bento"`, `className="bento-row"`). All content tiles use `<BentoTile>`. No raw divs as layout containers.

---

## Architecture Decisions (Do Not Undo)

1. **Single-file frontend** — MizanApp.jsx is intentionally monolithic. Resist the urge to split into separate component files unless explicitly asked.

2. **All styling is inline** — no external CSS modules. Theme tokens via `T.*` object + `THEME_CSS` string injected at mount. No Tailwind, no styled-components.

3. **No mutations** — state updates use spread/map/filter. Never mutate existing arrays or objects.

4. **Live prices** via a shared `live` state (WebSocket + polling). Components receive `live` as a prop and merge it with stored positions via `mapPosition`. Never fetch prices inside individual components.

5. **`activities` and `accounts` come from `snapActivities` / `snapAccounts` state** — both are localStorage-cached and broadcast across tabs. The source of truth for display is always the prop, not a component-level fetch.

6. **Symbol normalization** — SnapTrade can return symbols as strings, `{symbol: "AAPL"}`, or nested objects. Always use `normSym()` inside TaxPlanner or the `fmtSym()` helper inside ActivityPanel to resolve a ticker string. Never access `a.symbol.symbol` directly.

7. **Sharia status** — `h.sh_` comes from `SHARIA_MAP` (fast, local). The Screener tab overlays live Finnhub API results. Both can differ — this is intentional. Never use Screener results outside the Screener tab.

---

## Data Flow Summary

```
SnapTrade API  →  /api/snaptrade/*  →  snapAccounts + snapActivities state
Plaid API      →  /api/plaid/*      →  plaidAccounts + bankBalance state
Supabase       →  /api/*            →  auth, net worth history, purification, user prefs
Live prices    →  Polygon WebSocket  →  live[] state  →  merged into positions via mapPosition
```

All API calls go through `apiFetch()` (handles auth headers). Never use `fetch()` directly.

---

## What Claude Should Do Proactively

- **Always check `T.*` tokens before any color decision.** Never hardcode hex.
- **When fixing a calculation bug, check all places the same calculation appears** — the same logic often exists in Overview, Portfolio Holdings, and sub-components separately.
- **When adding a new range filter or period**, update the chart cutoff logic AND the gain display AND the label — they must all be consistent.
- **After any edit to MizanApp.jsx, run `npm run build`** to catch JSX/React errors before reporting done.
- **Call out misleading or fake data displays** (e.g., synthetic sparklines, hardcoded demo values appearing in user views). These are accuracy issues, not cosmetic ones.

## What Claude Should NOT Do Without Being Asked

- Split MizanApp.jsx into multiple files
- Change the font stack or introduce new typefaces
- Introduce new color tokens or change existing ones
- Add analytics, logging, or tracking
- Change the Supabase schema or add new migrations
- Rename existing CSS class names (`.bento`, `.glass`, `.btn-primary`, etc.)
- Add external npm packages without asking

---

## Quality Bar

Every new UI surface must:
- Use `T.*` tokens exclusively — no hardcoded colors
- Use `FM` for all labels, `FU` for all display numbers, `FP` for body text
- Use `fontVariantNumeric:"tabular-nums"` on any numeric display
- Handle the empty/loading state (no raw empty div)
- Not introduce fake/synthetic data that could be mistaken for real portfolio data
- Work in both light and dark themes

Financial figures must:
- Use `mask()` from `useHideValues()` when displaying portfolio values (respects the privacy toggle)
- Use `fmtUSD()`, `kf()`, `f$()`, or `fp()` formatters — never raw `.toFixed(2)` in JSX
- Never show NaN, undefined, or "[object Object]" to the user

---

## Current Known Limitations (Do Not Re-Surface as Bugs)

- YTD realized gain uses current avg cost as sell basis — lot-level cost basis is not available from SnapTrade. `missingBasisCount` already surfaces this in the Tax tab UI.
- Chart history is monthly buckets interpolated from deposit activity — not actual daily NAV. Real net-worth snapshots override when available.
- Sharia screening results are cached per-day from Finnhub. Same-day rescreens require clicking "Re-screen."
- Portfolio Holdings chart ("30-day trend") was removed — real intraday data is not available.
