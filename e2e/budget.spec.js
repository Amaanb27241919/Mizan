/**
 * The Budget tab (migration 027 + src/lib/budgetPlan.js + Budgeting.jsx).
 *
 * Why this spec exists at all: the FIRST Budgeting component shipped as 429
 * lines that were never imported. The table, the API and the UI all existed
 * and no user could reach any of it, while CLAUDE.md described it as a shipped
 * tab. So the dumbest test here is still the most important one — does it
 * render for a user at all.
 *
 * Rewritten 2026-08-30 with the model: the tab was zero-based (envelope) and
 * led with "To Budget", which the owner reported as confusing. It is now
 * TOP-DOWN — one monthly budget, category limits inside it, "Everything else"
 * holding the remainder.
 *
 * Dates are derived from the clock, not written down. The previous version
 * hardcoded 2026-08 in both the fixtures and the assertions, so it was going
 * to fail on the 1st of the following month for reasons having nothing to do
 * with budgeting.
 */
import { test, expect } from "@playwright/test";
import { signedIn, appReady } from "./support/app.js";

const now = new Date();
const M = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
const day = d => `${M.slice(0, 8)}${String(d).padStart(2, "0")}`;

/** A budget of $2,000 with $1,000 of it given to two named categories. */
const PLAN = JSON.stringify({ rollover: false, months: { [M]: { total: 2000 } } });

const BUDGET_FIXTURES = {
  "/api/budget": {
    entries: [
      { month: M, category: "Halal Food", budgeted: 600, carryover: false },
      { month: M, category: "Zakat",      budgeted: 400, carryover: false },
    ],
    months: [{ month: M, manual_income: 5000 }],
  },
  // NOTE the shape: Plaid sends `category` as an ARRAY and the modern field as
  // `personal_finance_category.primary`. An earlier version of this fixture
  // used plain strings, which matched the code's assumption rather than
  // production — so it passed while the real Finances tab crashed with
  // "(t.category || 'Uncategorized').trim is not a function". Fixtures must
  // mirror what the provider actually sends, or they only test themselves.
  "/api/plaid/transactions": {
    transactions: [
      { date: day(4), amount: 150, category: ["FOOD_AND_DRINK", "Halal Food"], name: "Grocer" },
      { date: day(9), amount: 90,  personal_finance_category: { primary: "Halal Food" }, name: "Grocer" },
      // Uncapped: this must land in Everything else, not vanish. In the
      // envelope model spending in a category you never created was invisible.
      { date: day(6), amount: 500, personal_finance_category: { primary: "Rent" }, name: "Landlord" },
    ],
  },
};

/** Finances → Budget. Two clicks: the tab, then the sub-tab. */
async function openFinances(page) {
  await page.locator('[data-tour="nav-finances"]').click({ force: true });
  await page.waitForTimeout(400);
  await page.locator(".mz-tabbar > button", { hasText: /^Budget$/ }).first().click({ force: true });
  await page.waitForTimeout(600);
}
// `...extra` goes FIRST: spreading it last overwrote `storage` wholesale, so
// any caller passing its own storage silently lost the seeded budget plan and
// landed on the setup screen instead.
const budgeted = (extra = {}) => ({
  fixtures: BUDGET_FIXTURES,
  ...extra,
  storage: { mizan_budget_plan: PLAN, ...(extra.storage || {}) },
});

test.describe("budget — setup", () => {
  test("asks for one number when no budget has been set", async ({ page }) => {
    // A budget nobody has set is not a $0 budget. Showing a gauge pinned at
    // zero would report a plan the user never made.
    await signedIn(page, { fixtures: BUDGET_FIXTURES });
    await page.goto("/");
    await appReady(page);
    await openFinances(page);
    await expect(page.getByText("SET YOUR MONTHLY BUDGET")).toBeVisible();
  });

  test("renders the budget once one is set", async ({ page }) => {
    await signedIn(page, budgeted());
    await page.goto("/");
    await appReady(page);
    await openFinances(page);
    await expect(page.getByText(/LEFT TO SPEND|OVERSPENT/)).toBeVisible();
  });
});

