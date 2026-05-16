// QA capture: walks every main tab + sub-tab in demo mode and saves a
// full-page screenshot of each so we can eyeball $NaN, undefined, broken
// layouts, or stale demo-cache bleed.
//
// Flow:
//   1. Create a confirmed test user (admin API).
//   2. Drive headed Chrome at the deployed app.
//   3. Demo mode auto-enables for new users (per prior observation).
//      If not, we toggle it via Settings.
//   4. Walk each main tab in the dock. For tabs that have a TabBar of
//      sub-tabs, click through each.
//   5. Save full-page PNGs to legal/qa-screenshots/.
//   6. Delete the test user.

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
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = path.join(ROOT, "legal", "qa-screenshots");
fs.mkdirSync(OUT, { recursive: true });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const rand = () => Math.random().toString(36).slice(2, 10);
const email = `qa-tabs+${rand()}@mizan-test.invalid`;
const password = `T3st!${rand()}${rand()}`;

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

async function shot(page, name) {
  const dest = path.join(OUT, name + ".png");
  await page.screenshot({ path: dest, fullPage: true });
  console.log("  saved", path.basename(dest));
}

async function probeForErrors(page) {
  // Read the visible body text and flag any $NaN, undefined, etc.
  return page.evaluate(() => {
    const txt = document.body.innerText || "";
    const flags = [];
    if (/\$NaN/.test(txt)) flags.push("$NaN");
    if (/\bundefined\b/.test(txt)) flags.push("undefined");
    if (/\bNaN%\b/.test(txt)) flags.push("NaN%");
    if (/Infinity/.test(txt)) flags.push("Infinity");
    if (/RangeError|TypeError/.test(txt)) flags.push("JS error");
    return flags;
  });
}

let browser;
const findings = []; // { tab, subtab, flags, error }

try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
    args: ["--disable-features=site-per-process"],
  });
  const page = await browser.newPage();

  console.log("→ loading", APP_URL);
  await page.goto(APP_URL, { waitUntil: "networkidle2", timeout: 30000 });

  // sign in
  await page.waitForSelector("#mizan-email", { timeout: 15000 });
  await page.type("#mizan-email", email);
  await page.type("#mizan-password", password);
  await Promise.all([
    page.click('button[type="submit"]'),
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => null),
  ]);
  await sleep(2500);

  const MAIN_TABS = [
    { id: "overview",  subs: [] },
    { id: "finances",  subs: [] },
    { id: "portfolio", subs: ["Holdings","Watchlist","Activity","Rebalance","Tax Planning","Zakat & Sadaqah","ETFs & Funds","Sharia Screener"] },
    { id: "trade",     subs: ["Order Ticket","Backtest","Retirement / FIRE","Sharia Principles"] },
    { id: "advisor",   subs: [] },
    { id: "settings",  subs: ["Connect Accounts","Account","Security","Notifications","Manual Assets","Documents","Privacy & Data"] },
    { id: "about",     subs: [] },
  ];

  // dock labels visible in the bottom dock — case-insensitive substring
  const DOCK_LABEL = { overview:"Overview", finances:"Finances", portfolio:"Portfolio", trade:"Trade & Bot", advisor:"AI Advisor", settings:"Settings", about:"About" };

  for (const tab of MAIN_TABS) {
    console.log(`→ tab: ${tab.id}`);
    try {
      await clickByText(page, "button", DOCK_LABEL[tab.id]);
      await sleep(1400);
      const flags = await probeForErrors(page);
      findings.push({ tab: tab.id, subtab: null, flags });
      await shot(page, `${String(MAIN_TABS.indexOf(tab)+1).padStart(2,"0")}_${tab.id}`);
    } catch (e) {
      console.warn(`    ! ${tab.id}: ${e.message}`);
      findings.push({ tab: tab.id, subtab: null, flags: [], error: e.message });
      continue;
    }

    for (let i = 0; i < tab.subs.length; i++) {
      const sub = tab.subs[i];
      try {
        await clickByText(page, "button", sub);
        await sleep(900);
        const flags = await probeForErrors(page);
        findings.push({ tab: tab.id, subtab: sub, flags });
        const slug = sub.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
        await shot(page, `${String(MAIN_TABS.indexOf(tab)+1).padStart(2,"0")}_${tab.id}_${String(i+1).padStart(2,"0")}_${slug}`);
      } catch (e) {
        console.warn(`    ! ${tab.id}/${sub}: ${e.message}`);
        findings.push({ tab: tab.id, subtab: sub, flags: [], error: e.message });
      }
    }
  }

  console.log("\n→ findings summary");
  for (const f of findings) {
    const label = f.subtab ? `${f.tab} / ${f.subtab}` : f.tab;
    if (f.error) console.log(`  ✗ ${label}: ${f.error}`);
    else if (f.flags.length > 0) console.log(`  ⚠ ${label}: ${f.flags.join(", ")}`);
    else console.log(`  ✓ ${label}`);
  }

  fs.writeFileSync(
    path.join(OUT, "_findings.json"),
    JSON.stringify(findings, null, 2),
  );
  console.log(`\n→ ${findings.length} tabs/sub-tabs captured to ${path.relative(ROOT, OUT)}/`);

} catch (err) {
  console.error("× capture failed:", err.message);
} finally {
  try { if (browser) await browser.close(); } catch {}
  console.log("→ deleting test user", userId);
  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) console.error("× delete failed:", error.message);
  else console.log("  deleted");
}
