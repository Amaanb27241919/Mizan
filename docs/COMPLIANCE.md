# MĪZAN — Compliance Boundary (engineering)

> **This is an engineering guardrail, not legal advice.** It encodes a
> conservative, in-code reading of the line between impersonal information /
> account servicing and personalized investment advice. It is **pending formal
> legal review and any required RIA (Registered Investment Adviser)
> registration.** Nothing here is a legal opinion, and the tiers below are a
> best-effort engineering model — not a determination of regulatory status.

**Status:** the engineering guardrail described here is **live in production**
(`app.mizan.exchange`) as of **2026-07-15**. Legal review and any required RIA
registration remain **pending** — the guardrail is shipped, its legal sufficiency is not
established.

The read-only line is drawn at the **personalization of advice**, *not* at trade
execution and *not* at any single feature. MIZAN may **display** the user's own
data and may **state impersonal facts**, but it must **never generate a tailored
recommendation or suitability judgment**.

## The three tiers

Every piece of output is classified into exactly one tier
(`lib/compliance/policy.mjs` → `DATA_TIERS`):

| Tier | What it is | Allowed? | Examples |
|------|------------|----------|----------|
| **IMPERSONAL** | Identical for every user. A pure function of the request, never of who is asking. | ✅ Yes | Market data, **price charts**, halal screening verdicts + AAOIFI methodology, educational finance content, general company facts. |
| **ACCOUNT_SERVICING** | Displays the user's **own** factual data. A statement of fact about their account — never a judgment about it. | ✅ Yes (display only) | Their holdings, cost basis, transactions, allocation, Zakat/purification on their assets. |
| **PROHIBITED** | Tailored to the individual as advice. | ❌ No | Buy/sell/hold recommendations, suitability assessments, security rankings "for your goals," personalized target/entry/exit prices, "given your portfolio, do X," tailored model portfolios. |

**The rule the code enforces:** you may DISPLAY the user's own data and you may
state IMPERSONAL facts, but you must never GENERATE a tailored recommendation or
suitability judgment. **Halal screening is IMPERSONAL** — the same
religious/factual classification for everyone — and is always allowed. Zakat and
dividend-purification amounts are religious obligations / factual computations,
also allowed.

## Why the price chart is IMPERSONAL

The chart is fed by `GET /api/market/candles` (and `GET /api/market/quote`).
Their responses are a **pure function of the request** — `(symbol, resolution,
from, to)` — and nothing else:

- The pipeline is `validateCandleQuery(q)` → `getPolygonBars(...)` →
  `normalizeBars(...)` (`lib/market/candles.mjs` + `lib/handlers.mjs`). **None of
  these functions receive a user identity**, so two different authenticated users
  requesting identical params get byte-identical output (asserted in
  `src/test/market-endpoints.test.js`).
- The auth check on the route is **access control**, not personalization: it
  keeps anonymous callers from proxying market data / billing the upstream quota.
  The route carries an inline `assertImpersonal(...)` marker and a comment stating
  the contract.
- The chart UI has **no buy/sell signal markers, no target/entry/exit price
  lines, and no "signal" annotations**. SMA/EMA/volume are neutral **data**
  overlays, labeled "DATA, NOT SIGNALS."

## Why the holdings overlay is ACCOUNT_SERVICING

When the user holds the charted symbol, the chart overlays a dashed **"Your
average cost"** line and neutral markers for their **own executed** BUY/SELL
transactions (`src/components/charts/holdingsOverlay.js`).

- This is a **statement of fact about their account** — display only. It is
  derived from the user's own SnapTrade transaction history and cost basis.
- It carries **no judgment**: a single neutral color (not green/red-as-advice),
  plain "Bought / Sold" text, **no gain/loss-as-advice framing, no "consider"
  language, no suggestion**.
- It is **privacy-gated**: when the user hides values, the cost basis and trade
  sizes are not passed to the chart at all.
- The server loader that would surface this data is correctly user-scoped (it *is*
  their data); the chart-data routes above are the ones that must never be
  user-scoped.

## The advisor boundary (the AI)

The AI assistant (`/api/advisor`) is where personalization pressure is highest.
Two layers enforce the boundary:

1. **Hardened system prompt** (`lib/compliance/advisor-prompt.mjs`,
   server-owned so it can't be edited via DevTools). It reframes the assistant
   from "give actionable answers" to **explain, don't recommend**: it answers
   halal-screening + education + the user's own data, and **refuses** personalized
   buy/sell/hold, suitability judgments, security rankings for the user, and
   tailored price targets — redirecting to:
   > "I can explain the halal status and the data — the investment decision is
   > yours, and for personalized advice you'd want a licensed adviser."
   It includes few-shot refusals *and* few-shot allowed answers.

2. **Post-generation filter** (`lib/compliance/advisor-filter.mjs`,
   defense in depth). A deterministic regex pass scans generated text for the
   prohibited patterns below and, on a hit, **rewrites the answer to the
   compliant redirect**. It fails toward compliance (a false positive costs one
   over-cautious answer; a false negative would ship advice we mustn't give) but
   uses a sentence-aware negation guard so the model's **own refusals aren't
   clobbered**. Every flag is logged + audited (`compliance_filtered`) for review.

### Prohibited-output patterns

Maintained in `lib/compliance/policy.mjs` → `PROHIBITED_PATTERNS`:

- `imperative-recommendation` — "you should buy / sell / add …"
- `i-recommend-action` — "I recommend / suggest / advise … buying / selling …"
- `recommend-gerund` — "recommend buying", "suggest selling"
- `act-on-your-position` — "sell your NVDA", "trim your position"
- `best-for-you` — "the best stock for you", "a good buy for your portfolio"
- `suitability-framing` — "given your portfolio, sell …", "based on your goals …"
- `security-ranking-for-you` — "ranked for your goals", "top picks for you"
- `tailored-price-target` — "price target of $X", "set a stop-loss at …"
- `act-at-price-level` — "buy below $150", "sell around 42"

Investment-action verbs only — "donate / give / purify" are deliberately absent
so Zakat & purification guidance is never flagged.

## What's tested

- `src/test/market-endpoints.test.js` — validation rejects invalid
  symbols/resolutions/ranges; candle output is provably impersonal (identical for
  identical params, no user field in the pipeline); the candle + quote routes
  reject unauthenticated requests with 401 before any upstream fetch.
- `src/test/compliance.test.js` — a battery of personalized-advice outputs is
  flagged + redirected; impersonal/educational/account-servicing outputs (and the
  redirect itself, and the model's own refusals) pass through unchanged; the body
  rewrite is immutable and preserves tool_use blocks.

## Scope + caveats

- This guardrail governs **generated advice and the market-data surface**. It
  does **not** by itself establish or avoid any regulatory status.
- The filter is a backstop, not a substitute for the prompt; both should be
  reviewed together when tuning.
- Before relying on this boundary for a regulated offering, obtain **formal legal
  review** and complete any required **RIA registration**.
