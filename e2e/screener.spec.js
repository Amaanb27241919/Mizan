import { test, expect } from "@playwright/test";
import { signedIn, appReady } from "./support/app.js";

/**
 * The Screener's "screen any ticker" lookup + typeahead (BACKLOG-driven, built
 * 2026-08-10 from an accountant's feedback). Both shipped to production without
 * anyone — human or machine — seeing them render. This is that check.
 */

const SUGGESTIONS = {
  "/api/market/symbols": {
    symbols: [
      { symbol: "NVDA", name: "NVIDIA Corp", type: "Common Stock" },
      { symbol: "NVDQ", name: "T-Rex 2X Inverse NVIDIA Daily Target ETF", type: "ETP" },
    ],
  },
};

const HALAL_VERDICT = {
  "/api/screen": {
    provider: "finnhub",
    verdict: {
      tk: "NVDA", status: "halal", industry: "Semiconductors", name: "NVIDIA Corp",
      marketCap: 3_000_000, assets: 65_728, debtR: 12.3, cashR: 8.1, recvR: 4.2,
      nonPermPct: null, source: "finnhub", asOf: "2026-08-12",
      byStandard: { AAOIFI: { pass: true, tests: [] }, DOWJONES: { pass: true, tests: [] } },
    },
  },
};

async function openScreener(page) {
  await page.goto("/");
  await appReady(page);
  // Navigate via the data-tour hooks the app already exposes for its guided
  // tour — stable contract, and they don't depend on visible label text.
  //
  // force:true because the floating dock never satisfies Playwright's
  // "stable" actionability check: the bottom dock sits in a region the app
  // keeps repainting while data settles, so the bounding box never holds
  // still for two consecutive frames and a normal click times out at 30s.
  // The element IS visible and enabled — only the stability heuristic fails —
  // so forcing the click tests the real thing without a fake wait.
  await page.locator('[data-tour="nav-portfolio"]').click({ force: true });
  await page.getByRole("button", { name: /^screener$/i }).first().click({ force: true });
  await expect(page.getByText("SCREEN ANY TICKER")).toBeVisible();
}

test.describe("Screener — screen any ticker", () => {
  test("the lookup tile renders", async ({ page }) => {
    await signedIn(page);
    await openScreener(page);
    await expect(page.getByPlaceholder(/ticker or company/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /^screen$/i })).toBeVisible();
    // The compliance framing is not decoration — it's the line that keeps this
    // an impersonal lookup rather than a recommendation. If someone edits it
    // away, this fails.
    await expect(page.getByText(/compliance check, not a recommendation/i)).toBeVisible();
  });

  test("typing shows suggestions with a symbol and company name", async ({ page }) => {
    await signedIn(page, { fixtures: SUGGESTIONS });
    await openScreener(page);
    await page.getByPlaceholder(/ticker or company/i).fill("nvidia");
    const listbox = page.getByRole("listbox", { name: /matching symbols/i });
    await expect(listbox).toBeVisible();
    await expect(listbox.getByRole("option").first()).toContainText("NVDA");
    await expect(listbox.getByRole("option").first()).toContainText("NVIDIA Corp");
  });

  test("the dropdown says the verdict comes after you pick", async ({ page }) => {
    await signedIn(page, { fixtures: SUGGESTIONS });
    await openScreener(page);
    await page.getByPlaceholder(/ticker or company/i).fill("nvidia");
    await expect(page.getByText("SELECT A SYMBOL TO SEE ITS VERDICT")).toBeVisible();
  });

  test("suggestions carry NO halal verdict — that would be a curated buy list", async ({ page }) => {
    // Compliance guard, not cosmetics. A dropdown of names each stamped
    // "Halal ✓" stops being an impersonal lookup and becomes a recommendation.
    await signedIn(page, { fixtures: SUGGESTIONS });
    await openScreener(page);
    await page.getByPlaceholder(/ticker or company/i).fill("nvidia");
    const listbox = page.getByRole("listbox", { name: /matching symbols/i });
    await expect(listbox).not.toContainText(/halal/i);
    await expect(listbox).not.toContainText(/non-compliant/i);
  });

  test("picking a suggestion screens it and shows the verdict", async ({ page }) => {
    await signedIn(page, { fixtures: { ...SUGGESTIONS, ...HALAL_VERDICT } });
    await openScreener(page);
    await page.getByPlaceholder(/ticker or company/i).fill("nvidia");
    await page.getByRole("option", { name: /NVDA/ }).first().click();
    await expect(page.getByText("Halal", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /why/i }).first()).toBeVisible();
  });

  test("keyboard: arrow down then Enter selects without touching the mouse", async ({ page }) => {
    await signedIn(page, { fixtures: { ...SUGGESTIONS, ...HALAL_VERDICT } });
    await openScreener(page);
    const input = page.getByPlaceholder(/ticker or company/i);
    await input.fill("nvidia");
    await expect(page.getByRole("listbox", { name: /matching symbols/i })).toBeVisible();
    await input.press("ArrowDown");
    await input.press("Enter");
    await expect(page.getByText("Halal", { exact: true }).first()).toBeVisible();
  });

  test("an unscreenable symbol shows an error, not a neutral badge", async ({ page }) => {
    // "unknown" rendered as a grey chip reads like an answer. It isn't.
    await signedIn(page, {
      fixtures: { "/api/screen": { provider: "finnhub", verdict: { tk: "ZZZZ", status: "unknown" } } },
    });
    await openScreener(page);
    await page.getByPlaceholder(/ticker or company/i).fill("ZZZZ");
    await page.getByRole("button", { name: /^screen$/i }).click();
    await expect(page.getByText(/couldn't screen zzzz/i)).toBeVisible();
  });
});
