import { test, expect } from "@playwright/test";
import { signedIn } from "./support/app.js";

/**
 * Text painting on top of text.
 *
 * CLAUDE.md §5 names this as a class that is invisible to every other check:
 * "flex parents can report honest non-overlapping rects while their CHILDREN
 * paint on top of each other". An overflow assertion passes, a screenshot at
 * one width looks fine, and the defect only appears for a particular string
 * length — which is exactly how the account card shipped with its
 * `BROKERAGE · ····6473` eyebrow running underneath an absolutely-positioned
 * INVESTMENT badge.
 *
 * So this measures PAINTED rectangles of leaf text nodes and fails when two
 * of them genuinely intersect. It is deliberately generic: the bug it was
 * written for is fixed, and the point is to catch the next one.
 */

const ACCOUNTS = [
  // The exact shape that broke: an investment account whose subtype plus mask
  // makes the eyebrow long enough to reach the badge.
  { account_id: "a1", institution_name: "Brokerage", name: "Alpha",
    official_name: "Alpha Brokerage Account", type: "investment", subtype: "brokerage",
    mask: "6473", current_bal: 0, available_bal: null, iso_currency: "USD" },
  { account_id: "a2", institution_name: "Brokerage", name: "Bravo",
    official_name: "Bravo Brokerage Account", type: "investment", subtype: "brokerage",
    mask: "6479", current_bal: 0, available_bal: null, iso_currency: "USD" },
  // A longer subtype, to make sure the fix is not tuned to one string.
  { account_id: "a3", institution_name: "Brokerage", name: "Charlie",
    official_name: "Charlie Retirement", type: "investment", subtype: "non-taxable brokerage account",
    mask: "1234", current_bal: 0, available_bal: null, iso_currency: "USD" },
];

const fixtures = {
  "/api/user/features": { trading_bot: false, full_auto: false, is_root: false,
    trading_bot_consented: false, needs_name: false, first_name: "T", last_name: "U" },
  "/api/plaid/accounts": { accounts: ACCOUNTS },
};

/** Leaf text nodes only — a parent legitimately contains its children. */
const OVERLAP_PROBE = () => {
  const rects = [];

  // Fixed-position chrome — the floating nav dock, modals, toasts — is
  // SUPPOSED to float over the page. Reporting it would make this probe cry
  // wolf on every narrow viewport and get itself deleted, which is worse than
  // not having it. Anything inside a fixed ancestor is skipped.
  const inFixedChrome = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const pos = getComputedStyle(n).position;
      if (pos === "fixed" || pos === "sticky") return true;
    }
    return false;
  };

  const walk = (el) => {
    const kids = [...el.children];
    const hasText = [...el.childNodes].some(
      (n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (hasText && !inFixedChrome(el)) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width > 1 && r.height > 1 && cs.visibility !== "hidden" && cs.opacity !== "0") {
        rects.push({ text: el.textContent.trim().slice(0, 40), r });
      }
    }
    kids.forEach(walk);
  };
  walk(document.body);

  const hits = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i].r, b = rects[j].r;
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      // Require a real 2-D intersection, with a tolerance so that normal
      // inline-baseline adjacency is not reported.
      if (ox > 4 && oy > 4) {
        hits.push({ a: rects[i].text, b: rects[j].text, ox: Math.round(ox), oy: Math.round(oy) });
      }
    }
  }
  return hits;
};

// Desktop project only. This spec sets its OWN viewport for each width, so
// running it under all three Playwright projects would test 320px three times
// for no extra signal — and it measurably slowed the suite enough to push the
// slowest walk-every-tab specs past their timeouts when first added.
for (const width of [1440, 768, 320]) {
  test(`account cards: no text paints over text at ${width}px`, async ({ page }) => {
    test.skip(test.info().project.name !== "desktop", "sets its own viewport; one project is enough");
    await page.setViewportSize({ width, height: 900 });
    await signedIn(page, { fixtures, storage: { mizan_nav: "finances" } });
    await page.goto("/");
    // Wait for the thing being measured, not for a guessed duration.
    await page.getByText("INVESTMENT", { exact: true }).first().waitFor();

    // Measure TWICE, and only report an overlap present in both. A layout
    // defect persists; a rect captured mid-transition or while content is
    // still settling does not. The first version used a fixed 1200ms wait and
    // was flaky under parallel load — and a flaky guard gets disabled, which
    // is worse than not having one.
    const first = await page.evaluate(OVERLAP_PROBE);
    await page.waitForTimeout(600);
    const second = await page.evaluate(OVERLAP_PROBE);
    const key = (h) => `${h.a}||${h.b}`;
    const persistent = new Set(second.map(key));
    const hits = first.filter((h) => persistent.has(key(h)));
    expect(
      hits,
      `text overlaps at ${width}px:\n` +
      hits.map((h) => `  "${h.a}" over "${h.b}"  (${h.ox}x${h.oy}px)`).join("\n"),
    ).toEqual([]);
  });
}

test("the INVESTMENT badge and the eyebrow never share space", async ({ page }) => {
  test.skip(test.info().project.name !== "desktop", "sets its own viewport; one project is enough");
  // The specific regression, asserted directly rather than relying on the
  // generic probe to happen to notice it.
  await page.setViewportSize({ width: 420, height: 900 });   // narrow enough to force the collision
  await signedIn(page, { fixtures, storage: { mizan_nav: "finances" } });
  await page.goto("/");

  const badge = page.getByText("INVESTMENT", { exact: true }).first();
  await expect(badge).toBeVisible();

  const boxes = await page.evaluate(() => {
    const badgeEl = [...document.querySelectorAll("span,div")]
      .find((e) => e.textContent.trim() === "INVESTMENT");
    if (!badgeEl) return null;
    const head = badgeEl.closest(".mz-acct-head");
    const eyebrow = head && [...head.children].find((c) => c !== badgeEl);
    if (!eyebrow) return null;
    const a = eyebrow.getBoundingClientRect(), b = badgeEl.getBoundingClientRect();
    return {
      overlapX: Math.min(a.right, b.right) - Math.max(a.left, b.left),
      eyebrow: eyebrow.textContent.trim(),
    };
  });

  expect(boxes, "expected an .mz-acct-head wrapping both").not.toBeNull();
  expect(boxes.overlapX, `eyebrow "${boxes.eyebrow}" overlaps the badge by ${boxes.overlapX}px`)
    .toBeLessThanOrEqual(0);
});
