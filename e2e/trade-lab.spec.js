import { test, expect } from "@playwright/test";
import { signedIn } from "./support/app.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// NOT __dirname: these specs are ESM, where it does not exist. Vitest provides
// a shim so src/test/*.test.js can use it; Playwright does not, and the only
// symptom is a test that fails for a reason unrelated to what it tests.
const HERE = fileURLToPath(new URL(".", import.meta.url));

/**
 * MĪZAN TRADE LAB — the broadsheet (was the dark cockpit until 2026-10-08).
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
    "/api/bot/activity": { items: [] },
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
  // Routes a spec must own from the FIRST request (registered after the
  // fixture layer, so they win) — the Desk screens holdings on load.
  if (opts.before) await opts.before(page);
  await page.goto("/");
  await expect(labNav(page)).toBeVisible();
};

// Twelve sections became eight (2026-10-08). Specs written against the old
// names go through here, so a rename is one table rather than forty edits.
const labNav = (page) => page.getByRole("navigation", { name: "Trade Lab sections" });
const SECTION = { "Command Center": "Desk", Signals: "Orders", "Quick Trade": "Orders", "AI Committee": "Research",
  Risk: "Compliance & Risk", Compliance: "Compliance & Risk", Portfolio: "Positions" };
const openSection = async (page, name) => {
  await labNav(page).getByRole("button", { name: SECTION[name] || name, exact: true }).click();
  if (name === "Quick Trade") await page.getByRole("button", { name: "Open the ticket" }).click();
};

test.describe("Trade Lab cockpit", () => {
  test("opens on the Desk: masthead, order pipeline, figures", async ({ page }) => {
    await gotoLab(page);
    await expect(page.getByRole("heading", { name: "The Trade Lab" })).toBeVisible();
    const pipe = page.getByTestId("order-pipeline");
    for (const gate of ["Market", "AI committee", "Strategies", "Sharia gate", "Cash", "Brokers"]) await expect(pipe).toContainText(gate);
    await expect(pipe).toContainText("no margin");
    // The paper equity, from /account, rounded to dollars on the desk.
    await expect(page.getByTestId("desk-figures")).toContainText("$100,000");
    await expect(page.getByTestId("desk-figures")).toContainText("the buying limit");
  });

  test("follows the app theme instead of forcing a dark room", async ({ page }) => {
    // The cockpit forced dark on itself; the broadsheet is Mizan's paper.
    const sum = async (sel) => {
      const c = await page.locator(sel).first().evaluate(el => getComputedStyle(el).backgroundColor);
      const m = c.match(/\d+/g);
      return m ? m.slice(0, 3).map(Number).reduce((a, x) => a + x, 0) : null;
    };
    const ink = async () => {
      const c = await page.locator(".mz-mast h1").evaluate(el => getComputedStyle(el).color);
      return c.match(/\d+/g).slice(0, 3).map(Number).reduce((a, x) => a + x, 0);
    };
    await gotoLab(page, { theme: "light" });
    expect(await sum("body"), "light theme keeps the paper canvas").toBeGreaterThan(600);
    expect(await ink(), "ink on paper").toBeLessThan(200);
    await gotoLab(page, { theme: "dark" });
    expect(await ink(), "light ink on the dark theme").toBeGreaterThan(500);
  });

  test("the masthead uses the newspaper face, and only the lab does", async ({ page }) => {
    await gotoLab(page);
    const ff = await page.locator(".mz-mast h1").evaluate(el => getComputedStyle(el).fontFamily);
    expect(ff).toMatch(/Newsreader/);
  });

  test("downloads the closed-trades tax & Zakat sheet at the rates the user set", async ({ page }) => {
    await gotoLab(page);
    await openSection(page, "Journal");
    let asked = null;
    await page.route("**/api/alpaca/closed-trades.csv**", (route) => {
      asked = new URL(route.request().url()).searchParams;
      return route.fulfill({ status: 200, contentType: "text/csv", body: "symbol,qty\r\nTOTAL,\r\n" });
    });
    await expect(page.getByText("Closed trades — tax & Zakat sheet")).toBeVisible();
    await page.getByLabel("SHORT-TERM tax rate percent").fill("32");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /DOWNLOAD SHEET/ }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^mizan-closed-trades-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(asked.get("short")).toBe("32");
    expect(asked.get("long")).toBe("15");
  });

  test("says so, with a retry, when the sheet cannot be built", async ({ page }) => {
    await gotoLab(page);
    await page.route("**/api/alpaca/closed-trades.csv**", (route) =>
      route.fulfill({ status: 502, contentType: "application/json", body: '{"error":"x"}' }));
    await openSection(page, "Journal");
    await page.getByRole("button", { name: /DOWNLOAD SHEET/ }).click();
    await expect(page.getByRole("alert")).toContainText("could not be built");
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  test("parses Alpaca's string numerics into real figures", async ({ page }) => {
    await gotoLab(page);
    await openSection(page, "Portfolio");
    const tape = page.locator(".mz-tape").first();
    await expect(tape.getByText("SPUS")).toBeVisible();
    await expect(tape.getByText("SPSK")).toBeVisible();
    // 0.00885 -> +0.89%, which only appears if the string was multiplied by 100.
    await expect(tape.getByText("+0.89%")).toBeVisible();
    // Nothing anywhere may render as a parse failure.
    await expect(page.locator(".mz-lab")).not.toContainText("NaN");
    await expect(page.locator(".mz-lab")).not.toContainText("undefined");
    await expect(page.locator(".mz-lab")).not.toContainText("[object Object]");
  });

  test("surfaces a pending approval on the desk and routes to Signals", async ({ page }) => {
    await gotoLab(page);
    const banner = page.getByRole("button", { name: /SIGNAL AWAITING YOUR APPROVAL/i });
    await expect(banner).toBeVisible();
    await banner.click();
    // Asserted by what actually LEAVES the screen. The first version of this
    // used a try/catch with a fallback assertion, which is a test that cannot
    // fail honestly — and its fallback (`.mz-lab` count 0) became
    // permanently false once the cockpit wrapped every sub-tab.
    await expect(page.getByTestId("broadsheet-desk")).toHaveCount(0);
    await expect(banner).toHaveCount(0);
    await expect(labNav(page).getByRole("button", { name: "Orders" })).toHaveAttribute("aria-current", "page");
  });

  test("weight bars are visibly different lengths AND visible at all", async ({ page }) => {
    // Measured, not eyeballed. The bars were the correct widths while being
    // navy fill on a navy track, so three very different weights looked the
    // same. Width alone would have passed; contrast is the other half.
    await gotoLab(page);
    await openSection(page, "Portfolio");
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
      // The curve now ends at the rail's live equity (pinLiveEquity), so the
      // two can no longer drift apart — and the chart still states only the change.
      "/api/alpaca/account": { ...PAPER, equity: 104202.02 },
    } });
    await openSection(page, "Portfolio");
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
    await expect(page.locator(".mz-lab")).not.toContainText(/buying power/i);
    await openSection(page, "Quick Trade");
    await expect(page.getByTestId("order-ticket")).not.toContainText(/buying power/i);
  });

  test("keeps the original sub-tab IDS, whatever the labels say", async ({ page }) => {
    // This used to assert LABELS, and renaming "Desk" to "Command Center"
    // turned 45 specs red while breaking nothing real. Labels are free to
    // change. IDS are not: mizan_nav, the ?tab= reader, nav_usage counters and
    // every data-tour hook are keyed on them, so renaming one silently orphans
    // its historical counts. So the contract is asserted against the source,
    // where the ids actually live, not against rendered text.
    const src = readFileSync(HERE + "../src/components/MizanApp.jsx", "utf8")
    const table = src.slice(src.indexOf("const LAB_SECTIONS=["), src.indexOf("const LAB_SECTIONS=[") + 600)
    const ids = [...table.matchAll(/\["([a-z]+)","[^"]+"/g)].map(m => m[1])
    for (const id of ["desk", "signals", "strategies", "committee", "compliance", "performance"]) {
      expect(ids, `section id "${id}" must survive a rename`).toContain(id)
    }
    // Folded sections still resolve, so stored state and deep links land somewhere.
    expect(src).toMatch(/LAB_REDIRECT=\{order:"signals",risk:"compliance"\}/)
    await gotoLab(page);
    for (const label of ["Desk", "Orders", "Strategies", "Research", "Compliance & Risk", "Journal"]) {
      await expect(labNav(page).getByRole("button", { name: label, exact: true })).toBeVisible();
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
    await expect(page.locator(".mz-lab")).toHaveCount(0);
  });

  test("handles an unreachable paper desk without an error state", async ({ page }) => {
    // 403 is ORDINARY here: a user not on the trading allowlist. It must read
    // as "not connected", never as a crash.
    await gotoLab(page, { fixtures: { "/api/alpaca/account": { __status: 403, error: "trading_not_enabled" } } });
    await expect(page.getByTestId("order-pipeline")).toContainText("Alpaca unreachable");
    await expect(page.getByTestId("desk-figures")).toContainText("paper desk not read");
    await expect(page.locator(".mz-lab")).not.toContainText("NaN");
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
    await expect(page.locator(".mz-lab")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/SOMETHING WENT WRONG/i);
    await expect(page.locator(".mz-lab")).not.toContainText("NaN");
    await expect(page.locator(".mz-lab")).not.toContainText("[object Object]");
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
    await expect(labNav(page)).toBeVisible();
    await expect(page.locator(".mz-lab")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/SOMETHING WENT WRONG/i);
  });

  test("names the desk an order would actually hit", async ({ page }) => {
    // The ticket used to default to LIVE · SnapTrade while the rail's biggest number
    // is the PAPER balance. Nothing connected the two, so "which desk am I
    // on" was something you had to infer on a surface that can place a real
    // order. The armed marker is only shown on the order ticket.
    await gotoLab(page);
    // Stated in words beside the send button (the gold ARMED rail cell is gone).
    await expect(page.getByTestId("ticket-venue")).toHaveCount(0);   // not on the Desk
    await openSection(page, "Signals");
    await expect(page.getByTestId("ticket-venue")).toHaveCount(0);   // nor in Orders until the ticket opens
    await page.getByRole("button", { name: "Open the ticket" }).click();
    // Default venue is PAPER (owner, 2026-10-08), so that is what it must say.
    await expect(page.getByTestId("ticket-venue")).toContainText("Alpaca paper");
    await expect(page.getByTestId("ticket-venue")).toContainText("no real money");
  });

  test("an explicit LIVE choice is remembered; the default is never live", async ({ page }) => {
    await gotoLab(page, { storage: { mizan_trade_venue: "snaptrade" } });
    await openSection(page, "Quick Trade");
    await expect(page.getByTestId("ticket-venue")).toContainText("This is real money");
  });

  test("states the alpha even when it is NEGATIVE", async ({ page }) => {
    // The proposal is explicit: never hide a losing strategy behind a
    // flattering win rate. Real numbers from 2026-10-02 — strategy +0.604%,
    // SPUS +1.474%, so the honest headline is a red -0.87pp.
    await gotoLab(page, { fixtures: {
      "/api/alpaca/portfolio-history": {
        // Real stamps: an equity close lands at 00:00Z the NEXT UTC day
        // (20:00 ET); a SPUS bar at 04:00Z of its own day (00:00 ET). The old
        // 20:00Z fixture hid a one-day misalignment in production.
        timestamp: [Date.parse("2026-10-02T00:00:00Z") / 1000, Date.parse("2026-10-03T00:00:00Z") / 1000],
        equity: [100000, 100603.26], baseValue: 100000, timeframe: "1D", range: "1M",
      },
      "/api/alpaca/benchmark": { symbol: "SPUS", range: "1M", points: [
        { t: Date.parse("2026-10-01T04:00:00Z"), v: 59.72 },
        { t: Date.parse("2026-10-02T04:00:00Z"), v: 60.60 },
      ] },
    } });
    await openSection(page, "Performance");
    const perf = page.locator(".mz-lab");
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
    await openSection(page, "Performance");
    await expect(page.locator(".mz-lab")).toContainText(/not enough overlapping days/i);
    // Specifically: no alpha FIGURE. The first version asserted the cockpit
    // contained no "pp" at all, which the panel's own sentence ("not enough
    // overlapping days") violates — a two-character substring is not an
    // assertion, it is a coincidence waiting to happen.
    await expect(page.locator(".mz-lab")).not.toContainText(/[+\u2212-]?\d+\.\d{2}\s*pp/);
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
    await openSection(page, "AI Committee");
    const t = page.locator(".mz-lab");
    // Each analyst is its own column, by the name a person knows (2026-10-08:
    // provider names became analyst names — CLAUDE, not ANTHROPIC).
    await expect(t).toContainText("CLAUDE");
    await expect(t).toContainText("GEMINI");
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
    await openSection(page, "AI Committee");
    const t = page.locator(".mz-lab");
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
    // The REAL server shape: { timestamp[] (unix s), equity[] }. The previous
    // fixture used { points:[{date,equity}] } — the same wrong shape the panel
    // read, so this passed while production always showed "not yet".
    "/api/alpaca/portfolio-history": {
      timestamp: Array.from({ length: 22 }, (_, i) => Date.parse(`2026-09-${String(i + 10).padStart(2, "0")}T00:00:00Z`) / 1000),
      equity: Array.from({ length: 22 }, (_, i) => 100000 + (i < 8 ? i * 900 : i < 14 ? 7200 - (i - 8) * 1400 : -1200 + (i - 14) * 700)),
      baseValue: 100000, timeframe: "1D", range: "1M" },
    "/api/screen": { provider: "finnhub", results: Object.fromEntries(
      BOOK.filter((b) => b[2]).map(([s2, , ind]) =>
        [s2, { tk: s2, status: "halal", industry: ind, byStandard: {} }])) },
  };

  const openRisk = async (page, extra = {}) => {
    await gotoLab(page, { fixtures: { ...riskFixtures, ...extra } });
    await openSection(page, "Risk");
    await page.waitForTimeout(1500);
    return page.locator(".mz-lab").innerText();
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
      "/api/alpaca/portfolio-history": { timestamp: [Date.parse("2026-10-01T00:00:00Z") / 1000], equity: [100000], baseValue: 100000, timeframe: "1D", range: "1M" },
    });
    const v = /MAX DRAWDOWN\s*\n\s*([^\n]+)/.exec(txt)?.[1]?.trim();
    expect(v).toBe("not yet");
    expect(txt).toMatch(/not the same as a 0% drawdown/);
  });
});

