/**
 * MĪZAN E2E support — a signed-in app with no credentials and no network.
 *
 * The app gates everything behind a Supabase session, which is why nothing
 * could render the authenticated UI before now: the headless browser has no
 * way past auth, and the session lives in localStorage rather than a cookie so
 * it can't be imported from a real browser either.
 *
 * Rather than provision a test account (real credentials in CI, real rows in
 * production auth, real rate limits), we do what the app itself does: seed the
 * session into localStorage and answer every network call from fixtures.
 *
 * @supabase/supabase-js stores its session under `sb-<projectRef>-auth-token`.
 * getSession() reads that synchronously and does NOT hit the network while the
 * token is unexpired, so a far-future expiry is all it takes to boot signed in.
 */

const PROJECT_REF = "kcghivcvczxaguezurii";
export const AUTH_STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;

export const TEST_USER = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "e2e@mizan.test",
  role: "authenticated",
  aud: "authenticated",
  app_metadata: { provider: "email" },
  user_metadata: { first_name: "Test", last_name: "User" },
  created_at: "2026-01-01T00:00:00.000Z",
};

/** A session shaped like the SDK's, valid far enough out that no refresh fires. */
export function fakeSession() {
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
  return {
    access_token: "e2e-access-token",
    refresh_token: "e2e-refresh-token",
    token_type: "bearer",
    expires_in: 60 * 60 * 24 * 365,
    expires_at: expiresAt,
    user: TEST_USER,
  };
}

// Default API fixtures. Deliberately minimal and EMPTY-ish: a signed-in user
// with no connected accounts is the state most surfaces have to handle
// gracefully, and it's the one most likely to be broken (empty states are
// exactly what CLAUDE.md §7 says must never be a blank div).
const DEFAULT_FIXTURES = {
  "/api/user/features": { trading_bot: false, full_auto: false, is_root: false,
    trading_bot_consented: false, needs_name: false, first_name: "Test", last_name: "User" },
  "/api/snaptrade/all": { accounts: [], activities: [] },
  "/api/snaptrade/accounts": { accounts: [] },
  "/api/snaptrade/activities": { activities: [] },
  "/api/plaid/accounts": { accounts: [] },
  "/api/plaid/transactions": { transactions: [] },
  "/api/user/state": { state: {} },
  "/api/metals/spot": { ok: true, source: "e2e", nisab_gold_usd: 11632.41, nisab_silver_usd: 1149.08 },
  "/api/market/symbols": { symbols: [] },
};

/**
 * Boot the app signed in, with every network call intercepted.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{fixtures?: Record<string, unknown>, theme?: 'light'|'dark', storage?: Record<string,string>}} [opts]
 */
export async function signedIn(page, opts = {}) {
  const { fixtures = {}, theme = "light", storage = {} } = opts;
  const session = fakeSession();

  await page.addInitScript(
    ([key, sessionJson, themeMode, extraStorage, userId]) => {
      window.localStorage.setItem(key, sessionJson);
      // hydrateUserState() wipes EVERY tracked key whenever the stored
      // mizan_current_user_id doesn't match the signed-in user — correct
      // behaviour (it stops one user's data rendering under another's login),
      // but on a fresh browser profile it means seeding localStorage alone is
      // useless: the flags below get cleared before the app reads them. That
      // is exactly how the first run of these tests kept hitting the
      // onboarding overlay. Seeding the marker makes this a RETURNING user.
      window.localStorage.setItem("mizan_current_user_id", userId);
      window.localStorage.setItem("mizan_theme_mode", themeMode);
      // Demo mode OFF: the demo persona would mask real empty states, and
      // CLAUDE.md is explicit that demo must never be the default.
      window.localStorage.setItem("mizan_demo", "0");
      // Onboarding and the guided-tour offer are correct behaviour for a new
      // signed-in user, and their overlays intercept every click — which is
      // exactly how the first run of these tests failed. Mark them seen so
      // feature tests reach the feature. Onboarding itself gets its own test
      // (onboarding.spec.js) that deliberately does NOT set these.
      window.localStorage.setItem("mizan_onboarded", "1");
      window.localStorage.setItem("mizan_tour_seen", "1");
      window.localStorage.setItem("mizan_tour_active", "0");
      for (const [k, v] of Object.entries(extraStorage)) window.localStorage.setItem(k, v);
    },
    [AUTH_STORAGE_KEY, JSON.stringify(session), theme, storage, TEST_USER.id],
  );

  // Supabase auth endpoints — covers getUser(), and any token refresh that
  // fires despite the long expiry.
  await page.route("**/auth/v1/**", (route) => {
    const url = route.request().url();
    if (url.includes("/token")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) });
    }
    if (url.includes("/logout")) {
      return route.fulfill({ status: 204, body: "" });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(TEST_USER) });
  });

  // Any other Supabase REST/realtime traffic → empty, never the real project.
  await page.route(`**/${PROJECT_REF}.supabase.co/rest/**`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));

  const merged = { ...DEFAULT_FIXTURES, ...fixtures };
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    // Longest-prefix match so a specific override beats a general one.
    const key = Object.keys(merged)
      .filter((k) => path === k || path.startsWith(k))
      .sort((a, b) => b.length - a.length)[0];
    const body = key ? merged[key] : {};
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  // Third-party embeds that would otherwise reach the network in a test.
  await page.route("**/_vercel/**", (route) => route.fulfill({ status: 204, body: "" }));
}

/** Wait for the app shell to be interactive rather than racing a spinner. */
export async function appReady(page) {
  await page.waitForLoadState("networkidle");
  // The nav is the last thing to mount and only exists once auth resolved, so
  // it's the honest "the authenticated app is up" signal.
  await page.locator("nav, [data-tour], main").first().waitFor({ state: "visible", timeout: 15_000 });
}
