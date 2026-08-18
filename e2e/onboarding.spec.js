/**
 * The onboarding flow — the FIRST screen a new user ever sees.
 *
 * This spec should have existed since the suite was built: e2e/support/app.js
 * seeds `mizan_onboarded: "1"` so feature tests can reach features, and its own
 * comment promises "Onboarding itself gets its own test (onboarding.spec.js)".
 * That file was never written, so onboarding had never been rendered by any
 * test at any width.
 *
 * The cost showed up 2026-08-18: an owner screenshot from Safari on a real
 * iPhone showed the "You're set" tab list with each description crushed into
 * ~156px and wrapping to six or seven lines, turning six short rows into an
 * endless scroll. Every other surface in the app was guarded at 320px. This
 * one was invisible precisely because the harness skipped it.
 */
import { test, expect } from "@playwright/test";
import { signedIn, appReady } from "./support/app.js";

/** Boot a genuinely NEW user — the one state the rest of the suite opts out of. */
async function firstRun(page) {
  await signedIn(page);
  // Undo the "returning user" markers the shared helper seeds.
  await page.addInitScript(() => {
    window.localStorage.removeItem("mizan_onboarded");
    window.localStorage.removeItem("mizan_tour_seen");
  });
  await page.goto("/");
  await appReady(page);
  await page.waitForTimeout(900);
}

/** Walk to the final "You're set" step, whatever the step count is. */
async function reachLastStep(page) {
  for (let i = 0; i < 8; i++) {
    // Detect the DOM, not the text: body textContent includes the inline
    // <style> block, so a /You're set/ match silently never fired and this
    // helper skipped its own test forever.
    if (await page.locator(".mz-onboard-row").count()) return true;
    const next = page.getByRole("button", { name: /next|continue|skip|get started/i }).first();
    if (!(await next.count())) break;
    // At 320px the advance button can sit below the fold, and force:true does
    // not bypass Playwright's viewport check — scroll it in first.
    await next.scrollIntoViewIfNeeded().catch(() => {});
    await next.click({ force: true }).catch(() => {});
    await page.waitForTimeout(450);
  }
  return (await page.locator(".mz-onboard-row").count()) > 0;
}

test.describe("onboarding", () => {
  test("a brand-new user sees onboarding at all", async ({ page }) => {
    await firstRun(page);
    const shown = await page.locator("body").textContent();
    expect(shown, "no onboarding surface for a first-run user").toMatch(/MĪZAN|Welcome|You're set|Connect/i);
  });

  // Nested so the viewport skip sits in a describe body, which is where
  // Playwright requires a function-form test.skip() to live.
  test.describe("phone layout", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) > 500, "phone layout only");
    test("the tab list does not wrap into an endless scroll on a phone", async ({ page }) => {
    await firstRun(page);
    // Deliberately NOT a conditional skip — a guard that quietly opts out is
    // the failure mode this whole spec exists to correct.
    expect(await reachLastStep(page), "never reached the tab-list step").toBe(true);

    const rows = page.locator(".mz-onboard-row");
    const n = await rows.count();
    expect(n, "expected the six-tab list").toBeGreaterThan(0);

    // Before the fix each row was ~300-400px tall because the description had
    // ~156px to wrap in. A row holding one short sentence should not need
    // anything like a third of a phone screen.
    for (let i = 0; i < n; i++) {
      const h = (await rows.nth(i).boundingBox())?.height ?? 0;
      expect(h, `onboarding row ${i + 1} is ${Math.round(h)}px tall`).toBeLessThan(190);
      }

      // The reported bug was not "ugly" — it was UNREACHABLE. A fixed, centred
      // flex overlay with no overflow clips its content at BOTH ends, so the
      // last row and the finish button could not be scrolled to at all.
      const reachable = await page.evaluate(() => {
        const ov = document.querySelector(".mz-onboard-overlay");
        const rows = [...document.querySelectorAll(".mz-onboard-row")];
        if (!ov || !rows.length) return false;
        ov.scrollTop = ov.scrollHeight;
        const last = rows[rows.length - 1].getBoundingClientRect();
        return last.top >= -2 && last.bottom <= window.innerHeight + 2;
      });
      expect(reachable, "the last onboarding row cannot be scrolled into view").toBe(true);
    });
  });

  test("nothing in onboarding overflows the viewport", async ({ page }) => {
    await firstRun(page);
    await reachLastStep(page);
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });
});
