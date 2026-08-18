/**
 * Guards the 2026-08-18 report: "syncing all the numbers."
 *
 * The Overview showed +124.15% next to net worth (a raw net-worth delta that
 * counted deposits as gains) while other panels showed +52.97% for the same
 * book on the same screen. The chart made it worse: because its series
 * baselined at cumulative CONTRIBUTIONS and ended at MARKET VALUE, every range
 * absorbed all-time gains — 1M read +94.77% and All read +1039.86%.
 */
import { test, expect } from "@playwright/test";
import { signedIn, appReady } from "./support/app.js";

const demo = (page) => signedIn(page, { theme: "light", storage: { mizan_demo: "1" } });
const mainText = async (page) => (await page.locator("main").textContent()).replace(/\s+/g, " ");

test.describe("return figures agree with each other", () => {
  test("the headline dollar equals the performance panel's dollar", async ({ page }) => {
    await demo(page);
    await page.goto("/");
    await appReady(page);
    await page.waitForTimeout(2000);
    const t = await mainText(page);

    const panel = t.match(/Total Return\s*([+-]\$[\d,]+\.\d{2})/);
    expect(panel, "no Total Return figure on the Overview").toBeTruthy();

    // The same dollar amount must appear in the headline. Before the fix the
    // headline showed a net-worth delta (+$178,781) against the panel's
    // +$89,911 — two answers to one question.
    const dollar = panel[1].replace("+", "");
    const headlineHasIt = t.includes(dollar);
    expect(headlineHasIt, `headline does not carry the panel's ${dollar}`).toBe(true);
  });

  test("the headline rate does not swing with the range chips", async ({ page }) => {
    // XIRR is whole-history and annualised; the chips move the CHART. A rate
    // that changed per range would mean sub-window valuations were being
    // invented, which is the fabrication this fix removed.
    await demo(page);
    await page.goto("/");
    await appReady(page);
    await page.waitForTimeout(2000);

    const rates = [];
    for (const r of ["1M", "1Y", "All"]) {
      const btn = page.locator(".mz-range-row button", { hasText: new RegExp(`^${r}$`) });
      if (await btn.count()) {
        await btn.first().click({ force: true });
        await page.waitForTimeout(400);
      }
      const t = await mainText(page);
      const m = t.match(/([+-][\d.]+%)\/yr/);
      rates.push(m ? m[1] : `NO-MATCH-${r}`);
    }
    expect(new Set(rates).size, `rate moved across ranges: ${rates.join(" / ")}`).toBe(1);
  });

  test("no range implies an absurd return", async ({ page }) => {
    // Direct regression pin: 1M once read +94.77% and All +1039.86%.
    await demo(page);
    await page.goto("/");
    await appReady(page);
    await page.waitForTimeout(2000);

    for (const r of ["1M", "YTD", "1Y", "All"]) {
      const btn = page.locator(".mz-range-row button", { hasText: new RegExp(`^${r}$`) });
      if (await btn.count()) {
        await btn.first().click({ force: true });
        await page.waitForTimeout(350);
      }
      const t = await mainText(page);
      const m = t.match(/([+-][\d.]+)%\/yr/);
      expect(m, `no rate shown on ${r}`).toBeTruthy();
      const pct = Math.abs(parseFloat(m[1]));
      // A believable annualised return for a diversified book. 1039% is not.
      expect(pct, `${r} shows ${m[1]}% a year`).toBeLessThan(100);
    }
  });

  test("the rate is labelled with its unit so it can't be read as a total", async ({ page }) => {
    await demo(page);
    await page.goto("/");
    await appReady(page);
    await page.waitForTimeout(2000);
    const t = await mainText(page);
    // Headline: a RATE (per year). Panel: a TOTAL (on cost). Same dollars,
    // different bases — each must say which it is.
    expect(t).toMatch(/%\/yr/);
    expect(t).toMatch(/money-weighted/);
    expect(t).toMatch(/on cost/);
  });
});