// The scoreboard. A strategy card must answer "is this beating SPUS?" and must
// never report an unfunded strategy as a total loss — before 2026-10-07 it
// computed (stock value − capital), so every new strategy read −100%.
test.describe("Trade Lab strategy scoreboard", () => {
  const base = { mode: "semi", enabled: true, ticker: "SPUS", account_id: "alpaca-paper", strategy_type: "rank_rebalance",
    stop_loss_pct: 15, profit_target_pct: null, time_horizon_days: 180, max_trades_per_day: 30 };
  const strategies = { strategies: [
    { ...base, id: "s-traded", capital_allocated: 95000,
      params: { broker: "alpaca_paper", rebalance_days: 7, universe_tickers: ["ADI", "MU"] },
      progress: { paper: true, current_value: 97113.79, cash: 0.27, equity: 97114.06, started_at: "2026-10-02T13:30:18Z",
        return_pct: 2.2253, bench_return_pct: 1.8255, alpha_pct: 0.3998, benchmark: "SPUS",
        trades_executed: 25, days_elapsed: 5, days_horizon: 180, holdings_count: 25, unpriced: [] } },
    { ...base, id: "s-new", capital_allocated: 250000,
      params: { broker: "alpaca_paper", rebalance_days: 30, universe_tickers: ["ADI", "MU"] },
      progress: { paper: true, current_value: 0, cash: 250000, equity: 250000, started_at: null,
        return_pct: null, bench_return_pct: null, alpha_pct: null, trades_executed: 0, days_elapsed: 0, days_horizon: 180 } },
  ] };

  const openStrategies = async (page) => {
    await gotoLab(page, { fixtures: { "/api/bot/strategies": strategies } });
    await openSection(page, "Strategies");
  };

  test("an unfunded strategy says so instead of showing a −100% loss", async ({ page }) => {
    await openStrategies(page);
    await expect(page.getByTestId("strategy-row").filter({ hasNotText: "+2.23%" })).toContainText("not traded yet");
    const txt = await page.locator(".mz-lab").innerText();
    expect(txt).not.toMatch(/−\$?250,000|-100\.00%|−100/);
  });

  test("a traded strategy states its return against SPUS over the same window", async ({ page }) => {
    await openStrategies(page);
    const row = page.getByTestId("strategy-vs-bench");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("+2.23%");
    await expect(row).toContainText("SPUS +1.83%");
    await expect(row).toContainText("+0.40 pts vs SPUS");
  });
});

