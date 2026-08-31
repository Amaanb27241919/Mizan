# Conference Demo Hardening — Claude Code brief

**Deadline: Thursday 3 September 2026.** ISNA 63 runs 4–7 September at Huntington
Place, Detroit. This demo runs on a phone, on convention-center wifi, in front of
executives from Saturna/Amana and ShariaPortfolio. It must not fail once.

Do **not** build a demo mode. One already exists: `DEMO_ACCOUNTS`,
`DEMO_ACTIVITIES`, `DEMO_SHARIA` and `_pos()` in `src/components/MizanApp.jsx`,
guarded for module-load determinism by `src/test/demoFixtures.test.js`. Per
CLAUDE.md §8 the monolith is not to be split — work inside it. This brief hardens
what is there.

---

## Task 1 — Prove the demo is fully offline (highest priority)

Convention wifi will fail. The demo must run in airplane mode.

- Audit every code path reachable while `demoMode` is true for network calls:
  SnapTrade, Plaid, Finnhub, Polygon, Alpaca, Anthropic, nisab/spot-price fetches,
  Supabase reads, Sentry, and any analytics or `nav_usage` counter.
- Any call that survives must be short-circuited to fixture data before it is
  issued — not caught after it fails, and not left to a loading spinner.
- **Nisab is the likely offender.** The zakat worksheet reads live gold/silver
  spot. In demo mode it must use a frozen constant with a visible
  "sample data" marker, never a spinner and never a stale-cache read.
- Add a Playwright spec `e2e/demo-offline.spec.js` that runs the full demo path
  with the browser context set `offline: true` and asserts: zero failed requests,
  every headline figure rendered, no spinner or skeleton visible after 2s.

**Acceptance:** phone in airplane mode, cold load, every screen in Task 3 renders
complete. This is the gate — if it does not pass, nothing else in this brief matters.

## Task 2 — One-tap enter, one-tap reset

He will run this twenty-plus times over four days, standing up, between conversations.

- A single obvious control to enter demo mode from a cold start, reachable without
  logging in. Two taps maximum from app open.
- A reset that returns every screen to its initial state — scroll positions,
  expanded rows, screener sort, zakat worksheet fields, any toggled account.
- Reset must complete in under one second and must never require a page reload.
- Honor the existing `mizan_demo` localStorage scrub at `MizanApp.jsx:50` — do not
  regress the fix that prevents demo state leaking into a real session.

## Task 3 — Sequence the four screens for the story

The demo is a narrative in four beats. Each beat must land in one screenful on a
phone, with no horizontal scrolling and no pinch-zoom.

1. **Household overview.** All accounts visible at once, with the joint and
   spouse accounts legible as such. The point being made is *breadth* — money in
   seven places that has never been seen together. Verify the account list does
   not require scrolling past the fold on a 6.1" screen.

2. **Screener — this is the money shot.** Default the demo's screener sort so that
   `review` and `non-compliant` holdings appear above `halal` ones. The fixture
   already contains the exact contrast that makes the pitch: `AMAGX` (Amana
   Growth), `HLAL` and `SPUS` screen halal, while `VOO`, `VTI`, `VTSAX` and
   `VLXVX` screen review. Someone owns the compliant fund *and* holds far more in
   things nobody ever screened. That single screen is the argument — make sure
   both halves are visible without scrolling.

3. **Purification.** The per-dividend, per-holding ledger from
   `019_purification.sql` / `purification_ratios`, with the Mark Purified →
   sadaqah flow visible. Contrast being drawn: continuous, versus an annual PDF.

4. **Zakat.** One tap to a computed figure, with the nisab basis shown.

Add these four as an ordered Playwright spec `e2e/demo-conference.spec.js` at a
375×812 viewport asserting each beat renders above the fold.

## Task 4 — Hide what must not be shown

While `demoMode` is true:

- **The Trade tab and every Trade Beta surface must be unreachable.** Not
  disabled-and-visible — absent. This is the highest regulatory exposure in the
  product and it is not being shown to anyone in Detroit. Cross-reference
  `docs/TRADE-TAB.md` for every entry point.
- No performance, return, or backtest figure anywhere on a demo screen. Audit the
  Overview's money-weighted return and all-time contribution figures — if they
  render as investment performance rather than as account balances, hide them in
  demo mode.
- The not-an-adviser disclaimer must be visible on the screener and zakat screens,
  not buried in a settings page.
- Add assertions for all three to `e2e/demo-conference.spec.js`.

## Task 5 — The fallback recording

Live demos fail. There must be a video.

- Extend `scripts/generate-pwa-screenshots.mjs`, or add a sibling script, to drive
  the four beats through Playwright at a phone viewport and emit an MP4 plus a
  numbered PNG sequence into `demo/`.
- The video must run 75–90 seconds with deliberate pauses on each beat, no cursor
  artifacts, and no visible browser chrome.
- It must be saved to the phone's camera roll before Thursday night and be
  playable with no network.

## Task 6 — Cold-load performance

- Measure time-to-interactive for a cold demo load on a throttled 4G profile.
- Budget: first meaningful paint under 1.5s, fully interactive under 2.5s.
- If the monolith's initial parse blows the budget, defer non-demo routes rather
  than splitting `MizanApp.jsx`.

---

## Constraints

- Do not split or restructure `MizanApp.jsx` (CLAUDE.md §8).
- Do not modify `lib/compliance/*` — the policy tiers, `PROHIBITED_PATTERNS` and
  `filterAdvisorResponse()` are the compliance story being pitched. They stay
  exactly as they are.
- Do not weaken `src/test/demoFixtures.test.js`. If the `const _pos =` /
  `const DEMO_SHARIA` markers must move, update the test's markers in the same
  commit and say so.
- Demo fixtures must remain unreachable for a real authenticated user in
  production. If that is not already guaranteed by an env or build assertion, add
  one and cover it with a test.
- `npm run test:all` must pass before this is considered done.

## Definition of done

Airplane mode, cold start, on the actual phone: two taps into the demo, four beats
in under ninety seconds, reset, repeat — ten times without a failure, a spinner, or
a layout shift. Video on the camera roll as backup.
