import { test, expect } from "@playwright/test";
import { signedIn } from "./support/app.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// NOT __dirname: these specs are ESM, where it does not exist. Vitest provides
// a shim so src/test/*.test.js can use it; Playwright does not, and the only
// symptom is a test that fails for a reason unrelated to what it tests.
const HERE = fileURLToPath(new URL(".", import.meta.url));

/**
 * MĪZAN TRADE LAB — the cockpit.
 *
 * The Trade tab had NO e2e coverage until now, for a mundane reason: the
 * default fixture sets `trading_bot: false`, and `TradeBot` returns null for a
 * non-admin, so every existing spec was walking past an empty container and
 * seeing nothing wrong. Five user-facing surfaces once shipped in a week
 * without a human or a machine seeing them render; this is the same hole in
 * the same place, so the fixtures below turn trading ON deliberately.
 */

// Numbers chosen so each assertion below has one unambiguous source: the
// paper desk's equity and the live book's equity must never be confusable.
const PAPER = {
  accountNumber: "PA3ME4FKSILU",
  paper: true,
  source: "user",
  equity: 99999.72,
  cash: 99999.72,
  dayChange: -0.28,
  dayChangePct: -0.00028,
  tradingBlocked: false,
  status: "ACTIVE",
};

// Alpaca returns every numeric as a JSON STRING. The fixtures mirror that
// exactly — a fixture that helpfully used numbers would let a parsing bug
// through, which is the whole failure mode this app has paid for before.
const POSITIONS = [
  { symbol: "SPUS", qty: "12.5", avg_entry_price: "59.88", current_price: "60.41",
    market_value: "755.13", unrealized_pl: "6.63", unrealized_plpc: "0.00885" },
  { symbol: "SPSK", qty: "8", avg_entry_price: "24.10", current_price: "24.02",
    market_value: "192.16", unrealized_pl: "-0.64", unrealized_plpc: "-0.00332" },
];

const ORDERS = [
  { id: "ord-1", symbol: "SPUS", side: "buy", type: "limit", qty: "1",
    filled_qty: "0", status: "new" },
];

const SIGNALS = {
  signals: [
    { id: "sig-1", ticker: "SPUS", side: "buy", qty: 1, status: "pending",
      suggested_price: 59.88, strategy_id: "str-1", created_at: new Date().toISOString() },
  ],
};

function labFixtures(over = {}) {
  return {
    "/api/user/features": {
      trading_bot: true, full_auto: false, is_root: false,
      trading_bot_consented: true, needs_name: false,
      first_name: "Test", last_name: "User",
    },
    "/api/market/session": {
      session: "regular", reason: "open", tradeable: true,
      extendedHours: false, requiresLimit: false, label: "Open",
    },
    "/api/alpaca/account": PAPER,
    "/api/alpaca/positions": POSITIONS,
    "/api/alpaca/orders": ORDERS,
    "/api/bot/signals": SIGNALS,
    "/api/bot/strategies": { strategies: [] },
    "/api/bot/activity": { activity: [] },
    "/api/bot/trades": { trades: [] },
    "/api/bot/full-auto-accounts": { accounts: [] },
    ...over,
  };
}