/**
 * Compliance, 2026-10-07: the tab sat on SCREENING… for 15s+ and then showed
 * 7 of 27 holdings blank. It re-screened every holding on every visit and
 * waited for all of it, and a throttled answer overwrote good cached verdicts.
 * Now: today's cache renders at once, only the rest is asked for, and what the
 * server marks "pending" is asked for again until it settles.
 */
test.describe("Trade Lab compliance", () => {
  const verdict = (tk, aaoifi = true) => ({ tk, status: "halal", asOf: new Date().toISOString().slice(0, 10), engine: 2,
    byStandard: { AAOIFI: { pass: aaoifi }, DJIM: { pass: true }, SP_SHARIAH: { pass: true }, FTSE_SHARIAH: { pass: true },
      MSCI_ISLAMIC: { pass: true }, SC_MALAYSIA: { pass: true }, IFSB: { pass: true } } });
  const positions = ["STX", "TER", "MU"].map((symbol) => ({ symbol, qty: "1", avg_entry_price: "1",
    current_price: "1", market_value: "1000", unrealized_pl: "0", unrealized_plpc: "0" }));

  test("fills in holdings the server marked pending, without a reload", async ({ page }) => {
    let calls = 0;
    let release;
    const held = new Promise((r) => { release = r; });
    await gotoLab(page, { fixtures: { "/api/alpaca/positions": positions }, before: (pg) => pg.route("**/api/screen", async (route) => {
      calls++;
      // The second round waits until the first one has been seen rendered.
      if (calls === 2) await held;
      const asked = JSON.parse(route.request().postData() || "{}").symbols || [];
      const results = Object.fromEntries(asked.map((tk) => [tk,
        calls === 1 && tk !== "STX" ? { tk, status: "unknown", reason: "pending" } : verdict(tk)]));
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ provider: "finnhub", results }) });
    }) });
    await openSection(page, "Compliance");
    const cockpit = page.locator(".mz-lab");
    await expect(cockpit).toContainText("1/3 SCREENED");          // renders what it has at once
    await expect(cockpit).not.toContainText("could not be screened"); // not while still asking
    release();
    await expect(cockpit).toContainText("3/3 SCREENED", { timeout: 10000 });
    // One screening read for the whole tab: the Desk and this page share it,
    // so the pending names are asked for exactly once more — not once per panel.
    expect(calls).toBe(2);
  });

  test("renders today's cached verdicts at once and never re-asks for them", async ({ page }) => {
    const cache = { STX: verdict("STX"), TER: verdict("TER") };
    const asked = [];
    await gotoLab(page, { fixtures: { "/api/alpaca/positions": positions },
      storage: { mizan_aaoifi_cache: JSON.stringify(cache) }, before: (pg) => pg.route("**/api/screen", (route) => {
        asked.push(...(JSON.parse(route.request().postData() || "{}").symbols || []));
        // Throttled — must not erase the cached verdicts.
        route.fulfill({ status: 200, contentType: "application/json",
          body: JSON.stringify({ provider: "finnhub", results: { MU: { tk: "MU", status: "unknown", reason: "finnhub_unavailable:429" } } }) });
      }) });
    await openSection(page, "Compliance");
    await expect(page.locator(".mz-lab")).toContainText("2/3 SCREENED");
    expect(asked.every((tk) => tk === "MU")).toBe(true);
  });

  test("re-screens a verdict cached by the old engine, even one dated today", async ({ page }) => {
    // Production, 2026-10-07: degraded "review" verdicts from throttled
    // screens sat in the cache stamped today, so 7 holdings stayed blank.
    const today = new Date().toISOString().slice(0, 10);
    const stale = Object.fromEntries(["STX", "TER", "MU"].map((tk) => [tk, { tk, status: "review", asOf: today, byStandard: {} }]));
    await gotoLab(page, { fixtures: { "/api/alpaca/positions": positions }, storage: { mizan_aaoifi_cache: JSON.stringify(stale) },
      before: (pg) => pg.route("**/api/screen", (route) => {
        const asked = JSON.parse(route.request().postData() || "{}").symbols || [];
        route.fulfill({ status: 200, contentType: "application/json",
          body: JSON.stringify({ provider: "finnhub", results: Object.fromEntries(asked.map((tk) => [tk, verdict(tk)])) }) });
      }) });
    await openSection(page, "Compliance");
    await expect(page.locator(".mz-lab")).toContainText("3/3 SCREENED");
  });
});

