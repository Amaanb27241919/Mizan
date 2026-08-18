/**
 * MĪZAN — responsive guards for real phone viewports.
 *
 * WHY THIS EXISTS: the app is installable as a PWA and is used on phones, but
 * every responsive rule it had was keyed on WIDTH alone and nothing ever
 * rendered it below 320px-wide desktop Chrome. The 2026-08-15 sweep found, on
 * shipping devices:
 *   · the bottom dock overflowing by 71px at 320 and 13px at 360 — and 360 is
 *     the most common Android width in the world, so "Settings" sat off-edge
 *   · the Screener's control row running up to 169px past the viewport, taking
 *     the "Re-screen" button with it, on EVERY phone width up to 430
 *   · the notification bell painting on top of the HALAL wordmark badge,
 *     because the header's action group was flex-shrink:1 with min-width:0 and
 *     spilled its surplus leftward
 *   · every phone in LANDSCAPE (568–932px WIDE) escaping the max-width:640px
 *     touch-target rules entirely, so sub-tabs rendered at 33px
 *
 * Three things make those catchable here and nowhere else:
 *   1. `html{overflow-x:clip}` means over-wide content is silently CLIPPED, not
 *      scrollable — there is no scrollbar to notice, so it must be measured.
 *   2. hasTouch (playwright.config.js) is what makes Chromium report
 *      `pointer: coarse`. Without it the touch rules never evaluate and the
 *      suite passes by not testing them.
 *   3. Landscape is a separate axis, not a smaller width: 320–430px of HEIGHT
 *      at 568–932px of width.
 */
import { test, expect } from "@playwright/test";
import { signedIn, appReady } from "./support/app.js";

// Real shipping devices, not round numbers.
const PORTRAIT = [
  { w: 320, h: 568, n: "iPhone SE (1st gen) — narrowest supported" },
  { w: 360, h: 640, n: "most common Android width" },
  { w: 390, h: 844, n: "iPhone 13/14/15" },
  { w: 430, h: 932, n: "iPhone 15 Pro Max" },
];
const LANDSCAPE = [
  { w: 568, h: 320, n: "SE landscape — shortest viewport" },
  { w: 932, h: 430, n: "Pro Max landscape" },
];
const TABS = ["overview", "finances", "portfolio", "goals", "advisor", "settings"];

/** Controls whose right edge escapes `main`, ignoring intentional scrollers. */
async function clippedIn(page, root = "main") {
  return page.evaluate((sel) => {
    const r0 = document.querySelector(sel);
    if (!r0) return [];
    const limit = r0.getBoundingClientRect().right + 1;   // +1 for sub-pixel
    const inScroller = (el) => {
      for (let n = el.parentElement; n && n !== r0; n = n.parentElement) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === "auto" || ox === "scroll") return true;  // tab strips scroll on purpose
      }
      return false;
    };
    const bad = [];
    for (const el of r0.querySelectorAll("input,select,button,textarea,a")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (inScroller(el)) continue;
      if (r.right > limit) {
        const label = el.getAttribute("aria-label") || el.getAttribute("placeholder")
          || el.textContent?.trim().slice(0, 24) || el.tagName;
        bad.push(`${label} (right=${Math.round(r.right)} > ${Math.round(limit)})`);
      }
    }
    return [...new Set(bad)];
  }, root);
}

