import { test, expect } from "@playwright/test";
import { signedIn, appReady } from "./support/app.js";

test.describe("app shell", () => {
  test("boots signed in and renders the authenticated UI", async ({ page }) => {
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(String(e)));

    await signedIn(page);
    await page.goto("/");
    await appReady(page);

    // The login form must NOT be present — if it is, the session stub failed
    // and every other test in this suite is testing the wrong page.
    await expect(page.getByPlaceholder("you@example.com")).toHaveCount(0);

    // Uncaught errors on boot are a real defect, not noise.
    expect(errors, `console errors on boot:\n${errors.join("\n")}`).toEqual([]);
  });

  test("paints the light theme before React mounts", async ({ page }) => {
    // Guards the 2026-08-10 fix: index.html used to paint #07080E (a
    // terminal-era near-black) so every cold load flashed dark before the
    // paper canvas appeared. The pre-paint script must resolve the theme.
    await signedIn(page, { theme: "light" });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    const bg = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
    expect(bg).toBe("rgb(250, 248, 244)");   // #faf8f4
  });

  test("paints the dark theme before React mounts", async ({ page }) => {
    await signedIn(page, { theme: "dark" });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const bg = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
    expect(bg).toBe("rgb(14, 22, 38)");      // #0e1626
  });

  test("never scrolls horizontally", async ({ page }) => {
    // The 320px project is where this bites: overflow-x:clip means a too-wide
    // element is silently CUT OFF rather than producing a scrollbar, so this
    // asserts the document width instead of looking for a scrollbar.
    await signedIn(page);
    await page.goto("/");
    await appReady(page);
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, `content is ${scrollWidth}px in a ${clientWidth}px viewport`)
      .toBeLessThanOrEqual(clientWidth + 1);   // +1 absorbs sub-pixel rounding
  });
});
