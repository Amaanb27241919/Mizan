/**
 * Every demo destination must actually show something.
 *
 * Found on 2026-09-29 by walking demo mode rather than reading the code. Three
 * sub-tabs rendered a folded header and NOTHING else — clicking "Spending",
 * "Recurring" or "Sadaqah" gave you a title, a summary line, and a ▸ chevron.
 * The data was there (Recurring had 3 subscriptions at $1,167.99/mo); it was
 * behind a CollapsibleTile that defaults closed. `textContent` was SHORTER than
 * the visible text, which is the tell: CollapsibleTile conditionally renders,
 * so the body was not merely hidden, it did not exist.
 *
 * Folded-by-default was correct when these were sections on one long Finances
 * scroll. The 2026-08-25 reorg turned each into a destination, and CLAUDE.md §5
 * already states the rule that got missed: "a section that becomes a
 * destination owes the reader an empty state — behind a tab it is a blank
 * screen you clicked into."
 *
 * WHY A CHARACTER-COUNT CHECK WAS NOT ENOUGH. The first version of this flagged
 * panes under 200 visible characters and caught only Recurring, because
 * Spending's two collapsed headers and Sadaqah's one exceed 200 on their own.
 * Counting aria-expanded state instead found all three. The rule below is
 * therefore structural, not a length heuristic: a destination whose tiles are
 * ALL folded and which has almost no text of its own is a blank screen.
 */
import { test, expect } from "@playwright/test";
import { signedIn, appReady } from "./support/app.js";

const TABS = ["overview", "finances", "portfolio", "goals", "advisor", "settings"];
const DEMO = { storage: { mizan_demo: "1" } };
// Things §9 says must never reach a user. \bnull\b included deliberately: a
// raw null in a formatted figure is the shape of a broken formatter.
const GARBAGE = /\bNaN\b|\[object Object\]|\$NaN|\bundefined\b/;

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Walk every tab and sub-tab in demo mode, calling `probe` on each pane. */
async function eachDemoPane(page, probe) {
  for (const tab of TABS) {
    const btn = page.locator(`[data-tour="nav-${tab}"]`);
    if (!(await btn.count())) continue;
    await btn.click({ force: true });
    await page.waitForTimeout(400);
    const subs = await page.locator(".mz-tabbar > button").allInnerTexts();
    for (const sub of subs.length ? subs : ["(default)"]) {
      if (sub !== "(default)") {
        const sb = page.locator(".mz-tabbar > button", { hasText: new RegExp(`^${esc(sub)}$`) });
        if (await sb.count()) { await sb.first().click({ force: true }); await page.waitForTimeout(400); }
      }
      await probe(`${tab} / ${sub}`);
    }
  }
}

test.describe("demo surfaces", () => {
  test("no destination is entirely folded", async ({ page }) => {
    test.setTimeout(240_000);
    await signedIn(page, DEMO);
    await page.goto("/");
    await appReady(page);

    const blank = [];
    await eachDemoPane(page, async (where) => {
      const m = await page.evaluate(() => {
        const main = document.querySelector("main") || document.body;
        const closed = main.querySelectorAll('[aria-expanded="false"]').length;
        const open = main.querySelectorAll('[aria-expanded="true"]').length;
        // The pane's OWN text, with every collapsible header removed — what a
        // reader sees if they open nothing.
        const clone = main.cloneNode(true);
        clone.querySelectorAll("[aria-expanded]").forEach((n) => n.remove());
        const strip = document.querySelector(".mz-tabbar")?.textContent || "";
        return { closed, open, body: (clone.textContent || "").replace(strip, "").trim().length };
      });
      if (m.closed > 0 && m.open === 0 && m.body < 120) {
        blank.push(`${where} (${m.closed} folded tile(s), ${m.body} chars of its own)`);
      }
    });

    expect(blank, "These destinations render a folded header and nothing else. Give the "
      + "tile that IS the destination `defaultOpen`:\n  " + blank.join("\n  ")).toEqual([]);
  });

  test("no demo screen shows a broken value or logs an error", async ({ page }) => {
    test.setTimeout(240_000);
    const errors = [];

    // A JS exception is always the app's fault.
    page.on("pageerror", (e) => errors.push("pageerror: " + String(e.message).slice(0, 200)));

    // Console errors, MINUS the ones that only say the network misbehaved.
    // The first version of this asserted on every console error and went red
    // on `net::ERR_INTERNET_DISCONNECTED` — a laptop wifi blip while Chromium
    // fetched Google Fonts. A guard that fails on whether the machine has
    // internet teaches people to ignore red, which CLAUDE.md is explicit is
    // worse than having no guard.
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const t = m.text();
      if (/net::ERR_|Failed to load resource/i.test(t)) return;   // see requestfailed below
      errors.push(t.slice(0, 200));
    });

    // Resource failures are judged by ORIGIN instead of ignored. A font or
    // other third-party asset failing is the network's problem; one of OUR
    // OWN files failing is a broken deploy — a missing hashed bundle is served
    // as index.html by Vercel's SPA rewrite and crashes module loading, which
    // is the exact shape of a "loading and rendering error".
    page.on("requestfailed", (req) => {
      try {
        const u = new URL(req.url());
        const base = new URL(page.url());
        if (u.host === base.host) errors.push(`same-origin request failed: ${u.pathname}`);
      } catch { /* unparseable url — ignore */ }
    });

    await signedIn(page, DEMO);
    await page.goto("/");
    await appReady(page);

    const found = [];
    await eachDemoPane(page, async (where) => {
      // textContent, not innerText: a folded panel's garbage is invisible to
      // innerText, which is how a broken formatter could hide behind a chevron.
      const body = await page.evaluate(() =>
        (document.querySelector("main") || document.body).textContent || "");
      const g = body.match(GARBAGE);
      if (g) found.push(`${where}: "${g[0]}"`);
      if (/Could not load|Network error|Something went wrong/i.test(body)) {
        found.push(`${where}: error text`);
      }
    });

    expect(found, "broken values on demo screens:\n  " + found.join("\n  ")).toEqual([]);
    expect([...new Set(errors)], "console errors in demo:\n  " + [...new Set(errors)].join("\n  ")).toEqual([]);
  });
});