// Production, 2026-10-07: a new $1M paper desk headlined "+$1,000,000.00 OVER
// 1M" — Alpaca reports 0 equity for the days before funding, and the change
// was measured from them.
test("equity curve measures from funding, not from the zero days before it", async ({ page }) => {
  const day = (d) => Date.parse(`2026-10-0${d}T00:00:00Z`) / 1000;
  await gotoLab(page, { fixtures: { "/api/alpaca/portfolio-history": {
    timestamp: [day(3), day(4), day(5), day(6), day(7)], equity: [0, 0, 0, 1000000, 1006000],
    baseValue: 0, timeframe: "1D", range: "1M" },
    "/api/alpaca/account": { ...PAPER, equity: 1006000 } } });
  await openSection(page, "Portfolio");
  const cockpit = page.locator(".mz-lab");
  await expect(cockpit).toContainText("+$6,000.00");
  await expect(cockpit).not.toContainText("1,000,000.00 OVER");
  await expect(cockpit).not.toContainText("INTERVALS RECORDED");
});

// Production, 2026-10-07 evening: Alpaca's daily history had no point for the
// session just traded, so a desk up $6,181 charted "$0.00 OVER 1M".
test("equity curve ends at the desk's live equity when history lags a session", async ({ page }) => {
  const day = (d) => Date.parse(`2026-10-0${d}T00:00:00Z`) / 1000;
  await gotoLab(page, { fixtures: {
    "/api/alpaca/portfolio-history": { timestamp: [day(6), day(7)], equity: [1000000, 1000000], baseValue: 1000000, timeframe: "1D", range: "1M" },
    "/api/alpaca/account": { ...PAPER, equity: 1006181.11 } } });
  await openSection(page, "Portfolio");
  await expect(page.locator(".mz-lab")).toContainText("+$6,181.11");
});

/**
 * The strategy book (2026-10-08). Six-plus strategies share one paper pot;
 * the desk used to show only the account, and the Strategies cards were all
 * titled "214 halal names". Fixtures are production-shaped rows, including
 * the two defects found while building it: an unpriced position (read as
 * −100%) and a multi-sleeve experiment (E) with no combined line.
 */
