/**
 * Generates the manifest `screenshots` used by Chrome's richer install UI
 * (Android since Chrome 94, desktop since 108). Without at least one screenshot
 * of the matching form factor, Chrome falls back to the plain install prompt.
 *
 * Deliberately a SCRIPT, not a spec: it writes into public/, and a test that
 * mutates tracked files every time the suite runs is a trap. Re-run it by hand
 * when the UI changes enough that the install dialog would misrepresent the app:
 *
 *   npm run build && node scripts/generate-pwa-screenshots.mjs
 *
 * Runs with DEMO MODE ON. The alternative is a signed-in account with no
 * connections, i.e. install screenshots consisting of three empty states. Demo
 * exists for exactly this — Settings describes it as "useful for screenshots,
 * sharing, or previewing MIZAN before connecting brokers" — and its persona is
 * a believable ~$435k household rather than the old 9-figure mockup.
 *
 * Chrome's constraints (both dimensions 320–3840px, longest side ≤ 2.3× the
 * shortest, one aspect ratio per form factor, PNG/JPEG only) are asserted at the
 * bottom, so a bad size fails here rather than silently disabling the rich UI.
 */
import { chromium } from "@playwright/test";
import { signedIn, appReady } from "../e2e/support/app.js";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.PREVIEW_URL || "http://localhost:4173";
const OUT = path.resolve("public/screenshots");

const PHONE = { width: 390, height: 844 };   // iPhone 13/14/15 — ratio 2.164
const DESKTOP = { width: 1440, height: 900 }; // ratio 1.6

/** Click a top-level nav tab. force:true — the floating dock never settles. */
async function tab(page, id) {
  await page.locator(`[data-tour="nav-${id}"]`).click({ force: true });
  await page.waitForTimeout(700);
}

/** Click a sub-tab strip button by its visible label. */
async function subTab(page, label) {
  const b = page.locator(".mz-tabbar > button", { hasText: label });
  if (await b.count()) {
    await b.first().click({ force: true });
    await page.waitForTimeout(700);
  }
}

async function shoot(browser, viewport, name, steps) {
  // serviceWorkers:"block" for the same reason playwright.config.js sets it —
  // SW-issued requests bypass page.route(), so without this the fixtures are
  // inert and the shots render empty/error states. This is precisely how the
  // first run produced install screenshots reading "Nisab unavailable".
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, serviceWorkers: "block" });
  const page = await context.newPage();
  // Demo persona + a returning user, so no onboarding overlay covers the shot.
  await signedIn(page, { theme: "light", storage: { mizan_demo: "1" } });
  await page.goto(BASE);
  await appReady(page);
  await page.waitForTimeout(1200);
  await steps(page);
  // Settle animations (tiles fade up on mount) before capturing.
  await page.waitForTimeout(600);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  await context.close();
  return file;
}

/**
 * Fail fast with the actual command to run. Without this the script just hangs
 * on page.goto and times out, which reads like a Playwright problem rather than
 * "you forgot the server".
 */
async function requirePreviewServer() {
  try {
    const res = await fetch(BASE, { signal: AbortSignal.timeout(3000) });
    if (res.ok) return;
  } catch { /* fall through to the message below */ }
  console.error(
    `No preview server at ${BASE}.\n\n` +
    `  npm run build && npx vite preview --port 4173 --strictPort\n\n` +
    `then re-run this script (or set PREVIEW_URL).`
  );
  process.exit(1);
}

const run = async () => {
  await requirePreviewServer();
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const written = [];

  written.push(await shoot(browser, PHONE, "phone-overview", async () => {}));
  written.push(await shoot(browser, PHONE, "phone-screener", async (p) => {
    await tab(p, "portfolio");
    await subTab(p, /Screener/i);
  }));
  written.push(await shoot(browser, PHONE, "phone-zakat", async (p) => {
    await tab(p, "goals");
    await subTab(p, /Zakat/i);
  }));
  written.push(await shoot(browser, DESKTOP, "desktop-overview", async () => {}));
  written.push(await shoot(browser, DESKTOP, "desktop-portfolio", async (p) => {
    await tab(p, "portfolio");
  }));

  await browser.close();

  // Verify against Chrome's documented limits rather than trusting the config.
  for (const f of written) {
    const { width, height } = pngSize(fs.readFileSync(f));
    const min = Math.min(width, height), max = Math.max(width, height);
    const ok = min >= 320 && max <= 3840 && max <= 2.3 * min;
    console.log(`${ok ? "ok  " : "FAIL"} ${path.basename(f)} ${width}x${height} ratio=${(max / min).toFixed(2)} ${(fs.statSync(f).size / 1024).toFixed(0)}KB`);
    if (!ok) process.exitCode = 1;
  }
};

function pngSize(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

run().catch((e) => { console.error(e); process.exit(1); });
