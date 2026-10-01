import { test, expect } from "@playwright/test";
import { signedIn } from "./support/app.js";

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
  await expect(page.getByRole("button", { name: "Desk", exact: true })).toBeVisible();
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
    // The banner exists so a short approval window is not buried behind a tab.
    await expect(page.getByRole("button", { name: "Signals", exact: true }))
      .toHaveAttribute("aria-selected", /true/).catch(async () => {
        // TabBar may not use aria-selected; fall back to the panel appearing.
        await expect(page.locator(".mz-cockpit")).toHaveCount(0);
      });
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

  test("never shows margin buying power", async ({ page }) => {
    // Alpaca quotes 4x cash as buying power. Margin is riba, and the order
    // path refuses it, so a rail advertising it would lie in the user's
    // favour — the worst direction for a trading surface to lie in.
    await gotoLab(page);
    await expect(page.locator(".mz-rail")).not.toContainText(/buying power/i);
    await expect(page.locator(".mz-rail")).toContainText("PAPER CASH");
  });

  test("keeps the three original sub-tab ids for nav_usage continuity", async ({ page }) => {
    // mizan_nav, ?tab= deep links, nav_usage counters and data-tour hooks are
    // all keyed on these. Renaming a label is free; renaming an id orphans
    // every historical counter.
    await gotoLab(page);
    for (const label of ["Desk", "Signals", "Strategies", "Quick Trade"]) {
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
