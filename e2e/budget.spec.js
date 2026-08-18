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
  "/api/plaid/transactions": {
    transactions: [
      { date: "2026-08-04", amount: 150, category: "Halal Food", name: "Grocer" },
      { date: "2026-08-09", amount: 90,  category: "Halal Food", name: "Grocer" },
    ],
  },
};

async function openFinances(page) {
  await page.locator('[data-tour="nav-finances"]').click({ force: true });
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
    // Halal Food: budgeted 600, spent 240 -> 360 left.
    expect(t).toMatch(/Halal Food/);
    expect(t).toMatch(/spent \$240\.00/);
    expect(t).toMatch(/left \$360\.00/);
  });

  test("offers the Islamic category presets", async ({ page }) => {
    await signedIn(page, { fixtures: BUDGET_FIXTURES });
    await page.goto("/");
    await appReady(page);
    await openFinances(page);
    await page.getByRole("button", { name: /add category/i }).first().click({ force: true });
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
