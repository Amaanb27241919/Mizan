/**
 * Demo mode on a browser that has never signed in here.
 *
 * Every other spec boots through `signedIn()`, which seeds six localStorage
 * keys — including `mizan_current_user_id`. That made a whole class of first-run
 * behaviour untestable, and it hid this: `mizan_demo` is a TRACKED_KEY, and
 * `hydrateUserState` wiped every tracked key whenever the stored user id did
 * not match, which is always true on a machine you have not signed in on.
 * App.jsx gates rendering on that hydrate finishing, so the flag was destroyed
 * BEFORE MizanApp read it. Demo silently turned itself off and the screen
 * showed "Connect your first brokerage" instead of the demo portfolio — which
 * from the outside is indistinguishable from the app failing to load, and is
 * how it was reported.
 *
 * Deliberately does NOT use signedIn(): seeding the very key whose absence
 * causes the bug would make this test pass against the broken code.
 */
import { test, expect } from "@playwright/test";
import { AUTH_STORAGE_KEY, fakeSession, TEST_USER } from "./support/app.js";

test("demo survives a first sign-in on a new machine", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + String(e.message).slice(0, 200)));
  page.on("requestfailed", (r) => {
    try {
      const u = new URL(r.url());
      if (u.host === new URL(page.url()).host) errors.push("same-origin failed: " + u.pathname);
    } catch { /* ignore */ }
  });

  // Demo on, and NOTHING else. No mizan_current_user_id, no onboarded flag.
  await page.addInitScript(([k, s]) => {
    window.localStorage.setItem(k, s);
    window.localStorage.setItem("mizan_demo", "1");
  }, [AUTH_STORAGE_KEY, JSON.stringify(fakeSession())]);

  await page.route("**/auth/v1/**", (r) => r.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify(r.request().url().includes("/token") ? fakeSession() : TEST_USER),
  }));
  await page.route("**/rest/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/api/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.route("**/_vercel/**", (r) => r.fulfill({ status: 204, body: "" }));

  await page.goto("/");
  await page.locator("nav, [data-tour], main").first().waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(2500);

  // The flag must still be set after hydrate has run.
  expect(await page.evaluate(() => localStorage.getItem("mizan_demo")),
    "hydrateUserState wiped mizan_demo on a machine with no stored user id").toBe("1");

  // And the demo persona must actually be on screen, not the empty state.
  const body = await page.locator("body").innerText();
  expect(body, "demo was enabled but the app rendered the connect-a-brokerage empty state")
    .not.toMatch(/Connect your first brokerage/i);
  expect(body, "no demo figure rendered").toMatch(/\$[\d,]{3,}/);

  expect([...new Set(errors)], "errors on a fresh demo load:\n  " + [...new Set(errors)].join("\n  ")).toEqual([]);
});

test("a DIFFERENT stored user still gets the wipe", async ({ page }) => {
  test.setTimeout(120_000);
  // The property the wipe exists for, pinned so narrowing it to "previous AND
  // different" cannot drift into deleting it. Demo's ~$435k persona rendering
  // as a real person's net worth is a defect that has already been reported
  // once (memory: demo-opt-in-default), and the same applies to any other
  // user's cached state showing under this login.
  await page.addInitScript(([k, s]) => {
    window.localStorage.setItem(k, s);
    window.localStorage.setItem("mizan_demo", "1");
    // Somebody else was signed in on this machine.
    window.localStorage.setItem("mizan_current_user_id", "11111111-1111-4111-8111-111111111111");
  }, [AUTH_STORAGE_KEY, JSON.stringify(fakeSession())]);

  await page.route("**/auth/v1/**", (r) => r.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify(r.request().url().includes("/token") ? fakeSession() : TEST_USER),
  }));
  await page.route("**/rest/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/api/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.route("**/_vercel/**", (r) => r.fulfill({ status: 204, body: "" }));

  await page.goto("/");
  await page.locator("nav, [data-tour], main").first().waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(2500);

  expect(await page.evaluate(() => localStorage.getItem("mizan_demo")),
    "another user's tracked state survived this login — the wipe must still fire "
    + "when a DIFFERENT user id is stored").not.toBe("1");
});