test.describe("Trade Lab strategy book", () => {
  const prog = (o) => ({ paper: true, trades_executed: 5, started_at: "2026-10-07T13:33:38Z", holdings_count: 15, ...o });
  const STRATS = [
    { id: "a7728bbe-0000-4000-8000-000000000001", strategy_type: "rank_rebalance", enabled: true, mode: "semi", capital_allocated: "250000.00",
      params: { experiment: "A: reference system + AI gate", broker: "alpaca_paper", ai_gate: true, rebalance_days: 30, last_rebalance: "2026-10-07" },
      progress: prog({ equity: 252557.84, return_pct: 1.0231, bench_return_pct: -0.0981, alpha_pct: 1.1212 }) },
    { id: "258e0b74-0000-4000-8000-000000000002", strategy_type: "breakout", enabled: true, mode: "semi", capital_allocated: "150000.00",
      params: { experiment: "D: swing", broker: "alpaca_paper" },
      progress: prog({ equity: null, return_pct: null, unpriced: ["ISRG"], held_ticker: "ISRG", holdings_count: undefined, current_value: 0 }) },
    { id: "61b0f343-0000-4000-8000-000000000003", strategy_type: "rank_rebalance", enabled: true, mode: "semi", capital_allocated: "70000.00",
      params: { experiment: "E · core: A + C combined, whole shares", experiment_group: "E", broker: "alpaca_paper", rebalance_days: 30, last_rebalance: "2026-10-08" },
      progress: prog({ equity: 71400, return_pct: 2, bench_return_pct: 0.5, alpha_pct: 1.5 }) },
    { id: "0a1474b4-0000-4000-8000-000000000004", strategy_type: "breakout", enabled: true, mode: "semi", capital_allocated: "30000.00",
      params: { experiment: "E · swing: D + volume confirmation", experiment_group: "E", broker: "alpaca_paper" },
      progress: prog({ equity: 29700, return_pct: -1, bench_return_pct: 0.5, alpha_pct: -1.5, holdings_count: 1 }) },
    { id: "d8a3e542-0000-4000-8000-000000000005", strategy_type: "rank_rebalance", enabled: true, mode: "semi", capital_allocated: "0",
      nl_description: "SHADOW research panel. Runs Anthropic + Gemini", params: { layer: "shadow", broker: "alpaca_paper" },
      progress: { paper: true, trades_executed: 0 } },
  ];
  const ACTIVITY = { items: [
    { id: "o1", strategy_id: STRATS[0].id, ticker: "MU", side: "buy", qty: 34.5464, status: "executed", created_at: "2026-10-07T13:33:38Z", executed_at: "2026-10-07T13:33:40Z" },
    { id: "r1", strategy_id: STRATS[4].id, ticker: "COHR", side: "buy", qty: 0, status: "shadow", created_at: "2026-10-07T17:46:33Z" },
    { id: "o2", strategy_id: STRATS[1].id, ticker: "ISRG", side: "buy", qty: 361, status: "executed", created_at: "2026-10-07T14:00:07Z" },
  ] };
  const open = async (page, section = "Portfolio") => {
    await gotoLab(page, { fixtures: { "/api/bot/strategies": { strategies: STRATS }, "/api/bot/activity": ACTIVITY,
      "/api/alpaca/account": { ...PAPER, equity: 1000000 } } });
    if (section) await openSection(page, section);
  };

  test("names every strategy and states its return against SPUS", async ({ page }) => {
    await open(page);
    const book = page.getByTestId("strategy-book");
    await expect(book.getByTestId("book-row")).toHaveCount(5);
    await expect(book).toContainText("Reference system + AI gate");
    await expect(book).toContainText("+1.02%");
    await expect(book).toContainText("+1.12 pts");
    await expect(book).toContainText("shadow · records only");
  });

  test("an unpriced position reads PRICE N/A, never a −100% loss", async ({ page }) => {
    await open(page);
    const d = page.getByTestId("book-row").filter({ hasText: "Swing" }).first();
    await expect(d).toContainText("PRICE N/A");
    await expect(page.getByTestId("strategy-book")).not.toContainText("-100");
  });

  test("a multi-sleeve experiment gets one combined line", async ({ page }) => {
    await open(page);
    const g = page.getByTestId("book-group");
    await expect(g).toContainText("Combined");
    await expect(g).toContainText("+1.10%");
  });

  test("the allocation bar states what is unallocated", async ({ page }) => {
    await open(page);
    await expect(page.getByTestId("strategy-book")).toContainText(/UNALLOCATED \$500,000/);
  });

  test("the activity tape shows orders by strategy code and leaves AI reviews out", async ({ page }) => {
    await open(page, "Journal");
    const tape = page.getByTestId("activity-tape");
    await expect(tape).toContainText("MU");
    await expect(tape).toContainText("ISRG");
    await expect(tape).not.toContainText("COHR");
  });

  test("strategy cards are titled by strategy, not by universe size", async ({ page }) => {
    await open(page);
    await openSection(page, "Strategies");
    await expect(page.getByTestId("strategy-card-title").first()).toBeVisible();
    const titles = await page.getByTestId("strategy-card-title").allInnerTexts();
    expect(titles.some((t) => t.includes("A · Reference system + AI gate"))).toBe(true);
    expect(titles.every((t) => !/halal names/.test(t))).toBe(true);
  });

  test("on a phone the book stacks, so the return is on screen without scrolling sideways", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await open(page);
    const card = page.getByTestId("book-card").filter({ hasText: "Reference system" });
    await expect(card).toBeVisible();
    await expect(card).toContainText("+1.02%");
    await expect(page.getByTestId("book-row").first()).toBeHidden();
  });

  test("the Strategies list names each strategy and never prints undefined% / null%", async ({ page }) => {
    await open(page);
    await openSection(page, "Strategies");
    const cockpit = page.locator(".mz-lab");
    await expect(cockpit).toContainText("A · Reference system + AI gate");
    await expect(cockpit).toContainText("rebalances monthly");
    await expect(cockpit).not.toContainText("undefined%");
    await expect(cockpit).not.toContainText("null%");
  });

  test("Signals never prints Invalid Date or a $0.00 price for missing data", async ({ page }) => {
    await open(page);
    await openSection(page, "Signals");
    const cockpit = page.locator(".mz-lab");
    await expect(cockpit).toContainText("MU");
    await expect(cockpit).not.toContainText("Invalid Date");
    await expect(cockpit).not.toContainText("~$0.00");
  });

  test("each strategy wears its own identity colour — on the chip edge, never on a number", async ({ page }) => {
    await open(page);
    const book = page.getByTestId("strategy-book");
    const chip = (label) => book.locator(".mz-tbl-desktop .mz-code", { hasText: new RegExp(`^${label}$`) }).first();
    await expect(chip("A")).toHaveAttribute("data-strategy-color", "#3987e5");          // blue
    await expect(chip("D")).toHaveAttribute("data-strategy-color", "#c98500");          // yellow
    await expect(chip("E·core")).toHaveAttribute("data-strategy-color", "#d55181");     // magenta
    await expect(chip("E·swing")).toHaveAttribute("data-strategy-color", "#d55181");    // same experiment
    await expect(chip("SHADOW")).toHaveAttribute("data-strategy-color", "#e66767");
    // A return keeps gain/loss ink: A's +1.02% is not drawn in A's blue.
    const ret = book.getByTestId("book-row").filter({ hasText: "Reference system" }).locator("td").nth(3).locator("span").first();
    expect(await ret.evaluate((el) => getComputedStyle(el).color)).not.toBe("rgb(57, 135, 229)");
    // The allocation legend names each colour with a swatch.
    await expect(book.locator(".mz-swatch").first()).toBeVisible();
  });

  test("the desk never overflows the page", async ({ page }) => {
    await open(page, null);
    await expect(page.getByTestId("strategy-multiple").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await openSection(page, "Portfolio");
    await expect(page.getByTestId("strategy-book")).toContainText("Reference system");
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(0);
  });
});

