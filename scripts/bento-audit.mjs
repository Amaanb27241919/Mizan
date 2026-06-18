import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, '../bento-audit-shots');
fs.mkdirSync(OUT, { recursive: true });

// Load .env.local manually
function loadEnvLocal() {
  const envFile = path.join(ROOT, '.env.local');
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const v = m[2].replace(/^['"]|['"]$/g, '');
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const BASE = 'http://localhost:3000';
const rand = () => Math.random().toString(36).slice(2, 10);
const email = `bento-audit+${rand()}@mizan-test.invalid`;
const password = `T3st!${rand()}${rand()}`;

async function shot(page, name, fullPage = true) {
  const file = path.join(OUT, `${name}.png`);
  await page.waitForTimeout(900);
  await page.screenshot({ path: file, fullPage });
  console.log(`SAVED ${name}.png`);
  return file;
}

async function clickTab(page, label) {
  // Evaluate on the page to find the element by text content
  const found = await page.evaluate((lbl) => {
    const els = [...document.querySelectorAll('button, [role="tab"], a')];
    const match = els.find(el => {
      const txt = (el.textContent || '').trim();
      return txt.toLowerCase() === lbl.toLowerCase() || txt.toLowerCase().includes(lbl.toLowerCase());
    });
    if (match) {
      match.click();
      return true;
    }
    return false;
  }, label);
  if (found) {
    await page.waitForTimeout(1200);
    return true;
  }
  console.warn(`Tab not found: ${label}`);
  return false;
}

async function enableDemoMode(page) {
  // Set localStorage to enable demo mode before any React hydration
  await page.addInitScript(() => {
    try { localStorage.setItem('mizan_demo', '1'); } catch {}
  });
}

let userId = null;

(async () => {
  // Create a temporary test user via Supabase admin API
  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  console.log('Creating test user:', email);
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (createErr) {
    console.error('Failed to create test user:', createErr.message);
    process.exit(1);
  }
  userId = created.user.id;
  console.log('Test user created:', userId);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  // Inject demo mode flag before React loads
  await enableDemoMode(page);

  // Load app
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);

  // Sign in
  console.log('Signing in...');
  await page.fill('#mizan-email', email);
  await page.waitForTimeout(200);
  await page.fill('#mizan-password', password);
  await page.waitForTimeout(200);
  await page.locator('button[type="submit"]').click();

  // Wait for the login form to disappear and app content to appear
  await page.waitForFunction(() => {
    const txt = document.body.innerText;
    return !txt.includes('Enter your email') && txt.length > 200;
  }, { timeout: 12000 }).catch(() => console.log('Timed out waiting for app'));

  await page.waitForTimeout(2000);
  console.log('URL after sign-in:', page.url());

  // Ensure demo mode is on (set after sign-in too, before React re-renders)
  await page.evaluate(() => {
    try { localStorage.setItem('mizan_demo', '1'); } catch {}
  });
  await page.waitForTimeout(500);

  await shot(page, '00-post-signin');

  // Overview
  await clickTab(page, 'Overview');
  await page.waitForTimeout(1200);
  await shot(page, '01-overview');
  await page.screenshot({ path: path.join(OUT, '01-overview-viewport.png'), fullPage: false });
  console.log('SAVED 01-overview-viewport.png');

  // Portfolio (default / Holdings)
  await clickTab(page, 'Portfolio');
  await page.waitForTimeout(1000);
  await shot(page, '02-portfolio-default');

  // Holdings sub-tab
  await clickTab(page, 'Holdings');
  await page.waitForTimeout(800);
  await shot(page, '03-portfolio-holdings');

  // Screener sub-tab (correct label is "Screener" per TabBar definition)
  await clickTab(page, 'Screener');
  await page.waitForTimeout(1000);
  await shot(page, '04-portfolio-screener');

  // Goals tab (contains Zakat & Sadaqah sub-tab)
  await clickTab(page, 'Goals');
  await page.waitForTimeout(1200);
  await shot(page, '05-goals-default');

  // Zakat & Sadaqah sub-tab (under Goals)
  await clickTab(page, 'Zakat & Sadaqah');
  await page.waitForTimeout(1000);
  await shot(page, '06-goals-zakat-top');
  // Scroll down to expose PurificationPanel
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, '06b-goals-zakat-scrolled.png'), fullPage: false });
  console.log('SAVED 06b-goals-zakat-scrolled.png');
  await page.evaluate(() => window.scrollTo(0, 0));

  // Finances
  await clickTab(page, 'Finances');
  await page.waitForTimeout(1200);
  await shot(page, '07-finances');

  // Settings
  await clickTab(page, 'Settings');
  await page.waitForTimeout(1200);
  await shot(page, '08-settings');

  await browser.close();
  console.log('Done. Screenshots in:', OUT);

  // Clean up test user
  console.log('Deleting test user...');
  const { error: delErr } = await supabase.auth.admin.deleteUser(userId);
  if (delErr) console.error('Delete failed:', delErr.message);
  else console.log('Test user deleted');
})().catch(async (err) => {
  console.error('Script error:', err.message);
  if (userId) {
    const supabase = createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    await supabase.auth.admin.deleteUser(userId).catch(() => {});
  }
  process.exit(1);
});
