/**
 * The demo must survive convention wifi — which means it must not need wifi.
 *
 * ISNA 63 runs on a phone in a hall with thousands of people on the same
 * access points. The gate for the whole demo is that every figure on screen
 * comes from fixtures compiled into the bundle, so nothing can hang, retry,
 * or fall back to an empty state while someone from Saturna is watching.
 *
 * "Issued and then failed" is not good enough. A failed request is a spinner,
 * a retry, or a blank panel. This spec therefore asserts the app makes NO
 * network call at all on a demo screen, rather than asserting it recovers
 * from one.
 *
 * Two things are deliberately not counted as network:
 *  - Same-origin static assets. In production the service worker serves the
 *    shell from cache; here they come from `vite preview`. Either way they are
 *    the bundle, not the network.
 *  - Supabase /auth/v1. supabase-js resolves an unexpired stored session out
 *    of localStorage synchronously, with no request, which is what happens on
 *    the phone. It is stubbed here only so the app boots signed in.
 *  - Google Fonts. Fraunces and IBM Plex load from fonts.googleapis.com and are
 *    served from the browser/service-worker cache on any load after the first,
 *    which is the state the demo phone will be in. A genuinely cold offline
 *    load falls back to system metrics: the type looks wrong, every figure
 *    still renders. Removing even that risk means self-hosting the two
 *    families, which is a bundle and CSP decision, not a demo fix.
 */
import { test, expect } from "@playwright/test";
import { signedIn, appReady } from "./support/app.js";

const DEMO = { storage: { mizan_demo: "1" } };

// The four beats of the demo narrative live on these three tabs.
const BEATS = ["overview", "portfolio", "goals"];

const isAuthBootstrap = (url) => /\/auth\/v1\//.test(url);
const isWebFont = (url) => /fonts\.(googleapis|gstatic)\.com/.test(url);

/** → a short label if this URL is "the network", else null. */
function offender(url, baseURL) {
  if (/^(data|blob|about):/.test(url)) return null;
  if (isAuthBootstrap(url) || isWebFont(url)) return null;
  let u, b;
  try { u = new URL(url); b = new URL(baseURL); } catch { return null; }
  if (u.host !== b.host) return `${u.protocol}//${u.host}${u.pathname}`;
  if (u.pathname.startsWith("/api/")) return u.pathname;
  return null; // same-origin bundle asset
}

/**
 * Boot the demo with the network genuinely unavailable.
 * Returns the set of requests the app tried to make anyway.
 */
async function bootDemoOffline(page, baseURL) {
  const attempted = new Set();
  page.on("request", (r) => {
    const o = offender(r.url(), baseURL);
    if (o) attempted.add(o);
  });

  await signedIn(page, DEMO);

  // Take over from the fixture layer. Under `signedIn` every /api/** call is
  // answered from a stub, which would hide exactly the defect this spec exists
  // to find. Routes added later win, so this handler sees everything first and
  // hands only the auth bootstrap and the fonts back down via fallback().
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (isAuthBootstrap(url) || isWebFont(url)) return route.fallback();
    return offender(url, baseURL)
      ? route.abort("internetdisconnected")
      : route.continue();
  });

  await page.goto("/");
  await appReady(page);
  return attempted;
}

const openZakat = async (page) => {
  await page.locator('[data-tour="nav-goals"]').click({ force: true });
  await page.waitForTimeout(400);
  await page.locator(".mz-tabbar > button", { hasText: /^Zakat$/ })
    .first().click({ force: true });
  await page.waitForTimeout(600);
};

test.describe("demo mode runs with no network", () => {
  test("no demo screen issues a network request", async ({ page, baseURL }) => {
    const attempted = await bootDemoOffline(page, baseURL);

    for (const tab of BEATS) {
      const btn = page.locator(`[data-tour="nav-${tab}"]`);
      if (await btn.count()) {
        await btn.click({ force: true });
        await page.waitForTimeout(400);
      }
    }
    await openZakat(page);
    // Late effects, polls and retries land after the screens settle.
    await page.waitForTimeout(2000);

    expect(
      [...attempted].sort(),
      "Demo mode reached for the network. Each of these must be short-circuited " +
      "to fixture data BEFORE the call is issued — not caught after it fails:",
    ).toEqual([]);
  });

  // Zero requests is worthless on its own — a blank screen also makes none.
  test("the closing Zakat beat computes offline instead of withholding", async ({ page, baseURL }) => {
    await bootDemoOffline(page, baseURL);
    await openZakat(page);
    await page.waitForTimeout(1500);

    const body = await page.locator("body").innerText();
    // The failure this guards: offline, /api/metals/spot rejects, the hook
    // marks itself unavailable and every nisab-gated surface withholds the
    // number — so the demo's last beat renders "unavailable" on stage.
    expect(body).not.toMatch(/nisab can't be computed|prices unavailable/i);
    expect(body).not.toMatch(/Fetching live gold/i);
    // The beat must actually compute: a figure and a verdict, not a dash.
    expect(body).toMatch(/\$[\d,]+\.\d\d/);
    expect(body).toMatch(/Above Nisab|Below Nisab/i);
    // And the frozen threshold must say so where the reader can see it —
    // the hero previously claimed "live nisab" while serving a constant.
    expect(body).toMatch(/frozen sample nisab/i);
    expect(body).toMatch(/·\s*sample/i);
  });

  test("no demo screen is still loading after two seconds", async ({ page, baseURL }) => {
    await bootDemoOffline(page, baseURL);
    for (const tab of BEATS) {
      const btn = page.locator(`[data-tour="nav-${tab}"]`);
      if (await btn.count()) { await btn.click({ force: true }); await page.waitForTimeout(400); }
    }
    await page.waitForTimeout(2000);
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/Loading|Fetching|Could not load|Network error/i);
  });
});
