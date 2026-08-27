/**
 * Envelope budgeting (migration 027 + src/lib/envelope.js + Budgeting.jsx).
 *
 * Why this spec exists at all: the previous Budgeting component shipped as 429
 * lines that were never imported. The table, the API and the UI all existed and
 * no user could reach any of it, and CLAUDE.md described it as a shipped tab.
 * The first test here is therefore the dumbest and most important one — does it
 * render for a user at all.
 */
import { test, expect } from "@playwright/test";
import { signedIn, appReady } from "./support/app.js";

const BUDGET_FIXTURES = {
  "/api/budget": {
    entries: [
      { month: "2026-08-01", category: "Halal Food", budgeted: 600, carryover: false },
      { month: "2026-08-01", category: "Zakat",      budgeted: 400, carryover: true  },
    ],
    months: [{ month: "2026-08-01", manual_income: 5000 }],
  },
  // NOTE the shape: Plaid sends `category` as an ARRAY and the modern field as
  // `personal_finance_category.primary`. An earlier version of this fixture
  // used plain strings, which matched the code's assumption rather than
  // production — so it passed while the real Finances tab crashed with
  // "(t.category || 'Uncategorized').trim is not a function". Fixtures must
  // mirror what the provider actually sends, or they only test themselves.
  "/api/plaid/transactions": {
    transactions: [
      { date: "2026-08-04", amount: 150, category: ["FOOD_AND_DRINK", "Halal Food"], name: "Grocer" },
      { date: "2026-08-09", amount: 90,  personal_finance_category: { primary: "Halal Food" }, name: "Grocer" },
    ],
  },
};

/**
 * Finances → Budget.
 *
 * The Budget used to be a collapsed tile on a single long Finances scroll. It
 * now lives behind its own sub-tab, so reaching it takes two clicks and this
 * helper has to make the second one — otherwise every assertion below runs
 * against the Accounts tab and fails for a reason that has nothing to do with
 * budgeting.
 */
async function openFinances(page) {
  await page.locator('[data-tour="nav-finances"]').click({ force: true });
  await page.waitForTimeout(400);
  await page.locator(".mz-tabbar > button", { hasText: /^Budget$/ }).first().click({ force: true });
  await page.waitForTimeout(600);
}

test.describe("envelope budget", () => {
  test("the Budget section renders in Finances at all", async ({ page }) => {
    await signedIn(page, { fixtures: BUDGET_FIXTURES });
    await page.goto("/");
    await appReady(page);
    await openFinances(page);
    await expect(page.getByText("TO BUDGET")).toBeVisible();
  });

  test("computes To Budget from income minus what is assigned", async ({ page }) => {
    await signedIn(page, { fixtures: BUDGET_FIXTURES });
    await page.goto("/");
    await appReady(page);
    await openFinances(page);
    // income 5000 − (600 + 400) assigned = 4000 still to assign.
    const main = await page.locator("main").textContent();
    expect(main.replace(/\s+/g, " ")).toContain("$4,000.00");
  });

  test("shows what is left in a category after real spending", async ({ page }) => {
    await signedIn(page, { fixtures: BUDGET_FIXTURES });
    await page.goto("/");
    await appReady(page);
    await openFinances(page);
    const t = (await page.locator("main").textContent()).replace(/\s+/g, " ");
    // Halal Food: budgeted 600, spent 240 -> 360 left. The row now leads with
    // what REMAINS and states the arithmetic underneath, rather than making the
    // reader subtract two figures themselves.
    expect(t).toMatch(/Halal Food/);
    expect(t).toMatch(/\$240\.00 of \$600\.00/);
    expect(t).toMatch(/\$360\.00\s*left/);   // nested span — textContent has no space
  });

  test("offers the Islamic category presets", async ({ page }) => {
    await signedIn(page, { fixtures: BUDGET_FIXTURES });
    await page.goto("/");
    await appReady(page);
    await openFinances(page);
    // Real tap, not a forced one: scroll it into view and let Playwright do
    // its actionability checks, so a button a phone user genuinely cannot
    // reach fails here instead of being papered over by force:true.
    const addBtn = page.getByRole("button", { name: /add category/i }).first();
    await addBtn.scrollIntoViewIfNeeded();
    await addBtn.click();
    await page.waitForTimeout(300);
    const t = (await page.locator("main").textContent()).replace(/\s+/g, " ");
    // Sadaqah/Masjid are unused in the fixture so they should be offered;
    // Zakat is already budgeted so it must NOT be offered again.
    expect(t).toContain("+ Sadaqah");
    expect(t).toContain("+ Masjid");
    expect(t).not.toContain("+ Zakat");
  });

  test("prompts for income when no bank is linked", async ({ page }) => {
    // 8 of 12 real users are in this state, so it is the primary path.
    await signedIn(page, {
      fixtures: { ...BUDGET_FIXTURES, "/api/budget": { entries: [], months: [] }, "/api/plaid/accounts": { accounts: [] } },
    });
    await page.goto("/");
    await appReady(page);
    await openFinances(page);
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
      return {
        screens: main.scrollHeight / window.innerHeight,
        rows: main.querySelectorAll("*").length,
      };
    });
    // 11.4 before the fix, ~5.4 after. 8 leaves room for real data growth
    // while still failing if the transaction list goes unbounded again.
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
    await signedIn(page, { fixtures: BUDGET_FIXTURES });
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

  // Every section must still be reachable. Before the split they were all on
  // one scroll, so "did anything fall out of the wrap" had no other detector.
  test("each destination renders its own content", async ({ page }) => {
    await signedIn(page, { fixtures: BUDGET_FIXTURES });
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
    // Budget figures ignored mask() entirely until this change — net worth and
    // holdings hid, every envelope stayed on screen.
    await signedIn(page, { fixtures: BUDGET_FIXTURES, storage: { mizan_hide_values: "1" } });
    await page.goto("/");
    await appReady(page);
    await openFinances(page);
    const t = (await page.locator("main").textContent()).replace(/\s+/g, " ");
    expect(t, "budget amounts leaked while privacy mode was on").not.toContain("$4,000.00");
    expect(t).toMatch(/Halal Food/);   // labels still render, only figures hide
  });
});
