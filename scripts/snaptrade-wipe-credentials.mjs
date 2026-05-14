// Wipes stale SnapTrade credentials from Supabase + local disk so users
// re-register on the new SnapTrade account on their next call.
//
// Run this AFTER you have:
//   1) Created the new SnapTrade Commercial account
//   2) Tested the new keys with scripts/snaptrade-test-keys.mjs
//   3) Updated Vercel env vars to the new client_id + consumer_key
//      (BUT BEFORE you redeploy)
//
// Why this order: once Vercel redeploys with the new keys, any cached
// (snaptrade_user_id, snaptrade_user_secret) pair in user_snaptrade is
// invalid — those secrets only work against the OLD client_id. Calls
// to /api/snaptrade/login would fail with a 404 from SnapTrade. Wiping
// the rows forces handlers.mjs into the registerUser path, which
// creates fresh users on the new account.
//
// Usage:
//   node scripts/snaptrade-wipe-credentials.mjs            (dry run, lists targets)
//   CONFIRM=YES node scripts/snaptrade-wipe-credentials.mjs (actually wipes)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

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

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("× Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const DRY_RUN = process.env.CONFIRM !== "YES";
const SAVE_BACKUP = process.env.NO_BACKUP !== "YES";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

console.log(DRY_RUN ? "→ DRY RUN  (re-run with CONFIRM=YES to actually wipe)\n" : "→ WIPE MODE\n");

// 1) Enumerate Supabase rows
const { data: rows, error } = await supabase.from("user_snaptrade")
  .select("user_id, snaptrade_user_id, snaptrade_user_secret");
if (error) {
  console.error("× user_snaptrade select failed:", error.message);
  process.exit(1);
}
console.log(`  user_snaptrade rows: ${rows?.length || 0}`);
for (const r of rows || []) {
  const masked = r.snaptrade_user_secret
    ? `${r.snaptrade_user_secret.slice(0, 4)}…${r.snaptrade_user_secret.slice(-4)}`
    : "(empty)";
  console.log(`    · ${r.snaptrade_user_id.padEnd(48)}  secret=${masked}`);
}

// 2) Check legacy file
const legacyFile = path.join(ROOT, ".snaptrade-users.json");
const legacyExists = fs.existsSync(legacyFile);
console.log(`\n  .snaptrade-users.json: ${legacyExists ? "EXISTS" : "(not present)"}`);
if (legacyExists) {
  try {
    const data = JSON.parse(fs.readFileSync(legacyFile, "utf8"));
    for (const key of Object.keys(data)) console.log(`    · ${key}`);
  } catch { /* unreadable, but we'll still delete it */ }
}

if (DRY_RUN) {
  console.log("\n  This is a dry run. To actually wipe these, re-run with:");
  console.log("    CONFIRM=YES node scripts/snaptrade-wipe-credentials.mjs");
  process.exit(0);
}

// 3) Optional backup (default ON — pass NO_BACKUP=YES to skip)
if (SAVE_BACKUP) {
  const backupDir = path.join(ROOT, "scripts", "_snaptrade-backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `wipe-${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    supabase_rows: rows || [],
    legacy_file: legacyExists ? JSON.parse(fs.readFileSync(legacyFile, "utf8")) : null,
  }, null, 2));
  console.log(`\n  ✓ backup saved: ${path.relative(ROOT, backupPath)}`);
}

// 4) Wipe Supabase rows
if ((rows || []).length > 0) {
  // We delete by user_id to use the primary index. neq with a UUID that
  // can't exist matches every row safely without delete-all-without-filter.
  const { error: delErr } = await supabase.from("user_snaptrade")
    .delete()
    .neq("user_id", "00000000-0000-0000-0000-000000000000");
  if (delErr) {
    console.error("× user_snaptrade delete failed:", delErr.message);
    process.exit(1);
  }
  console.log(`\n  ✓ wiped ${rows.length} rows from user_snaptrade`);
} else {
  console.log("\n  (nothing to delete in user_snaptrade)");
}

// 5) Delete legacy file
if (legacyExists) {
  fs.unlinkSync(legacyFile);
  console.log("  ✓ deleted .snaptrade-users.json");
}

console.log("\n✓ Wipe complete.");
console.log("  Next: redeploy Vercel so the new SnapTrade env vars take effect.");
console.log("  After redeploy, you (and any prior users) reconnect brokers via the app.");