test.describe("responsive — portrait phones", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) > 400, "portrait project only");

  for (const { w, h, n } of PORTRAIT) {
    test(`${w}x${h} (${n}): nothing overflows, on any tab`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await signedIn(page);
      await page.goto("/");
      await appReady(page);

      for (const tab of TABS) {
        const btn = page.locator(`[data-tour="nav-${tab}"]`);
        if (!(await btn.count())) continue;
        await btn.click({ force: true });
        await page.waitForTimeout(300);

        const { scrollWidth, clientWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(scrollWidth, `[${tab}] page is wider than the viewport`)
          .toBeLessThanOrEqual(clientWidth + 1);

        const clipped = await clippedIn(page);
        expect(clipped, `[${tab}] clipped controls:\n  ${clipped.join("\n  ")}`).toEqual([]);

        // Walking only the six top-level tabs is NOT enough, and this is not a
        // hypothetical: the worst defect of the 2026-08-15 sweep — the Screener
        // control row running 169px off-screen and taking "Re-screen" with it —
        // lives on a SUB-tab. A first version of this spec passed against that
        // exact regression because it never clicked into one. Most of the app's
        // surface area is behind these strips.
        // Re-query the strip on every iteration and click by INDEX inside a
        // single evaluate. Holding locator handles across clicks does not work
        // here: switching sub-tab re-renders the strip, the held element
        // detaches, and Playwright then burns its full timeout on each one
        // (a first version of this walk took 1.2 hours for that reason).
        const subCount = await page.locator(".mz-tabbar > button").count();
        for (let i = 0; i < subCount; i++) {
          const name = await page.evaluate((idx) => {
            const b = document.querySelectorAll(".mz-tabbar > button")[idx];
            if (!b) return null;
            const label = b.textContent?.trim().slice(0, 20) || `#${idx}`;
            b.click();
            return label;
          }, i);
          if (!name) continue;
          await page.waitForTimeout(250);
          const subClipped = await clippedIn(page);
          expect(subClipped, `[${tab} › ${name}] clipped controls:\n  ${subClipped.join("\n  ")}`).toEqual([]);
        }
      }
    });
  }

  // The dock is the primary navigation. It scrolls horizontally when it does
  // not fit, so nothing is "clipped" — the last item is just undiscoverable.
  test("the bottom dock fits every nav item without scrolling", async ({ page }) => {
    for (const { w, h } of PORTRAIT) {
      await page.setViewportSize({ width: w, height: h });
      await signedIn(page);
      await page.goto("/");
      await appReady(page);
      // Re-apply the viewport AFTER navigation. Resizing before goto() leaves
      // the media queries evaluated against the previous size for this loop's
      // second and later iterations — the dock measured 14-16px type instead
      // of the 11px floor and reported up to 89px of phantom overflow. The app
      // was fine; the harness was measuring a stale layout. Reproduced by
      // hand at 320x568 (0px direct, 41px inside the loop) before changing
      // anything, so this is a test fix and not a masked regression.
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(150);
      const over = await page.evaluate(() => {
        const d = document.querySelector(".mz-dock");
        return d ? d.scrollWidth - d.clientWidth : 0;
      });
      expect(over, `dock overflows by ${over}px at ${w}px wide`).toBeLessThanOrEqual(1);
    }
  });

  // Two flex boxes can report non-overlapping rects while their CHILDREN paint
  // on top of each other — which is exactly how the bell ended up over the
  // HALAL badge. So this compares leaf nodes, not containers.
  // Runs in BOTH states. The empty state is not representative: the broker
  // force-refresh button only exists once accounts are connected, so it never
  // rendered in this guard and pushed the header 17px past a 320px viewport
  // the moment real data arrived. Same class of gap as the fixture bugs — a
  // test that only ever sees one state proves one state.
  for (const connected of [false, true]) {
  test(`header chrome never overlaps itself or leaves the viewport (${connected ? "with accounts" : "empty"})`, async ({ page }) => {
    // Widths deliberately extend past phones: sweeping found the clock strip
    // appeared at ~601px and overflowed until ~1010px, which is iPad portrait.
    const WIDTHS = [...PORTRAIT, { w: 600, h: 900 }, { w: 768, h: 1024 }, { w: 834, h: 1112 }];
    for (const { w, h } of WIDTHS) {
      await page.setViewportSize({ width: w, height: h });
      await signedIn(page, connected ? { storage: { mizan_demo: "1" } } : {});
      await page.goto("/");
      await appReady(page);
      await page.waitForTimeout(400);
      const res = await page.evaluate(() => {
        const head = document.querySelector(".mz-status");
        const leaves = [...head.querySelectorAll("*")].filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && e.children.length === 0;
        });
        const name = (e) => e.textContent?.trim().slice(0, 14) || e.getAttribute("aria-label") || e.tagName;
        const overlaps = [];
        for (let i = 0; i < leaves.length; i++) {
          for (let j = i + 1; j < leaves.length; j++) {
            const A = leaves[i], B = leaves[j];
            // Parts of one SVG icon legitimately overlap each other.
            if (A.closest("svg") && A.closest("svg") === B.closest("svg")) continue;
            const a = A.getBoundingClientRect(), b = B.getBoundingClientRect();
            const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (ox > 2 && oy > 2) overlaps.push(`"${name(A)}" over "${name(B)}"`);
          }
        }
        return { overlaps, maxRight: Math.max(...leaves.map((e) => e.getBoundingClientRect().right)) };
      });
      expect(res.overlaps, `header overlaps at ${w}px: ${res.overlaps.join(", ")}`).toEqual([]);
      expect(res.maxRight, `header content runs past the ${w}px viewport`).toBeLessThanOrEqual(w + 1);
    }
  });
  }

  // Login renders INSTEAD of MizanApp, so none of THEME_CSS loads there. Its
  // touch targets and layout have to be verified separately or not at all.
  test("the login screen fits and its controls are tappable", async ({ page }) => {
    for (const { w, h } of PORTRAIT) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto("/");
      await page.waitForTimeout(900);
      const r = await page.evaluate(() => {
        const de = document.documentElement;
        const small = [];
        for (const el of document.querySelectorAll("button, a, input")) {
          const b = el.getBoundingClientRect();
          if (b.width === 0 || b.height === 0) continue;
          if (b.height < 44) small.push(`"${el.textContent?.trim().slice(0, 18) || el.tagName}" h=${Math.round(b.height)}`);
        }
        return { over: de.scrollWidth - de.clientWidth, small: [...new Set(small)] };
      });
      expect(r.over, `login overflows at ${w}px`).toBeLessThanOrEqual(1);
      expect(r.small, `login controls under 44px at ${w}px: ${r.small.join(", ")}`).toEqual([]);
    }
  });
});