// AI Committee, 2026-10-08: rounds now carry their strategy, a failed analyst
// says why instead of a bare "—", and a scorecard opens the tab.
test("AI committee names the strategy, the failure reason, and each analyst's record", async ({ page }) => {
  const per = (p, a) => ({ provider: p, model: p, action: a, confidence: 0.6, risk_flags: [] });
  const A = { id: "a7728bbe-0000-4000-8000-000000000001", strategy_type: "rank_rebalance", enabled: true, capital_allocated: "250000",
    params: { experiment: "A: reference system + AI gate" }, progress: { paper: true, trades_executed: 1 } };
  const SH = { id: "d8a3e542-0000-4000-8000-000000000005", strategy_type: "rank_rebalance", enabled: true, capital_allocated: "0",
    nl_description: "SHADOW research panel", params: { layer: "shadow" }, progress: { paper: true, trades_executed: 0 } };
  await gotoLab(page, { fixtures: { "/api/bot/strategies": { strategies: [A, SH] }, "/api/ai/research": {
    providers: [{ provider: "anthropic", available: true }, { provider: "google", available: true }, { provider: "openrouter", available: true }],
    configured: 3, required: 2,
    rows: [
      { id: "1", strategy_id: A.id, ticker: "MU", at: "2026-10-07T13:35:00Z", missing: [], packet_hash: "abc",
        ensemble: { ok: false, code: "insufficient_votes", per_model: [per("google", "HOLD")] },
        failures: [{ provider: "anthropic", code: "http_400" }, { provider: "openrouter", code: "schema_invalid" }] },
      { id: "2", strategy_id: SH.id, ticker: "COHR", at: "2026-10-07T17:46:00Z", missing: [], packet_hash: "def",
        ensemble: { ok: true, consensus: "HOLD", unanimous: true, per_model: [per("anthropic", "HOLD"), per("google", "HOLD"), per("openrouter", "HOLD")] }, failures: [] },
      { id: "3", strategy_id: A.id, ticker: "STX", at: "2026-10-07T13:30:00Z", screen_only: true, sharia_verdict: "haram", ensemble: { ok: false }, failures: [] },
    ] } } });
  await openSection(page, "AI Committee");
  const stats = page.getByTestId("committee-stats");
  await expect(stats).toContainText("CLAUDE");
  await expect(stats).toContainText("1/2");            // Claude: answered 1 of 2 asked
  await expect(stats).toContainText("http_400");
  await expect(stats).toContainText("1 agreed");
  const mu = page.getByTestId("committee-row").filter({ hasText: "MU" });
  await expect(mu).toContainText("A");
  await expect(mu).toContainText("failed · http 400");
  await expect(page.getByTestId("committee-row").filter({ hasText: "STX" })).toContainText("screened out · haram");
  // Filter to one strategy.
  await page.getByRole("button", { name: "A", exact: true }).click();
  await expect(page.getByTestId("committee-row")).toHaveCount(2);
});

// Performance, 2026-10-08: per-strategy leaderboard, and the account comparison
// ends NOW (live equity + live SPUS) rather than at yesterday's close.
test("performance ranks each strategy against SPUS and measures the account to now", async ({ page }) => {
  const prog = (o) => ({ paper: true, trades_executed: 3, started_at: "2026-10-07T13:33:38Z", ...o });
  const S = [
    { id: "a1", strategy_type: "rank_rebalance", enabled: true, capital_allocated: "250000", params: { experiment: "A: reference system + AI gate" }, progress: prog({ equity: 252557, return_pct: 1.02, bench_return_pct: -0.1, alpha_pct: 1.12 }) },
    { id: "d1", strategy_type: "breakout", enabled: true, capital_allocated: "150000", params: { experiment: "D: swing" }, progress: prog({ equity: 149449, return_pct: -0.37, bench_return_pct: -0.1, alpha_pct: -0.27 }) },
    { id: "f1", strategy_type: "rank_rebalance", enabled: true, capital_allocated: "300", params: { experiment: "F: small account" }, progress: { paper: true, trades_executed: 0 } },
  ];
  const day = (d) => Date.parse(`2026-10-0${d}T00:00:00Z`) / 1000;
  await gotoLab(page, { fixtures: {
    "/api/bot/strategies": { strategies: S },
    "/api/alpaca/account": { ...PAPER, equity: 1004000 },
    "/api/alpaca/portfolio-history": { timestamp: [day(5), day(6), day(7)], equity: [0, 1000000, 1000000], baseValue: 0, timeframe: "1D", range: "1M" },
    "/api/alpaca/benchmark": { symbol: "SPUS", range: "1M", points: [
      { t: Date.parse("2026-10-06T04:00:00Z"), v: 60 }, { t: Date.parse("2026-10-07T04:00:00Z"), v: 60.3 }, { t: Date.now(), v: 60.6 } ] },
  } });
  await openSection(page, "Performance");
  const lb = page.getByTestId("perf-leaderboard");
  await expect(page.getByTestId("perf-row")).toHaveCount(2);     // F has not traded: not on the board
  await expect(lb).toContainText("Reference system + AI gate");
  await expect(lb).toContainText("+1.12 pts");
  await expect(lb).toContainText("-0.27 pts");
  await expect(page.getByTestId("perf-stats")).toContainText("+0.40%");  // 1,000,000 → live 1,004,000
});

/**
 * The broadsheet Desk (2026-10-08): every strategy as a small chart against
 * SPUS, the order pipeline, and the A-vs-B question — each asserted against
 * what the fixture can only produce one way.
 */
