// Capture the deployed Settings tab at iPhone viewport for triage.
// Creates a confirmed test user, signs in, navigates to each Settings
// sub-tab, screenshots, then deletes the user.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import puppeteer from "puppeteer-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

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
const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const rand = () => Math.random().toString(36).slice(2, 10);
const email = `iphone-triage+${rand()}@mizan-test.invalid`;
const password = `T3st!${rand()}${rand()}`;

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = path.join(ROOT, "legal", "mfa-screenshots", "_settings_iphone");
fs.mkdirSync(OUT, { recursive: true });

console.log("→ creating test user", email);
const { data: created, error: createErr } = await supabase.auth.admin.createUser({
  email, password, email_confirm: true,
});
if (createErr) { console.error(createErr); process.exit(1); }
const userId = created.user.id;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function clickByText(page, sel, text) {
  const handle = await page.evaluateHandle((s, t) => {
    return Array.from(document.querySelectorAll(s))
      .find(el => (el.textContent || "").trim().toLowerCase().includes(t.toLowerCase())) || null;
  }, sel, text);
  const el = handle.asElement();
  if (!el) throw new Error(`not found: ${sel} "${text}"`);
  await el.click();
  await handle.dispose();
}

let browser;
try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    defaultViewport: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    args: ["--disable-features=site-per-process"],
  });
  const page = await browser.newPage();
  // iPhone 12 user agent so the page treats us as mobile if it uses UA sniffing
  await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1");

  console.log("→ loading", APP_URL);
  await page.goto(APP_URL, { waitUntil: "networkidle2", timeout: 30000 });

  // Sign in
  await page.waitForSelector("#mizan-email", { timeout: 15000 });
  await page.type("#mizan-email", email);
  await page.type("#mizan-password", password);
  await Promise.all([
    page.click('button[type="submit"]'),
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => null),
  ]);
  await sleep(2000);

  // Navigate to Settings
  console.log("→ navigating to Settings");
  await clickByText(page, "button, a", "Settings");
  await sleep(1500);

  // Capture each sub-tab
  const subs = ["Connect Accounts", "Account", "Security", "Notifications", "Manual Assets", "Documents", "Privacy & Data"];
  for (let i = 0; i < subs.length; i++) {
    const sub = subs[i];
    console.log(`  → ${sub}`);
    try {
      await clickByText(page, "button", sub);
      await sleep(800);
      const file = path.join(OUT, `${String(i+1).padStart(2,"0")}_${sub.replace(/[^a-z0-9]/gi,"_")}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log(`    saved ${path.basename(file)}`);
    } catch (e) {
      console.warn(`    ! ${sub}: ${e.message}`);
    }
  }

  // Also a fold-screen (top of page) for each
  console.log("→ done capturing");
} catch (err) {
  console.error("× failed:", err.message);
} finally {
  try { if (browser) await browser.close(); } catch {}
  console.log("→ deleting test user", userId);
  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) console.error("× delete failed:", error.message);
  else console.log("  deleted");
}
