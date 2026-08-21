/**
 * The ethical / BDS overlay, as a user actually meets it.
 *
 * The overlay shipped 2026-07-02 and was Screener-only by construction: the
 * preference was `useState` inside the Screener, so `mapPosition` computed
 * `h.bds_` for every holding and nothing could ever read it. A user could hold
 * a listed name indefinitely and only find out by visiting a tab they had no
 * reason to visit and flipping a switch they had no reason to flip.
 *
 * These specs pin the fix: one shared preference, three surfaces agreeing.
 * They also pin the direction that matters more — overlay OFF means no flag
 * anywhere, because an opt-in ethical filter that turns itself on is a
 * different product from the one the user consented to.
 */
import { test, expect } from "@playwright/test";
import { signedIn, appReady } from "./support/app.js";

// CAT is on the curated list; ACME is not. Both halal under the Sharia screen,
// so anything that shows up is the overlay talking and not the compliance
// verdict leaking into it.
const ethicalFor = (excluded) => excluded
  ? {
      excluded: true,
      reason: "Heavy equipment cited in home-demolition campaigns — listed by AFSC \"Investigate\"",
      activity: "Heavy equipment cited in home-demolition campaigns",
      sources: [{ key: "afsc", name: "AFSC \"Investigate\"", url: "https://investigate.afsc.org/", version: "accessed 2026-08-20" }],
      list: "bds",
      reconciled: "2026-08-20",
    }
  : { excluded: false, reason: null, activity: null, sources: [], list: "bds", reconciled: "2026-08-20" };

const verdict = (tk, name, excluded) => ({
  tk, status: "halal", name, industry: "Technology",
  marketCap: 5_000_000, debtR: 10, cashR: 8, recvR: 12, nonPermPct: null,
  source: "finnhub", asOf: "2026-08-20",
  byStandard: { AAOIFI: { pass: true, tests: [], ratios: {} } },
  ethical: ethicalFor(excluded),
});

const CACHE = {
  CAT:  verdict("CAT", "Caterpillar Inc", true),
  ACME: verdict("ACME", "Acme Corp", false),
};

const FIXTURES = {
  "/api/snaptrade/all": {
    accounts: [{
      accountId: "a1", brokerage: "Fidelity", accountName: "Individual",
      balance: 2000, cash: 0,
      positions: [
        { symbol: { symbol: "CAT",  raw_symbol: "CAT",  description: "Caterpillar Inc" }, units: 10, price: 100, average_purchase_price: 80 },
        { symbol: { symbol: "ACME", raw_symbol: "ACME", description: "Acme Corp" },       units: 10, price: 100, average_purchase_price: 80 },
      ],
    }],
    activities: [],
  },
  "/api/screen": { provider: "finnhub", verdict: CACHE.CAT },
};

async function boot(page, { overlay }) {
  const storage = { mizan_aaoifi_cache: JSON.stringify(CACHE) };
  if (overlay) storage.mizan_ethical_overlay = "1";
  await signedIn(page, { fixtures: FIXTURES, storage });
  await page.goto("/");
  await appReady(page);
}

async function gotoHoldings(page) {
  await page.locator('[data-tour="nav-portfolio"]').click({ force: true });
  await page.waitForTimeout(400);
}

test.describe("ethical / BDS overlay", () => {
  test("overlay ON flags the listed holding in the Holdings table", async ({ page }) => {
    await boot(page, { overlay: true });
    await gotoHoldings(page);

    // The pill sits beside the Sharia tag, not instead of it — both verdicts
    // stay visible because they answer different questions.
    const catRow = page.locator("tr", { hasText: "CAT" }).first();
    await expect(catRow.getByText("BDS", { exact: true })).toBeVisible();
    await expect(catRow.getByText("Halal", { exact: true })).toBeVisible();

    const acmeRow = page.locator("tr", { hasText: "ACME" }).first();
    await expect(acmeRow.getByText("BDS", { exact: true })).toHaveCount(0);
  });

  test("overlay OFF shows no flag anywhere — it is opt-in", async ({ page }) => {
    await boot(page, { overlay: false });
    await gotoHoldings(page);
    await expect(page.getByText("BDS", { exact: true })).toHaveCount(0);
  });

  test("overlay ON surfaces the count on Overview, where the user already is", async ({ page }) => {
    await boot(page, { overlay: true });
    // Overview is the landing tab — no navigation, which is the point: the user
    // learns about a held listed name without going looking for it.
    await expect(page.getByText(/on divestment list/i)).toBeVisible();
    await expect(page.getByText(/on divestment list/i)).toContainText("CAT");
  });

  test("overlay OFF leaves Overview silent", async ({ page }) => {
    await boot(page, { overlay: false });
    await expect(page.getByText(/on divestment list/i)).toHaveCount(0);
  });

  test("the flag cites who published the listing, not Mizan", async ({ page }) => {
    await boot(page, { overlay: true });
    await gotoHoldings(page);
    await page.locator(".mz-tabbar > button", { hasText: /Screener/i }).first().click({ force: true });
    await page.waitForTimeout(500);

    // Attribution is the whole design: the banner must name the source and link
    // out, so a user can check the claim rather than take Mizan's word for it.
    await expect(page.getByText(/Mizan does not judge these companies/i)).toBeVisible();
    const src = page.getByRole("link", { name: /Investigate/i }).first();
    await expect(src).toBeVisible();
    await expect(src).toHaveAttribute("href", /investigate\.afsc\.org/);
  });
});
