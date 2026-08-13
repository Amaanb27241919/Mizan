import { test, expect } from "@playwright/test";
import { signedIn, appReady } from "./support/app.js";

/**
 * Guards for the two P0s found by the 2026-08-13 UI audit.
 *
 * Both were invisible to 397 unit tests because neither is a pure function:
 * one is a layout budget, the other is which components call a hook.
 */

/** Every element inside `root` must fit within it — nothing clipped. */
async function assertNoOverflow(page, rootSelector) {
  const overflowing = await page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return ["ROOT_NOT_FOUND:" + sel];
    const limit = root.getBoundingClientRect().right + 1;   // +1 for sub-pixel
    const bad = [];
    const inScroller = (el) => {
      for (let n = el.parentElement; n && n !== root; n = n.parentElement) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === "auto" || ox === "scroll") return true;   // reachable by scrolling
      }
      return false;
    };
    for (const el of root.querySelectorAll("input,select,button,textarea")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;        // hidden
      if (inScroller(el)) continue;                          // tab strips scroll on purpose
      if (r.right > limit) {
        const label = el.getAttribute("aria-label") || el.getAttribute("placeholder")
          || el.textContent?.trim().slice(0, 24) || el.tagName;
        bad.push(`${label} (right=${Math.round(r.right)} > ${Math.round(limit)})`);
      }
    }
    return bad;
  }, rootSelector);
  expect(overflowing, `clipped controls:\n  ${overflowing.join("\n  ")}`).toEqual([]);
}

test.describe("mobile layout @320", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) > 400, "320px project only");

  test("the page never exceeds the viewport", async ({ page }) => {
    await signedIn(page);
    await page.goto("/");
    await appReady(page);
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });

  test("Goals: every form control stays on screen", async ({ page }) => {
    // The audit found DebtForm's three fixed columns needing ~624px inside a
    // 248px budget, putting the REQUIRED "Original ($)" field off-screen —
    // adding a debt was impossible on a phone. `overflow-x:clip` meant no
    // scrollbar ever appeared to hint at it.
    await signedIn(page);
    await page.goto("/");
    await appReady(page);
    await page.locator('[data-tour="nav-goals"]').click({ force: true });
    await expect(page.locator("main")).toBeVisible();
    await assertNoOverflow(page, "main");
  });
});

test.describe("privacy mode", () => {
  test("hiding values masks the Goals tab, not just the headline", async ({ page }) => {
    // Privacy mode used to be decorative: useHideValues() was called in 3
    // places, and Goals took a `mask` prop nobody passed — so its default
    // (v) => v made every mask() call a no-op. Goal and debt balances sat in
    // cleartext directly beneath the MASKED net-worth headline.
    await signedIn(page, { storage: { mizan_hide_values: "1" } });
    await page.goto("/");
    await appReady(page);
    await page.locator('[data-tour="nav-goals"]').click({ force: true });
    await expect(page.locator("main")).toBeVisible();

    const leaked = await page.evaluate(() => {
      const text = document.querySelector("main")?.textContent || "";
      // Any $ followed by digits is an unmasked amount while privacy is on.
      return (text.match(/\$[\d,]+(\.\d{2})?/g) || []).slice(0, 8);
    });
    expect(leaked, `unmasked amounts with privacy on: ${leaked.join(", ")}`).toEqual([]);
  });

  test("the mask flag is shared across components, not per-component state", async ({ page }) => {
    // The hook is localStorage + a window event, which is what lets any
    // component opt in without prop threading. If someone converts it to
    // component state, surfaces will disagree with each other.
    await signedIn(page, { storage: { mizan_hide_values: "1" } });
    await page.goto("/");
    await appReady(page);
    const masked = await page.evaluate(() =>
      (document.body.textContent || "").includes("••••••"));
    expect(masked, "expected at least one masked value on the Overview").toBe(true);
  });
});