test.describe("Trade Lab desk", () => {
  const s = (id, experiment, cap, pr, params = {}) => ({ id, enabled: true, strategy_type: "rank_rebalance", capital_allocated: String(cap),
    params: { experiment, broker: "alpaca_paper", ...params }, progress: { paper: true, ...pr } });
  const traded = (ret, bench) => ({ trades_executed: 12, return_pct: ret, bench_return_pct: bench, alpha_pct: ret - bench, equity: 1 });
  const STRATS = [
    s("aaaaaaaa-0000-0000-0000-000000000001", "A: reference system + AI gate", 250000, traded(1.02, -0.1)),
    s("bbbbbbbb-0000-0000-0000-000000000002", "B: reference system, no AI", 250000, traded(0.61, -0.1)),
    s("ffffffff-0000-0000-0000-000000000006", "F: small account", 300, { trades_executed: 0 }),
  ];
  const curve = (pts) => ({ startedOn: "2026-10-07", points: pts.map(([day, r, b]) => ({ day, returnPct: r, benchPct: b })) });
  const CURVES = { curves: {
    [STRATS[0].id]: curve([["2026-10-06", 0, 0], ["2026-10-07", 0.4, -0.2]]),
    [STRATS[1].id]: curve([["2026-10-06", 0, 0], ["2026-10-07", 0.2, -0.2]]),
  } };
  const RESEARCH = { configured: 3, required: 2,
    providers: [{ provider: "anthropic", available: true }, { provider: "google", available: true }, { provider: "openrouter", available: true }],
    rows: [
      { id: "1", ticker: "LRCX", at: "2026-10-08T12:30:00Z", ensemble: { ok: false, per_model: [{ provider: "google", action: "BUY", confidence: 0.72 }] },
        failures: [{ provider: "anthropic", code: "http_400" }, { provider: "openrouter", code: "schema_invalid" }] },
      { id: "2", ticker: "COHR", at: "2026-10-08T12:32:00Z", ensemble: { ok: true, unanimous: true,
        per_model: [{ provider: "google", action: "HOLD" }, { provider: "anthropic", action: "HOLD" }, { provider: "openrouter", action: "HOLD" }] }, failures: [] },
    ] };
  const open = (page, over = {}) => gotoLab(page, { fixtures: { "/api/bot/strategies": { strategies: STRATS },
    "/api/bot/curves": CURVES, "/api/ai/research": RESEARCH, "/api/bot/signals": { signals: [] }, ...over } });

  test("draws a chart per traded strategy, ending on the return printed beside it", async ({ page }) => {
    await open(page);
    const a = page.getByTestId("strategy-multiple").filter({ hasText: "Reference system + AI gate" });
    await expect(a).toContainText("+1.02%");
    await expect(a).toContainText("+1.12 pts vs SPUS");
    // Two lines: the strategy in its identity colour, SPUS in grey.
    await expect(a.locator("polyline")).toHaveCount(2);
    await expect(a.locator("polyline.mz-mult-line")).toHaveCSS("stroke", "rgb(57, 135, 229)");
    // Three points: two daily closes + today's live score pinned on the end.
    const pts = await a.locator("polyline.mz-mult-line").getAttribute("points");
    expect(pts.trim().split(/\s+/)).toHaveLength(3);
    await expect(a).toContainText("paper");
  });

  test("an untraded strategy says so instead of drawing a flat line", async ({ page }) => {
    await open(page);
    const f = page.getByTestId("strategy-multiple").filter({ hasText: "Small account" });
    await expect(f).toContainText("not traded");
    await expect(f).toContainText("no fills yet");
    await expect(f.locator("svg")).toHaveCount(0);
  });

  test("counts AI answers per review — one complete review is not a full committee", async ({ page }) => {
    await open(page);
    await expect(page.getByTestId("order-pipeline")).toContainText("1 of 2 reviews missing an analyst");
    const c = page.getByTestId("committee-latest");
    await expect(c).toContainText("no answer");
    await expect(c).toContainText("Buy");
  });

  test("states A against B with how long it has been measured", async ({ page }) => {
    await open(page);
    const q = page.getByTestId("ai-question");
    await expect(q).toContainText("ahead of");
    await expect(q).toContainText("0.41 pts");
    await expect(q).toContainText(/noise, not a verdict/);
  });

  test("still renders when the curves endpoint fails", async ({ page }) => {
    await open(page, { "/api/bot/curves": { __status: 500, error: "db_error" } });
    const a = page.getByTestId("strategy-multiple").filter({ hasText: "Reference system + AI gate" });
    await expect(a).toContainText("+1.02%");
    await expect(page.locator(".mz-lab")).not.toContainText("NaN");
  });

  test("the old Quick Trade id lands on Orders with the ticket open", async ({ page }) => {
    await open(page, {});
    await page.evaluate(() => localStorage.setItem("mizan_pending_order", JSON.stringify({ sym: "SPUS", side: "buy", qty: 2 })));
    await page.reload();
    await expect(labNav(page).getByRole("button", { name: "Orders" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("ticket-venue")).toContainText("Alpaca paper");
  });
});

// Owner, 2026-10-08: "remind me what each strategy is — people will ask".
test("the Strategy guide explains every strategy from its own rules", async ({ page }) => {
  const SRC = "etf_holdings_cache:SPUS (Alpha Vantage, 219 raw -> 214 valid)";
  const rank = (id, experiment, params) => ({ id, enabled: true, strategy_type: "rank_rebalance", capital_allocated: "250000", stop_loss_pct: "15",
    params: { experiment, broker: "alpaca_paper", buy_top: 15, hold_zone: 25, momentum_days: 252, rebalance_days: 30, universe_source: SRC, ...params },
    progress: { paper: true, trades_executed: 0 } });
  await gotoLab(page, { fixtures: { "/api/bot/strategies": { strategies: [
    rank("aaaaaaaa-0000-0000-0000-000000000001", "A: reference system + AI gate", { ai_gate: true }),
    rank("bbbbbbbb-0000-0000-0000-000000000002", "B: reference system, no AI", {}),
  ] } } });
  // The Desk card carries the one-line reminder and the full rules behind it.
  const card = page.getByTestId("strategy-multiple").filter({ hasText: "Reference system + AI gate" });
  await expect(card).toContainText("The 15 strongest halal stocks, rebalanced monthly, with an AI check before each buy.");
  await card.getByText("How it works").click();
  await expect(card).toContainText("Ranks the 214 halal stocks in SPUS by their 12-month price gain");
  await expect(card).toContainText("Tests the AI gate: B runs the same rules without it");
  // And the guide in Strategies lists all of them.
  await openSection(page, "Strategies");
  const guide = page.getByTestId("strategy-guide");
  await expect(guide.getByTestId("guide-item")).toHaveCount(2);
  await guide.getByTestId("guide-item").filter({ hasText: "no AI" }).locator("summary").click();
  await expect(guide).toContainText("The control for A: the same rules without the AI gate");
});

// Owner, 2026-10-08: the curve's headline changed basis with the range
// (1D from yesterday, 1W from the week's start, 1M+ from funding).
test("the equity headline is measured from the starting balance on every range", async ({ page }) => {
  const day = (d) => Date.parse(`2026-10-0${d}T00:00:00Z`) / 1000;
  // A DIFFERENT history per range, as Alpaca really returns — with one shared
  // fixture every window's own change equalled the since-funding change and
  // this test could not tell the two apart (a mutation survived it).
  const H = {
    "1D": [[day(7), day(8)], [1003000, 1003500]],
    "1W": [[day(6), day(7), day(8)], [1001200, 1003000, 1003500]],
  };
  const LONG = [[day(4), day(5), day(6), day(7)], [0, 1000000, 1001200, 1003000]];
  await gotoLab(page, { fixtures: { "/api/alpaca/account": { ...PAPER, equity: 1004392.1 } },
    before: (pg) => pg.route("**/api/alpaca/portfolio-history**", (route) => {
      const r = new URL(route.request().url()).searchParams.get("range");
      const [timestamp, equity] = H[r] || LONG;
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ timestamp, equity, baseValue: 0, timeframe: "1D", range: r }) });
    }) });
  await openSection(page, "Portfolio");
  const head = page.getByTestId("equity-headline");
  const texts = [];
  for (const r of ["1D", "1W", "1M", "3M", "1Y"]) {
    await page.getByRole("button", { name: r, exact: true }).click();
    await expect(head).toContainText("+$4,392.10");
    texts.push((await head.innerText()).split("\n")[0]);
  }
  expect(new Set(texts).size, `headline must not change with the range: ${texts.join(" | ")}`).toBe(1);
  await expect(head).toContainText("since you started with $1,000,000");
  // The range's own change is still stated, underneath — and it differs.
  await page.getByRole("button", { name: "1D", exact: true }).click();
  await expect(head).toContainText("1D: +$1,392.10");
});