test.describe("budget — the numbers on screen", () => {
  test("leads with what is left of the whole budget", async ({ page }) => {
    await signedIn(page, budgeted());
    await page.goto("/");
    await appReady(page);
    await openFinances(page);
    // 2000 budget − (240 food + 500 rent) spent = 1260 left.
    const t = (await page.locator("main").textContent()).replace(/\s+/g, " ");
    expect(t).toContain("$1,260");
    expect(t).toContain("of $2,000 budget");
  });

  test("shows a category against its limit", async ({ page }) => {
    await signedIn(page, budgeted());
    await page.goto("/");
    await appReady(page);
    await openFinances(page);
    const t = (await page.locator("main").textContent()).replace(/\s+/g, " ");
    expect(t).toMatch(/Halal Food/);
    expect(t).toMatch(/\$240 of \$600/);
  });

  test("Everything else holds the spending no category claimed", async ({ page }) => {
    // The property that makes top-down usable on real data: $500 of rent, in a
    // category with no limit, still has to appear somewhere.
    await signedIn(page, budgeted());
    await page.goto("/");
    await appReady(page);
    await openFinances(page);
    const t = (await page.locator("main").textContent()).replace(/\s+/g, " ");
    expect(t).toContain("Everything else");
    expect(t).toMatch(/\$500 of \$1,000/);   // 2000 budget − 1000 in limits
  });

  test("splits income into what is budgeted and what is left to save", async ({ page }) => {
    await signedIn(page, budgeted());
    await page.goto("/");
    await appReady(page);
    await openFinances(page);
    const t = (await page.locator("main").textContent()).replace(/\s+/g, " ");
    // Income 5000, budget 2000 → save 3000 (60%).
    expect(t).toContain("Left to save");
    expect(t).toContain("$3,000");
  });
});

test.describe("budget — editing", () => {
  test("offers the Islamic category presets when adding a limit", async ({ page }) => {
    await signedIn(page, budgeted());
    await page.goto("/");
    await appReady(page);
    await openFinances(page);
    // A real tap, not a forced one: scroll it into view and let Playwright run
    // its actionability checks, so a button a phone user genuinely cannot
    // reach fails here instead of being papered over by force:true.
    const addBtn = page.getByRole("button", { name: /add limit/i }).first();
    await addBtn.scrollIntoViewIfNeeded();
    await addBtn.click();
    await page.waitForTimeout(300);
    const t = (await page.locator("main").textContent()).replace(/\s+/g, " ");
    expect(t).toContain("+ Sadaqah");
    expect(t).toContain("+ Masjid");
    expect(t).not.toContain("+ Zakat");   // already has a limit
  });

  test("offers this month's real spending as something to cap", async ({ page }) => {
    await signedIn(page, budgeted());
    await page.goto("/");
    await appReady(page);
    await openFinances(page);
    const addBtn = page.getByRole("button", { name: /add limit/i }).first();
    await addBtn.scrollIntoViewIfNeeded();
    await addBtn.click();
    await page.waitForTimeout(300);
    const t = (await page.locator("main").textContent()).replace(/\s+/g, " ");
    expect(t).toContain("WHERE YOUR MONEY WENT THIS MONTH");
    expect(t).toMatch(/Rent · \$500/);
  });

  test("keeps a row's controls behind its own disclosure", async ({ page }) => {
    // The old screen put ROLL and EDIT on every row and three labelled inputs
    // behind EDIT, so the resting state of the page was a data-entry form.
    await signedIn(page, budgeted());
    await page.goto("/");
    await appReady(page);
    await openFinances(page);
    const before = (await page.locator("main").textContent()).replace(/\s+/g, " ");
    expect(before).not.toContain("SHOW AS");
    expect(before).not.toContain("GROUP");
    expect(before).not.toContain("Remove limit");

    await page.getByRole("button", { expanded: false }).filter({ hasText: "Halal Food" }).first().click();
    await page.waitForTimeout(250);
    const after = (await page.locator("main").textContent()).replace(/\s+/g, " ");
    expect(after).toContain("SHOW AS");
    expect(after).toContain("GROUP");
  });

  test("rollover is one switch for the whole budget, not one per row", async ({ page }) => {
    await signedIn(page, budgeted());
    await page.goto("/");
    await appReady(page);
    await openFinances(page);
    await page.getByRole("button", { name: /edit budget/i }).first().click();
    await page.waitForTimeout(250);
    await expect(page.getByRole("switch")).toHaveCount(1);
  });

  test("prompts for income when no bank is linked", async ({ page }) => {
    // 8 of 12 real users are in this state, so it is the primary path.
    await signedIn(page, budgeted({
      fixtures: { ...BUDGET_FIXTURES, "/api/budget": { entries: [], months: [] }, "/api/plaid/accounts": { accounts: [] } },
    }));
    await page.goto("/");
    await appReady(page);
    await openFinances(page);
    await page.getByRole("button", { name: /edit budget/i }).first().click();
    await page.waitForTimeout(250);
    await expect(page.getByText(/No bank linked/i)).toBeVisible();
  });
});