test.describe("information architecture", () => {
  // Pins the 2026-08-18 IA decision. Portfolio → Tools → Backtest was the app's
  // ONLY depth-3 branch, hidden behind a junk-drawer label that described none
  // of its five unrelated contents. Flattened to one strip; nothing was removed
  // (21 destinations before and after), it just stopped being nested.
  test("no navigation is more than two levels deep", async ({ page }) => {
    await signedIn(page, { storage: { mizan_demo: "1" } });
    await page.goto("/");
    await appReady(page);
    const deep = [];
    for (const tab of TABS) {
      const btn = page.locator(`[data-tour="nav-${tab}"]`);
      if (!(await btn.count())) continue;
      await btn.click({ force: true });
      await page.waitForTimeout(400);
      const count = await page.locator(".mz-tabbar > button").count();
      for (let i = 0; i < count; i++) {
        await page.evaluate((idx) => document.querySelectorAll(".mz-tabbar > button")[idx]?.click(), i);
        await page.waitForTimeout(220);
        // A SECOND strip appearing means a third level.
        const strips = await page.locator(".mz-tabbar").count();
        if (strips > 1) deep.push(`${tab} › item ${i + 1}`);
      }
    }
    expect([...new Set(deep)], `depth-3 navigation found at: ${deep.join(", ")}`).toEqual([]);
  });

  test("Zakat is reachable from a nav label that suggests it", async ({ page }) => {
    // Zakat is Mizan's #2 value proposition and it lived behind a tab called
    // "Goals", which gives no hint it is there. The tab is now "Plan".
    await signedIn(page);
    await page.goto("/");
    await appReady(page);
    const dock = await page.locator(".mz-dock").textContent();
    expect(dock).toContain("Plan");
    expect(dock).not.toContain("Goals");   // the old, misleading label
    await page.locator('[data-tour="nav-goals"]').click({ force: true });
    await page.waitForTimeout(450);
    await expect(page.locator(".mz-tabbar > button", { hasText: /^Zakat$/ })).toBeVisible();
  });
});