// Reached by seeding `mizan_nav`, NOT by `?tab=trade`. The deep-link reader
// deliberately omits "trade" (its comment says so: setNav bounces non-admins
// off it anyway), so a ?tab=trade link silently restores whatever localStorage
// held — which is how the first run of this spec spent nine failures sitting
// on Overview. The localStorage reader DOES accept "trade" for admins.
const gotoLab = async (page, opts = {}) => {
  await signedIn(page, {
    fixtures: labFixtures(opts.fixtures),
    theme: opts.theme || "light",
    storage: { mizan_nav: "trade", ...(opts.storage || {}) },
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Command Center", exact: true })).toBeVisible();
};

test.describe("Trade Lab cockpit", () => {
  test("renders the dark cockpit with both desks on the rail", async ({ page }) => {
    await gotoLab(page);

    // The rail states the session, and both desks, at once.
    await expect(page.locator(".mz-rail")).toBeVisible();
    await expect(page.getByText("PAPER · ALPACA")).toBeVisible();
    await expect(page.getByText("LIVE · BROKERAGE")).toBeVisible();
    await expect(page.locator(".mz-rail").getByText("$99,999.72").first()).toBeVisible();

    // The cockpit really is dark, whatever the app theme is. Asserted by
    // COMPUTED colour rather than by class, because a class present with its
    // variables unresolved is the exact bug worth catching here.
    const bg = await page.locator(".mz-cockpit").evaluate(
      el => getComputedStyle(el).backgroundColor);
    const [r, g, b] = bg.match(/\d+/g).map(Number);
    expect(r + g + b, `cockpit should be dark, got ${bg}`).toBeLessThan(180);
  });

  test("stays dark while the rest of the page stays light", async ({ page }) => {
    // The whole premise of the design: a dark instrument panel inside a light
    // app. If the cockpit's variables leaked upward, body would darken too.
    await gotoLab(page, { theme: "light" });
    const sum = async (sel) => {
      const c = await page.locator(sel).first().evaluate(el => getComputedStyle(el).backgroundColor);
      const m = c.match(/\d+/g);
      return m ? m.slice(0, 3).map(Number).reduce((a, x) => a + x, 0) : null;
    };
    expect(await sum(".mz-cockpit")).toBeLessThan(180);
    const body = await sum("body");
    if (body !== null) expect(body, "body must stay on the paper canvas").toBeGreaterThan(600);
  });

  test("parses Alpaca's string numerics into real figures", async ({ page }) => {
    await gotoLab(page);
    const tape = page.locator(".mz-tape").first();
    await expect(tape.getByText("SPUS")).toBeVisible();
    await expect(tape.getByText("SPSK")).toBeVisible();
    // 0.00885 -> +0.89%, which only appears if the string was multiplied by 100.
    await expect(tape.getByText("+0.89%")).toBeVisible();
    // Nothing anywhere may render as a parse failure.
    await expect(page.locator(".mz-cockpit")).not.toContainText("NaN");
    await expect(page.locator(".mz-cockpit")).not.toContainText("undefined");
    await expect(page.locator(".mz-cockpit")).not.toContainText("[object Object]");
  });

  test("surfaces a pending approval on the desk and routes to Signals", async ({ page }) => {
    await gotoLab(page);
    const banner = page.getByRole("button", { name: /SIGNAL AWAITING YOUR APPROVAL/i });
    await expect(banner).toBeVisible();
    await banner.click();
    // Asserted by what actually LEAVES the screen. The first version of this
    // used a try/catch with a fallback assertion, which is a test that cannot
    // fail honestly — and its fallback (`.mz-cockpit` count 0) became
    // permanently false once the cockpit wrapped every sub-tab.
    await expect(page.getByText("EQUITY CURVE")).toHaveCount(0);
    await expect(banner).toHaveCount(0);
  });

  test("weight bars are visibly different lengths AND visible at all", async ({ page }) => {
    // Measured, not eyeballed. The bars were the correct widths while being
    // navy fill on a navy track, so three very different weights looked the
    // same. Width alone would have passed; contrast is the other half.
    await gotoLab(page);
    const bars = page.locator(".mz-wbar > span");
    // Derived from the fixture, never a literal — I wrote 3 here while the
    // fixture held 2 and spent a run finding out.
    await expect(bars).toHaveCount(POSITIONS.length);
    const widths = await bars.evaluateAll(els => els.map(e => e.getBoundingClientRect().width));
    expect(Math.max(...widths) - Math.min(...widths),
      `clearly different weights must look different, got ${widths.map(w => w.toFixed(1))}`).toBeGreaterThan(20);

    const [fill, track] = await page.locator(".mz-wbar").first().evaluate(el => [
      getComputedStyle(el.firstElementChild).backgroundColor,
      getComputedStyle(el).backgroundColor,
    ]);
    const lum = c => { const m = c.match(/\d+/g).map(Number); return 0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]; };
    expect(Math.abs(lum(fill) - lum(track)),
      `fill ${fill} must stand off track ${track}`).toBeGreaterThan(60);
  });

  test("states the desk's value in exactly ONE place", async ({ page }) => {
    // The rail owns "what it is worth" (from /account); the equity chart owns
    // "how it moved" (from /portfolio/history). They are different endpoints
    // and will drift, so only one may state a balance. They once rendered
    // $101,842.17 and $104,202.02 side by side.
    await gotoLab(page, { fixtures: {
      "/api/alpaca/portfolio-history": {
        timestamp: [1, 2, 3], equity: [100000, 100500, 104202.02],
        baseValue: 100000, timeframe: "1D", range: "1M",
      },
    } });
    const chart = page.locator("section", { has: page.locator("svg[aria-label*='equity' i]") });
    await expect(chart).toBeVisible();
    // The curve's own last value must NOT be presented as a balance.
    await expect(chart).not.toContainText("$104,202.02");
    // It states the change instead.
    await expect(chart).toContainText("$4,202.02");
  });

  test("never shows margin buying power", async ({ page }) => {
    // Alpaca quotes 4x cash as buying power. Margin is riba, and the order
    // path refuses it, so a rail advertising it would lie in the user's
    // favour — the worst direction for a trading surface to lie in.
    await gotoLab(page);
    await expect(page.locator(".mz-rail")).not.toContainText(/buying power/i);
    await expect(page.locator(".mz-rail")).toContainText("PAPER CASH");
  });

  test("keeps the original sub-tab IDS, whatever the labels say", async ({ page }) => {
    // This used to assert LABELS, and renaming "Desk" to "Command Center"
    // turned 45 specs red while breaking nothing real. Labels are free to
    // change. IDS are not: mizan_nav, the ?tab= reader, nav_usage counters and
    // every data-tour hook are keyed on them, so renaming one silently orphans
    // its historical counts. So the contract is asserted against the source,
    // where the ids actually live, not against rendered text.
    const src = readFileSync(HERE + "../src/components/MizanApp.jsx", "utf8")
    const bar = src.slice(src.indexOf('TabBar track="trade"'))
    const ids = [...bar.slice(0, 400).matchAll(/\["([a-z]+)","[^"]+"\]/g)].map(m => m[1])
    for (const id of ["desk", "signals", "strategies", "order"]) {
      expect(ids, `sub-tab id "${id}" must survive a rename`).toContain(id)
    }
    // And the labels still render, whatever they currently are.
    await gotoLab(page);
    for (const label of ["Command Center", "Signals", "Strategies", "Quick Trade"]) {
      await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
    }
  });

  test("demo mode removes Trade from the nav entirely", async ({ page }) => {
    // Discovered by running this spec, not by reading the code: in demo mode
    // the Trade destination is absent and a stored mizan_nav of "trade" is
    // bounced to overview. That is the right call — a demo persona with a
    // fabricated paper desk would make the whole point of paper testing
    // meaningless — and it is pinned here so the behaviour is deliberate
    // rather than incidental. It also means any demo-specific copy inside the
    // cockpit would be prose nobody can reach.
    await signedIn(page, {
      fixtures: labFixtures(),
      storage: { mizan_nav: "trade", mizan_demo: "1" },
    });
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Overview", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Trade", exact: true })).toHaveCount(0);
    await expect(page.locator(".mz-cockpit")).toHaveCount(0);
  });

  test("handles an unreachable paper desk without an error state", async ({ page }) => {
    // 403 is ORDINARY here: a user not on the trading allowlist. It must read
    // as "not connected", never as a crash.
    await gotoLab(page, { fixtures: { "/api/alpaca/account": { __status: 403, error: "trading_not_enabled" } } });
    await expect(page.locator(".mz-rail")).toContainText(/not connected/i);
    await expect(page.locator(".mz-cockpit")).not.toContainText("NaN");
  });

  test("survives malformed Alpaca responses without white-screening", async ({ page }) => {
    // THE BUG THIS EXISTS FOR. `(positions || [])` does not catch a truthy
    // NON-array — an error object served with a 200 is exactly that shape —
    // so .map threw and the whole Trade tab fell to the error boundary.
    // Every other spec here passed throughout, because their fixtures were
    // always well-formed arrays. A fixture that is too kind tests nothing.
    await gotoLab(page, { fixtures: {
      "/api/alpaca/positions": { error: "upstream hiccup" },   // object, not array
      "/api/alpaca/orders": { message: "nope" },
      "/api/bot/signals": { signals: "not-an-array" },
      "/api/alpaca/account": [1, 2, 3],                        // array, not object
    } });
    await expect(page.locator(".mz-cockpit")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/SOMETHING WENT WRONG/i);
    await expect(page.locator(".mz-cockpit")).not.toContainText("NaN");
    await expect(page.locator(".mz-cockpit")).not.toContainText("[object Object]");
  });

  test("renders with NO alpaca fixtures at all", async ({ page }) => {
    // The default fixture layer answers an unstubbed /api/** with `{}`. That
    // is the honest worst case for a user whose Alpaca is not configured, and
    // it is what actually produced the white screen.
    await signedIn(page, {
      fixtures: { "/api/user/features": { trading_bot: true, full_auto: false, is_root: false,
        trading_bot_consented: true, needs_name: false, first_name: "T", last_name: "U" } },
      storage: { mizan_nav: "trade" },
    });
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Command Center", exact: true })).toBeVisible();
    await expect(page.locator(".mz-cockpit")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/SOMETHING WENT WRONG/i);
  });

  test("names the desk an order would actually hit", async ({ page }) => {
    // The ticket defaults to LIVE · SnapTrade while the rail's biggest number
    // is the PAPER balance. Nothing connected the two, so "which desk am I
    // on" was something you had to infer on a surface that can place a real
    // order. The armed marker is only shown on the order ticket.
    await gotoLab(page);
    await expect(page.locator(".mz-rail-armed")).toHaveCount(0);   // not on the Desk

    await page.getByRole("button", { name: "Quick Trade", exact: true }).click();
    await expect(page.locator(".mz-rail-armed")).toHaveCount(1);
    await expect(page.locator(".mz-rail-armed")).toContainText("ARMED");
    // Default venue is the LIVE brokerage, so that is what must be marked.
    await expect(page.locator(".mz-rail-armed")).toContainText("LIVE");
  });

  test("states the alpha even when it is NEGATIVE", async ({ page }) => {
    // The proposal is explicit: never hide a losing strategy behind a
    // flattering win rate. Real numbers from 2026-10-02 — strategy +0.604%,
    // SPUS +1.474%, so the honest headline is a red -0.87pp.
    await gotoLab(page, { fixtures: {
      "/api/alpaca/portfolio-history": {
        timestamp: [Date.parse("2026-10-01T20:00:00Z") / 1000, Date.parse("2026-10-02T20:00:00Z") / 1000],
        equity: [100000, 100603.26], baseValue: 100000, timeframe: "1D", range: "1M",
      },
      "/api/alpaca/benchmark": { symbol: "SPUS", range: "1M", points: [
        { t: Date.parse("2026-10-01T20:00:00Z"), v: 59.72 },
        { t: Date.parse("2026-10-02T20:00:00Z"), v: 60.60 },
      ] },
    } });
    await page.getByRole("button", { name: "Performance", exact: true }).click();
    const perf = page.locator(".mz-cockpit");
    await expect(perf).toContainText("0.87");
    await expect(perf).toContainText(/behind/i);
    // And it must not dress two days up as a result.
    await expect(perf).toContainText(/noise, not evidence/i);
  });

  test("refuses to compute alpha from a single day", async ({ page }) => {
    // One aligned day is a point, not a comparison. Inventing a number here is
    // exactly the dishonesty the panel exists to prevent.
    await gotoLab(page, { fixtures: {
      "/api/alpaca/portfolio-history": {
        timestamp: [Date.parse("2026-10-02T20:00:00Z") / 1000], equity: [100603.26],
        baseValue: 100000, timeframe: "1D", range: "1M",
      },
      "/api/alpaca/benchmark": { symbol: "SPUS", range: "1M",
        points: [{ t: Date.parse("2026-10-02T20:00:00Z"), v: 60.60 }] },
    } });
    await page.getByRole("button", { name: "Performance", exact: true }).click();
    await expect(page.locator(".mz-cockpit")).toContainText(/not enough overlapping days/i);
    // Specifically: no alpha FIGURE. The first version asserted the cockpit
    // contained no "pp" at all, which the panel's own sentence ("not enough
    // overlapping days") violates — a two-character substring is not an
    // assertion, it is a coincidence waiting to happen.
    await expect(page.locator(".mz-cockpit")).not.toContainText(/[+\u2212-]?\d+\.\d{2}\s*pp/);
  });

  test("AI committee shows each analyst separately and names disagreement", async ({ page }) => {
    // The proposal's §23 in one line: never hide disagreement behind a single
    // AI recommendation. BUY-vs-SELL is a contradiction; BUY-vs-HOLD is a
    // difference of conviction. They must not render identically.
    const per = (p, a, c) => ({ provider: p, model: p, action: a, confidence: c, risk_flags: [] });
    await gotoLab(page, { fixtures: { "/api/ai/research": {
      providers: [{ provider: "anthropic", model: "c", available: true },
                  { provider: "google", model: "g", available: true }],
      configured: 2, required: 2,
      rows: [
        { id: "1", ticker: "MU", at: "2026-10-02T13:35:00Z", price: 100, packet_hash: "abc123", missing: [],
          ensemble: { ok: true, consensus: "HOLD", unanimous: false, opposed: true,
                      per_model: [per("anthropic", "BUY", 0.64), per("google", "SELL", 0.58)] } },
        { id: "2", ticker: "TER", at: "2026-10-02T13:35:00Z", price: 100, packet_hash: "abc123", missing: [],
          ensemble: { ok: true, consensus: "HOLD", unanimous: false, opposed: false,
                      per_model: [per("anthropic", "BUY", 0.70), per("google", "HOLD", 0.45)] } },
      ],
    } } });
    await page.getByRole("button", { name: "AI Committee", exact: true }).click();
    const t = page.locator(".mz-cockpit");
    // Each analyst is its own column, by name.
    await expect(t).toContainText("ANTHROPIC");
    await expect(t).toContainText("GOOGLE");
    // Contradiction and mere difference are labelled differently.
    await expect(t).toContainText("OPPOSED");
    await expect(t).toContainText("SPLIT");
  });

  test("says how many analysts are missing, rather than showing fewer quietly", async ({ page }) => {
    // One model is not a committee. A panel running short must say so.
    await gotoLab(page, { fixtures: { "/api/ai/research": {
      providers: [{ provider: "anthropic", model: "c", available: true },
                  { provider: "google", model: "g", available: false }],
      configured: 1, required: 2, rows: [],
    } } });
    await page.getByRole("button", { name: "AI Committee", exact: true }).click();
    const t = page.locator(".mz-cockpit");
    await expect(t).toContainText("1 OF 2 ANALYSTS CONFIGURED");
    await expect(t).toContainText(/one model is not a committee/i);
    await expect(t).toContainText(/not configured: google/i);
  });

  test("no overflow at 320px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await gotoLab(page);
    // html{overflow-x:clip} means over-wide content is silently CLIPPED with
    // no scrollbar, so this is invisible by eye and must be measured.
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "page must not overflow horizontally at 320px").toBeLessThanOrEqual(1);
  });
});

