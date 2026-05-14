// Captures screenshots of MĪZAN's MFA implementation for Plaid review.
//
// Flow:
//   1. Create a confirmed test user via Supabase admin API
//   2. Drive a headed Chrome session through:
//        - the Plaid-gate state (Finances → Connect Bank blocked by MFA)
//        - the Settings → Security panel showing the Enable 2FA button
//        - the QR-code enrollment screen
//   3. Save each screenshot to legal/mfa-screenshots/
//   4. Delete the test user
//
// Reads SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL from .env.local.
// Uses the system Google Chrome via puppeteer-core.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import puppeteer from "puppeteer-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ---------- env ----------
function loadEnvLocal() {
  const env = path.join(ROOT, ".env.local");
  if (!fs.existsSync(env)) return;
  for (const line of fs.readFileSync(env, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const v = m[2].replace(/^['"]|['"]$/g, "");
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const APP_URL = process.env.MIZAN_URL || "https://mizan-puce.vercel.app";
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = path.join(ROOT, "legal", "mfa-screenshots");
fs.mkdirSync(OUT, { recursive: true });

// ---------- supabase admin ----------
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const rand = () => Math.random().toString(36).slice(2, 10);
const email = `plaid-mfa-evidence+${rand()}@mizan-test.invalid`;
const password = `T3st!${rand()}${rand()}`;

console.log("→ creating test user", email);
const { data: created, error: createErr } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
if (createErr) { console.error("createUser failed:", createErr); process.exit(1); }
const userId = created.user.id;
console.log("  created", userId);

// ---------- helpers ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function findByText(page, selector, text) {
  return page.evaluateHandle((sel, t) => {
    const els = Array.from(document.querySelectorAll(sel));
    return els.find(el => (el.textContent || "").trim().toLowerCase().includes(t.toLowerCase())) || null;
  }, selector, text);
}

async function clickByText(page, selector, text) {
  const handle = await findByText(page, selector, text);
  const el = handle.asElement();
  if (!el) throw new Error(`could not find ${selector} with text "${text}"`);
  await el.click();
  await handle.dispose();
}

async function waitForText(page, text, timeout = 15000) {
  await page.waitForFunction(
    t => document.body && document.body.innerText.toLowerCase().includes(t.toLowerCase()),
    { timeout },
    text,
  );
}

async function shot(page, file) {
  const dest = path.join(OUT, file);
  await page.screenshot({ path: dest, fullPage: false });
  console.log("  saved", dest);
}

// ---------- drive the browser ----------
let browser;
try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    defaultViewport: { width: 1280, height: 900, deviceScaleFactor: 2 },
    args: ["--disable-features=site-per-process"],
  });
  const page = await browser.newPage();

  console.log("→ loading", APP_URL);
  await page.goto(APP_URL, { waitUntil: "networkidle2", timeout: 30000 });

  // login
  await page.waitForSelector("#mizan-email", { timeout: 15000 });
  await page.type("#mizan-email", email);
  await page.type("#mizan-password", password);
  await Promise.all([
    page.click('button[type="submit"]'),
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => null),
  ]);

  // App should now be on Overview. Wait for the dock to appear.
  await waitForText(page, "Finances", 20000);
  await sleep(800);

  // ---- screenshot 4: Plaid gate ----
  console.log("→ capturing Plaid gate");
  await shot(page, "_dbg_a_after_login.png");
  await clickByText(page, "button, a", "Finances");
  await sleep(2000);
  await shot(page, "_dbg_b_finances.png");
  await clickByText(page, "button", "Connect Bank");
  await sleep(3000);
  await shot(page, "_dbg_c_after_connect.png");
  // Wait for our 403 → status banner with the MFA message
  try {
    await waitForText(page, "Multi-factor authentication is required", 15000);
    await sleep(400);
    await shot(page, "04_plaid_gate.png");
  } catch (e) {
    console.warn("  ! MFA gate text not found; using debug shot");
    await shot(page, "04_plaid_gate_fallback.png");
  }

  // ---- screenshot 1: settings → security enable 2FA button ----
  console.log("→ capturing Settings → Security");
  await clickByText(page, "button, a", "Settings");
  await sleep(800);
  await clickByText(page, "button, a", "Security");
  await waitForText(page, "Enable 2FA", 15000);
  await sleep(400);
  await shot(page, "01_settings_enable_2fa.png");

  // ---- screenshot 2: QR code ----
  console.log("→ capturing QR code enrollment");
  await clickByText(page, "button", "Enable 2FA");
  await page.waitForSelector('img[alt="2FA QR code"]', { timeout: 15000 });
  await sleep(800); // give the QR a moment to render
  await shot(page, "02_qr_code.png");

  console.log("✓ all screenshots saved to legal/mfa-screenshots/");
} catch (err) {
  console.error("× capture failed:", err.message);
  // still try to clean up
} finally {
  try { if (browser) await browser.close(); } catch {}
  console.log("→ deleting test user", userId);
  const { error: delErr } = await supabase.auth.admin.deleteUser(userId);
  if (delErr) console.error("× delete failed:", delErr.message);
  else console.log("  deleted");
}