test.describe("readability floor", () => {
  // The point of the fluid type scale. Mizan previously rendered 39% of its
  // type at 9-10px — under the ~11px Apple and Google both treat as the
  // practical minimum for secondary text — which is why it read as dense at
  // every screen size rather than only small ones.
  //
  // Checked at the NARROWEST supported width, where clamp() sits at its floor.
  const FLOOR_PX = 10.9;   // 11px token, minus sub-pixel rounding slack

  for (const tab of ["overview", "finances", "portfolio", "goals", "settings"]) {
    test(`no text renders below the legibility floor — ${tab}`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 720 });
      await signedIn(page, { storage: { mizan_demo: "1" } });
      await page.goto("/");
      await appReady(page);
      const btn = page.locator(`[data-tour="nav-${tab}"]`);
      if (await btn.count()) { await btn.click({ force: true }); await page.waitForTimeout(500); }

      const tooSmall = await page.evaluate((floor) => {
        const bad = [];
        for (const el of document.querySelectorAll("main *, .mz-status *, .mz-dock *")) {
          const text = el.textContent?.trim();
          if (!text || el.children.length) continue;          // leaf text only
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;      // not rendered
          const fs = parseFloat(getComputedStyle(el).fontSize);
          if (fs > 0 && fs < floor) bad.push(`"${text.slice(0, 22)}" ${fs.toFixed(1)}px`);
        }
        return [...new Set(bad)].slice(0, 8);
      }, FLOOR_PX);

      expect(tooSmall, `text below ${FLOOR_PX}px on ${tab}:\n  ${tooSmall.join("\n  ")}`).toEqual([]);
    });
  }

  test("type actually scales with the viewport, not just at breakpoints", async ({ page }) => {
    await signedIn(page);
    await page.goto("/");
    await appReady(page);
    const read = async (w) => {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(200);
      return page.evaluate(() => {
        const s = document.createElement("span");
        s.style.fontSize = "var(--fs-2xs)";
        document.body.appendChild(s);
        const v = parseFloat(getComputedStyle(s).fontSize);
        s.remove();
        return v;
      });
    };
    const small = await read(320), mid = await read(768), large = await read(1440);
    expect(small).toBeGreaterThanOrEqual(10.9);        // floor honoured
    expect(mid).toBeGreaterThan(small);                 // genuinely fluid
    expect(large).toBeGreaterThan(mid);
    expect(large).toBeLessThanOrEqual(12.1);            // capped, not runaway
  });
});

test.describe("responsive — landscape phones", () => {
  test.skip(({ viewport }) => (viewport?.height ?? 0) > 500, "landscape project only");

  // Landscape is where the width-keyed rules all missed: 568–932px wide is
  // past every max-width breakpoint, while the viewport is only 320–430 tall.
  for (const { w, h, n } of LANDSCAPE) {
    test(`${w}x${h} (${n}): fits and stays tappable`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await signedIn(page);
      await page.goto("/");
      await appReady(page);
      for (const tab of TABS) {
        const btn = page.locator(`[data-tour="nav-${tab}"]`);
        if (!(await btn.count())) continue;
        await btn.click({ force: true });
        await page.waitForTimeout(300);
        const clipped = await clippedIn(page);
        expect(clipped, `[${tab}] clipped in landscape:\n  ${clipped.join("\n  ")}`).toEqual([]);
      }
      // Sub-tab bars dropped to 33px tall here while measuring 40px in
      // portrait on the same device — the width-keyed rule simply did not
      // apply. They are the primary navigation within a tab.
      await page.locator('[data-tour="nav-portfolio"]').click({ force: true });
      await page.waitForTimeout(350);
      const subTabs = await page.evaluate(() =>
        [...document.querySelectorAll(".mz-tabbar > button")]
          .map((b) => Math.round(b.getBoundingClientRect().height)));
      expect(subTabs.length).toBeGreaterThan(0);
      for (const hh of subTabs) expect(hh, `sub-tab is ${hh}px tall`).toBeGreaterThanOrEqual(44);
    });
  }
});

test.describe("responsive — viewport height handling", () => {
  // `100vh` on a phone is the URL-bar-RETRACTED height, so a 100vh box is
  // always taller than what the user can see and any calc(100vh - X) budget
  // under-reserves. Everything sizing to the viewport goes through --mz-vh.
  test("viewport heights resolve through --mz-vh, not raw vh", async ({ page }) => {
    await signedIn(page);
    await page.goto("/");
    await appReady(page);
    const r = await page.evaluate(() => ({
      token: getComputedStyle(document.documentElement).getPropertyValue("--mz-vh").trim(),
      supportsDvh: CSS.supports("height", "100dvh"),
      rootMinHeight: getComputedStyle(document.querySelector("#root > div")).minHeight,
    }));
    expect(r.token, "--mz-vh must be defined").not.toBe("");
    // In any engine supporting dvh, the token must resolve to dvh — otherwise
    // the @supports upgrade silently regressed to the vh fallback.
    if (r.supportsDvh) expect(r.token).toBe("100dvh");
  });
});
