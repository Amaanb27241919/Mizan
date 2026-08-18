/**
 * Guards the 2026-08-18 user report: "the compliance status is not changing if
 * users pick the different screener."
 *
 * The unit tests in src/test/shariaStatus.test.js pin the pure resolver. This
 * pins the thing the user actually experiences: pick a different standard, and
 * the verdicts on screen change — including on OTHER tabs, since the whole point
 * of the fix is that one chosen standard drives every compliance surface.
 */
import { test, expect } from "@playwright/test";
import { signedIn, appReady } from "./support/app.js";

// One holding, deliberately straddling the two frameworks: 41% receivables
// clears AAOIFI's 49% cap but breaches Dow Jones' 33%. The server's own
// cross-standard vote calls it halal — which is exactly the value the old code
// displayed no matter what the user picked.
const SPLIT = {
  "/api/snaptrade/all": {
    accounts: [{
      accountId: "a1", brokerage: "Fidelity", accountName: "Individual",
      balance: 1000, cash: 0,
      positions: [{ symbol: { symbol: "ACME", raw_symbol: "ACME", description: "Acme Corp" },
                    units: 10, price: 100, average_purchase_price: 80 }],
    }],
    activities: [],
  },
  "/api/screen": {
    provider: "finnhub",
    verdict: {
      tk: "ACME", status: "halal", name: "Acme Corp", industry: "Technology",
      marketCap: 5_000_000, debtR: 10, cashR: 8, recvR: 41, nonPermPct: null,
      source: "finnhub", asOf: "2026-08-18",
      byStandard: {
        AAOIFI:   { pass: true,  tests: [], ratios: { recv: 41 } },
        DOWJONES: { pass: false, tests: [], fails: [{ rule: "Receivables" }] },
      },
    },
  },
};

async function pickStandard(page, value) {
  await page.locator('select[aria-label="Screening standard"]').selectOption(value);
  await page.waitForTimeout(400);
}

test.describe("screening standard drives the verdict", () => {
  test("switching standard changes the badge for the same holding", async ({ page }) => {
    await signedIn(page, {
      fixtures: SPLIT,
      // Seed the screen cache so a verdict is present without a live round-trip.
      storage: { mizan_aaoifi_cache: JSON.stringify({ ACME: SPLIT["/api/screen"].verdict }) },
    });
    await page.goto("/");
    await appReady(page);
    await page.locator('[data-tour="nav-portfolio"]').click({ force: true });
    await page.waitForTimeout(300);
    await page.locator(".mz-tabbar > button", { hasText: /Screener/i }).first().click({ force: true });
    await page.waitForTimeout(500);

    // The picker must be reachable without scrolling past the explanation.
    const picker = page.locator('select[aria-label="Screening standard"]');
    await expect(picker).toBeVisible();

    await pickStandard(page, "AAOIFI");
    const underAaoifi = await page.locator("main").textContent();

    await pickStandard(page, "DOWJONES");
    const underDowJones = await page.locator("main").textContent();

    // The page must actually differ. Before the fix these were identical.
    expect(underDowJones).not.toBe(underAaoifi);
  });

  test("the choice reaches the Overview compliance tile, not just the Screener", async ({ page }) => {
    await signedIn(page, {
      fixtures: SPLIT,
      storage: { mizan_aaoifi_cache: JSON.stringify({ ACME: SPLIT["/api/screen"].verdict }) },
    });
    await page.goto("/");
    await appReady(page);
    await page.waitForTimeout(700);

    // The CONFIRMED HALAL tile's caption, e.g. "1 of 1 halal" / "0 of 1 halal · 1 non-compliant".
    const compliance = async () => {
      const t = await page.locator("main").textContent();
      const m = t.match(/CONFIRMED HALAL.*?(\d+ of \d+ halal[^A-Z]*)/s);
      return (m ? m[1] : "").replace(/\s+/g, " ").trim();
    };

    const underAaoifi = await compliance();
    expect(underAaoifi, "expected a compliance caption on the Overview").not.toBe("");

    // Change the standard from the Screener. No reload: the shared hook
    // broadcasts a window event, and this asserts that propagation actually
    // works live — which is the whole point of not prop-threading it.
    await page.locator('[data-tour="nav-portfolio"]').click({ force: true });
    await page.waitForTimeout(300);
    await page.locator(".mz-tabbar > button", { hasText: /Screener/i }).first().click({ force: true });
    await page.waitForTimeout(400);
    await pickStandard(page, "DOWJONES");

    await page.locator('[data-tour="nav-overview"]').click({ force: true });
    await page.waitForTimeout(700);
    const underDowJones = await compliance();

    // AAOIFI passes this holding (41% receivables < 49% cap); Dow Jones fails it
    // (< 33%). The Overview must reflect that, not the server's 7-standard vote.
    expect(underAaoifi).toMatch(/1 of 1 halal/);
    expect(underDowJones).not.toMatch(/1 of 1 halal/);
  });
});