/**
 * Risk — the tiles must carry FIGURES.
 *
 * All three first shipped rendering "—". <Signed/> takes a numeric `v` and
 * silently falls back to its dash for anything else, and I passed it
 * label/value/sub, which it ignores. Build passed, 1073 unit tests passed,
 * and the headline numbers of the panel were three dashes. Only a screenshot
 * showed it — so this asserts the rendered text, not the component tree.
 */
test.describe("Trade Lab risk", () => {
  const BOOK = [
    ["NVDA", 4100, "Semiconductors"], ["AMD", 3900, "Semiconductors"],
    ["MU", 4200, "Semiconductors"], ["AVGO", 4000, "Semiconductors"],
    ["COHR", 3800, "Semiconductors"], ["CRDO", 4100, "Semiconductors"],
    ["STX", 3950, "Computer Hardware"], ["NTAP", 4050, "Computer Hardware"],
    ["TGT", 3900, "Retail"], ["ZZZZ", 900, null],
  ];
  const riskFixtures = {
    "/api/alpaca/positions": BOOK.map(([symbol, mv]) => ({
      symbol, qty: "1", avg_entry_price: "1", current_price: "1",
      market_value: String(mv), unrealized_pl: "0", unrealized_plpc: "0" })),
    "/api/alpaca/portfolio-history": { points: Array.from({ length: 22 }, (_, i) => ({
      date: `2026-09-${String(i + 10).padStart(2, "0")}`,
      equity: 100000 + (i < 8 ? i * 900 : i < 14 ? 7200 - (i - 8) * 1400 : -1200 + (i - 14) * 700) })) },
    "/api/screen": { provider: "finnhub", results: Object.fromEntries(
      BOOK.filter((b) => b[2]).map(([s2, , ind]) =>
        [s2, { tk: s2, status: "halal", industry: ind, byStandard: {} }])) },
  };

  const openRisk = async (page, extra = {}) => {
    await gotoLab(page, { fixtures: { ...riskFixtures, ...extra } });
    await page.getByRole("button", { name: "Risk", exact: true }).click();
    await page.waitForTimeout(1500);
    return page.locator(".mz-cockpit").innerText();
  };

  test("every headline tile shows a figure, never a dash", async ({ page }) => {
    const txt = await openRisk(page);
    for (const label of ["EFFECTIVE NAMES", "TOP 5 WEIGHT", "MAX DRAWDOWN"]) {
      const v = new RegExp(`${label}\\s*\\n\\s*([^\\n]+)`).exec(txt)?.[1]?.trim();
      expect(v, `${label} rendered as "${v}"`).toBeTruthy();
      expect(v, `${label} fell back to a dash`).not.toBe("—");
      expect(v, `${label} is not a figure`).toMatch(/[0-9]/);
    }
  });

  test("states industry coverage instead of hiding unclassified names", async ({ page }) => {
    const txt = await openRisk(page);
    // 9 of 10 carry an industry; the panel must say so rather than quietly
    // computing shares over 90% of the book and presenting them as the whole.
    expect(txt).toContain("90% CLASSIFIED");
    expect(txt).toMatch(/1 could not be classified/);
    expect(txt).not.toMatch(/\bOther\b/);     // no catch-all bucket
  });

  test("reports concentration the even weights hide", async ({ page }) => {
    const txt = await openRisk(page);
    expect(txt).toContain("Semiconductors");
    // Six of ten names, one bet — the number that justifies the screen.
    expect(txt).toMatch(/66\.9%/);
  });

  test("says NOT YET rather than 0% when history is too short", async ({ page }) => {
    // A new account has not had a 0% drawdown; it has had no measurable one.
    const txt = await openRisk(page, {
      "/api/alpaca/portfolio-history": { points: [{ date: "2026-10-01", equity: 100000 }] },
    });
    const v = /MAX DRAWDOWN\s*\n\s*([^\n]+)/.exec(txt)?.[1]?.trim();
    expect(v).toBe("not yet");
    expect(txt).toMatch(/not the same as a 0% drawdown/);
  });
});