test.describe("information density", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) > 500, "phone density only");

  // Owner report: "there's too much info going on in the app." Measured at
  // 390px: Finances was 11.4 screens / 808 words, more than double every other
  // tab, and 79% of it was RECENT TRANSACTIONS rendering 50 rows inline — a
  // desktop page size on a phone. Cut to 15 with a 50-row Load more.
  test("the Finances tab opens without burying everything below the fold", async ({ page }) => {
    await signedIn(page, { storage: { mizan_demo: "1" } });
    await page.goto("/");
    await appReady(page);
    await page.locator('[data-tour="nav-finances"]').click({ force: true });
    await page.waitForTimeout(1200);
    const m = await page.evaluate(() => {
      const main = document.querySelector("main");
      return { screens: main.scrollHeight / window.innerHeight };
    });
    expect(m.screens, `Finances is ${m.screens.toFixed(1)} phone-screens tall`).toBeLessThan(8);
  });
});

/**
 * The Finances IA split (2026-08-25). Seven stacked sections became five
 * destinations. These pin the two things that break silently: a strip with no
 * `track` prefix is invisible to nav_usage, and a section that lost its home
 * during the wrap is simply gone with no error anywhere.
 */
test.describe("Finances sub-tabs", () => {
  const ALL = ["Accounts", "Budget", "Spending", "Recurring", "Transactions"];

  test("offers all five destinations", async ({ page }) => {
    await signedIn(page, budgeted());
    await page.goto("/");
    await appReady(page);
    await page.locator('[data-tour="nav-finances"]').click({ force: true });
    await page.waitForTimeout(500);
    for (const label of ALL) {
      await expect(
        page.locator(".mz-tabbar > button", { hasText: new RegExp(`^${label}$`) }).first(),
        `${label} sub-tab missing`,
      ).toBeVisible();
    }
  });

  test("each destination renders its own content", async ({ page }) => {
    await signedIn(page, budgeted());
    await page.goto("/");
    await appReady(page);
    await page.locator('[data-tour="nav-finances"]').click({ force: true });
    await page.waitForTimeout(500);

    for (const label of ALL) {
      await page.locator(".mz-tabbar > button", { hasText: new RegExp(`^${label}$`) }).first().click({ force: true });
      await page.waitForTimeout(400);
      const body = (await page.locator("main").textContent()).replace(/\s+/g, " ").trim();
      // A blank pane is the failure mode of a mis-balanced JSX wrap: the tab
      // switches, nothing renders, and no error is thrown anywhere.
      expect(body.length, `${label} pane rendered empty`).toBeGreaterThan(80);
    }
  });

  test("the budget respects privacy mode", async ({ page }) => {
    // Budget figures ignored mask() entirely until 2026-08-25 — net worth and
    // holdings hid, every envelope stayed on screen.
    await signedIn(page, budgeted({ storage: { mizan_hide_values: "1" } }));
    await page.goto("/");
    await appReady(page);
    await openFinances(page);
    const t = (await page.locator("main").textContent()).replace(/\s+/g, " ");
    expect(t, "budget amounts leaked while privacy mode was on").not.toContain("$1,260");
    expect(t, "budget amounts leaked while privacy mode was on").not.toContain("$240 of $600");
    expect(t).toMatch(/Halal Food/);   // labels still render, only figures hide
  });
});
