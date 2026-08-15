import { defineConfig, devices } from "@playwright/test";

/**
 * MĪZAN — E2E + visual verification.
 *
 * WHY THIS EXISTS: @playwright/test had been a dependency for months with no
 * config and no tests, and @testing-library/react has zero render tests. The
 * result was 397 unit tests covering pure functions beautifully and NOTHING
 * that ever rendered a component — so five user-facing surfaces shipped to
 * production in a single week without a human or a machine seeing them, and a
 * 320px clipping bug was caught by reading CSS rather than by looking.
 *
 * HERMETIC BY DESIGN. These tests never touch the real Supabase, SnapTrade,
 * Plaid, Finnhub or Polygon. The session is stubbed into localStorage and every
 * network call is intercepted with fixtures (see e2e/support/app.js). That
 * means: no test account, no credentials in CI, no rate-limit burn on free
 * tiers, no chance of a test writing to production data, and identical results
 * offline. The tradeoff is that these prove the UI renders and behaves — they
 * do not prove the live integrations work, which is what the admin health
 * checks and cron heartbeats are for.
 *
 * Runs against the PRODUCTION BUILD (vite preview over dist/) rather than the
 * dev server, so what's tested is what ships — including the pre-paint theme
 * script in index.html, which only exists in the built HTML.
 */
const PORT = 4173;

export default defineConfig({
  testDir: "./e2e",
  // Visual diffs are the point; a flaky-retry that hides a real regression is
  // worse than a red build. Retries only in CI, for genuine infra flake.
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? "line" : [["list"]],
  timeout: 30_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      // Anti-aliasing and font rasterization differ slightly per machine.
      // Small enough to still catch a moved element or a wrong color.
      maxDiffPixelRatio: 0.02,
      animations: "disabled",
    },
  },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Deterministic rendering across machines.
    timezoneId: "America/Chicago",
    locale: "en-US",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    // 320px is the tight one — `html{overflow-x:clip}` means anything wider
    // than the content budget is silently CLIPPED rather than scrollable, so
    // overflow bugs are invisible unless something actually looks at this size.
    //
    // hasTouch matters as much as the viewport: it is what makes Chromium
    // report `pointer: coarse`, and the touch-target rules are keyed on that
    // rather than on width (every phone in LANDSCAPE is 568–932px wide, so a
    // width-keyed rule misses it). Without hasTouch those rules were dead in
    // the test browser and passed by never being evaluated.
    { name: "mobile-320", use: { ...devices["Desktop Chrome"], viewport: { width: 320, height: 720 }, hasTouch: true } },
    // A landscape phone is 320–430px TALL. This is the axis nothing tested:
    // it is wide enough to escape every max-width breakpoint while having
    // less vertical room than any portrait phone.
    { name: "phone-landscape", use: { ...devices["Desktop Chrome"], viewport: { width: 667, height: 375 }, hasTouch: true } },
  ],
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