// Strategies (broadsheet pass, 2026-10-08): one table, controls unchanged.
test.describe("Trade Lab strategies section", () => {
  const strat = (id, experiment, params, extra = {}) => ({ id, enabled: true, mode: "semi", strategy_type: "rank_rebalance", capital_allocated: "250000",
    stop_loss_pct: "15", params: { experiment, broker: "alpaca_paper", buy_top: 15, hold_zone: 25, rebalance_days: 30, ...params },
    progress: { paper: true, trades_executed: 0 }, ...extra });
  const open = async (page) => {
    await gotoLab(page, { fixtures: { "/api/bot/strategies": { strategies: [
      strat("aaaaaaaa-0000-0000-0000-000000000001", "A: reference system + AI gate", { ai_gate: true }),
      strat("dddddddd-0000-0000-0000-000000000009", "", { layer: "shadow", research_panel: true }, { nl_description: "SHADOW research panel." }),
    ] } } });
    await openSection(page, "Strategies");
  };

  test("lists each strategy once, in one table", async ({ page }) => {
    await open(page);
    await expect(page.getByTestId("strategy-row")).toHaveCount(2);
    await expect(page.getByTestId("automation-status")).toContainText("Automation running");
  });

  test("the shadow panel gets no mode switch — it could overwrite the gate that keeps it from trading", async ({ page }) => {
    await open(page);
    const shadow = page.getByTestId("strategy-row").filter({ hasText: "SHADOW" });
    await expect(shadow.getByTestId("shadow-mode")).toContainText("records only");
    await expect(shadow.getByRole("button", { name: "Manual" })).toHaveCount(0);
  });

  test("changing a strategy's mode still asks for confirmation first", async ({ page }) => {
    await open(page);
    let patched = false;
    await page.route("**/api/bot/strategies/**", (r) => { if (r.request().method() !== "GET") patched = true; r.fulfill({ status: 200, body: "{}" }); });
    const a = page.getByTestId("strategy-row").filter({ hasText: "Reference system + AI gate" });
    await a.getByRole("button", { name: "Manual" }).click();
    // The gate names the STRATEGY (it used to name the ticker, "SPUS", for every rank strategy).
    await expect(page.getByTestId("layer-modal-strategy")).toHaveText("A · Reference system + AI gate");
    await expect(page.getByRole("button", { name: "Set Manual" })).toBeDisabled();
    expect(patched, "nothing may be sent before the user confirms").toBe(false);
  });

  test("the builder is folded until asked for", async ({ page }) => {
    await open(page);
    const b = page.getByTestId("strategy-builder");
    await expect(b).not.toHaveAttribute("open", "");
    const preset = b.getByText("Halal Bogleheads", { exact: true }).first();
    await expect(preset).toBeHidden();
    await b.locator("summary").click();
    await expect(preset).toBeVisible();
  });
});

// Orders (broadsheet pass, 2026-10-08).
test.describe("Trade Lab orders section", () => {
  const A = { id: "aaaaaaaa-0000-0000-0000-000000000001", enabled: true, strategy_type: "rank_rebalance", capital_allocated: "250000",
    params: { experiment: "A: reference system + AI gate", broker: "alpaca_paper" }, progress: { paper: true } };
  const open = async (page, over = {}) => {
    await gotoLab(page, { fixtures: { "/api/bot/strategies": { strategies: [A] },
      "/api/bot/signals": { signals: [{ id: "p1", status: "pending", strategy_id: A.id, side: "buy", qty: 12, ticker: "LRCX", suggested_price: 101.4,
        paper: true, expires_at: new Date(Date.now() + 42 * 60000).toISOString(), created_at: new Date().toISOString() }] },
      "/api/bot/activity": { items: [
        { id: "h1", strategy_id: A.id, side: "buy", ticker: "MU", qty: 34.55, status: "executed", paper: true, executed_at: "2026-10-07T13:33:00Z" },
        { id: "h2", strategy_id: null, side: "buy", ticker: "SPWO", qty: 1, status: "approved", paper: false, error_msg: "insufficient_cash", created_at: "2026-10-07T12:30:00Z" },
        { id: "h3", strategy_id: A.id, side: "buy", ticker: "COHR", qty: 0, status: "shadow", created_at: "2026-10-07T12:00:00Z" } ] },
      ...over } });
    await openSection(page, "Signals");
  };

  test("a waiting signal names its strategy and the time left", async ({ page }) => {
    await open(page);
    const row = page.getByTestId("pending-row");
    await expect(row).toContainText("A · Reference system + AI gate");
    await expect(row).toContainText("Buy 12 LRCX");
    await expect(row).toContainText(/expires in 4[12] min/);
    await expect(row.getByRole("button", { name: "Approve" })).toBeVisible();
  });

  test("the history states why an order failed and leaves AI reviews to Research", async ({ page }) => {
    await open(page);
    const h = page.getByTestId("order-history");
    await expect(h.getByTestId("history-row")).toHaveCount(2);
    await expect(h).toContainText("insufficient cash");
    await expect(h).toContainText("Failed");
    await expect(h).not.toContainText("COHR");
    // Real money is said only where the record says so.
    await expect(h.getByTestId("history-row").filter({ hasText: "MU" })).not.toContainText("real money");
    await expect(h.getByTestId("history-row").filter({ hasText: "SPWO" })).toContainText("real money");
  });

  test("the ticket's Sharia line is a real screen, not a static green", async ({ page }) => {
    await open(page, { "/api/screen": { verdict: { tk: "AAPL", status: "review", byStandard: { AAOIFI: { pass: false } } } } });
    await page.getByRole("button", { name: "Open the ticket" }).click();
    const line = page.getByTestId("ticket-sharia");
    await expect(line).toContainText("fails AAOIFI — a buy will be refused");
  });

  test("a refused hand buy shows the server's sentence, not its code", async ({ page }) => {
    await open(page, { "/api/screen": { verdict: { tk: "AAPL", status: "halal", byStandard: { AAOIFI: { pass: true } } } } });
    await page.route("**/api/alpaca/order", (r) => r.fulfill({ status: 403, contentType: "application/json",
      body: JSON.stringify({ error: "XYZ does not pass the AAOIFI Sharia screen, so it can't be bought here.", code: "sharia_failed" }) }));
    await page.getByRole("button", { name: "Open the ticket" }).click();
    await page.getByRole("button", { name: /Place paper buy/ }).click();
    await expect(page.getByTestId("order-ticket").getByRole("alert")).toContainText("does not pass the AAOIFI Sharia screen");
  });

  test("survives a malformed signals response", async ({ page }) => {
    await open(page, { "/api/bot/signals": { signals: "not-an-array" }, "/api/bot/activity": { items: { nope: 1 } } });
    await expect(page.getByTestId("approval-queue")).toContainText("Nothing is waiting for you");
    await expect(page.locator("body")).not.toContainText(/SOMETHING WENT WRONG/i);
  });
});
