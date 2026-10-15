/**
 * Demo mode's "Mark Purified" works for the session and saves nothing.
 *
 * 2026-10-15: the launch video shows a click on "Mark Purified" and the row
 * turning PURIFIED. The button was disabled in demo mode, so the video showed
 * something the demo could not do. Demo now marks it for the session only —
 * no localStorage, no synced state, no Sadaqah entry — because demo data must
 * never leak into a real user's records (CLAUDE.md §13).
 */
import { test, expect } from "@playwright/test";
import { signedIn, appReady } from "./support/app.js";

test("demo: Mark Purified turns the row Purified, and writes nothing", async ({ page }) => {
  await signedIn(page, { storage: { mizan_demo: "1" } });
  await page.goto("/?tab=goals");
  await appReady(page);
  await page.locator(".mz-tabbar > button", { hasText: /^Zakat$/ }).first().click();

  const before = await page.evaluate(() => ({
    log: localStorage.getItem("mizan_purification_log"),
    sadaqah: localStorage.getItem("mizan_sadaqah"),
  }));
  const button = page.getByRole("button", { name: "Mark Purified" }).first();
  await expect(button).toBeEnabled();
  // The button leaves the row once clicked, so find the row again by its date.
  const date = (await page.locator("tr").filter({ has: button }).locator("td").nth(1).innerText()).trim();
  await button.click();
  await expect(page.locator("tr").filter({ hasText: date }).getByText("Purified", { exact: true })).toBeVisible();

  const after = await page.evaluate(() => ({
    log: localStorage.getItem("mizan_purification_log"),
    sadaqah: localStorage.getItem("mizan_sadaqah"),
  }));
  expect(after).toEqual(before);
});
