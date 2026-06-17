/**
 * MĪZAN — one-time migration: encrypt plaintext secrets in Supabase.
 *
 * Reads every row that still has a plaintext secret, encrypts it with
 * AES-256-GCM (via lib/crypto.mjs), and writes the ciphertext columns.
 * Plaintext columns are left intact so you can verify decryption before
 * 017_drop_plaintext_secrets.sql is applied.
 *
 * Usage:
 *   node scripts/encrypt-existing-secrets.mjs
 *
 * Requires:
 *   - .env.local (or environment) with:
 *       ENCRYPTION_KEY=<64-hex-char key from: openssl rand -hex 32>
 *       SUPABASE_URL=https://...
 *       SUPABASE_SERVICE_ROLE_KEY=ey...
 *
 *   - Migration 016_encrypt_secrets.sql already applied to the database.
 *
 * Safety:
 *   - Idempotent: skips rows where secret_ciphertext is already set.
 *   - Does NOT delete plaintext columns (run 017 separately after verifying).
 *   - Dry-run mode: pass --dry-run to log without writing.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── Load .env.local ───────────────────────────────────────────────────────────
const envPath = resolve(process.cwd(), ".env.local");
try {
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !process.env[key]) process.env[key] = val;
  }
  console.log("✓ Loaded .env.local");
} catch {
  console.log("ℹ .env.local not found — using process environment");
}

// ── Round-trip self-test ──────────────────────────────────────────────────────
const { encrypt, decrypt, selfTest } = await import("../lib/crypto.mjs");

console.log("Running crypto self-test…");
selfTest();
console.log("✓ Crypto self-test passed\n");

// ── Supabase client ───────────────────────────────────────────────────────────
const { createClient } = await import("@supabase/supabase-js");

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
const SERVICE_KEY  = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("✗ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DRY_RUN = process.argv.includes("--dry-run");
if (DRY_RUN) console.log("⚠  DRY-RUN mode — no writes will be made\n");

let migrated = 0;
let skipped  = 0;
let errors   = 0;

// ── 1. user_snaptrade.snaptrade_user_secret ───────────────────────────────────
console.log("=== user_snaptrade ===");
const { data: snapRows, error: snapErr } = await sb
  .from("user_snaptrade")
  .select("user_id, snaptrade_user_secret, secret_ciphertext");

if (snapErr) {
  console.error("✗ Failed to read user_snaptrade:", snapErr.message);
  process.exit(1);
}

for (const row of snapRows || []) {
  if (row.secret_ciphertext) {
    console.log(`  SKIP  user_id=${row.user_id.slice(0, 8)}… (already encrypted)`);
    skipped++;
    continue;
  }
  if (!row.snaptrade_user_secret) {
    console.log(`  SKIP  user_id=${row.user_id.slice(0, 8)}… (no plaintext secret)`);
    skipped++;
    continue;
  }
  try {
    const enc = encrypt(row.snaptrade_user_secret);
    // Verify round-trip before writing
    const check = decrypt(enc);
    if (check !== row.snaptrade_user_secret) {
      throw new Error("round-trip verification failed");
    }
    if (!DRY_RUN) {
      const { error: upErr } = await sb
        .from("user_snaptrade")
        .update({
          secret_ciphertext: enc.ciphertext,
          secret_iv:         enc.iv,
          secret_auth_tag:   enc.authTag,
        })
        .eq("user_id", row.user_id);
      if (upErr) throw new Error(upErr.message);
    }
    console.log(`  OK    user_id=${row.user_id.slice(0, 8)}… → encrypted`);
    migrated++;
  } catch (e) {
    console.error(`  ERROR user_id=${row.user_id.slice(0, 8)}…:`, e.message);
    errors++;
  }
}

// ── 2. user_keys.finnhub_key and polygon_key ─────────────────────────────────
console.log("\n=== user_keys ===");
const { data: keyRows, error: keyErr } = await sb
  .from("user_keys")
  .select("user_id, finnhub_key, polygon_key, finnhub_key_ciphertext, polygon_key_ciphertext");

if (keyErr) {
  console.error("✗ Failed to read user_keys:", keyErr.message);
  process.exit(1);
}

for (const row of keyRows || []) {
  const updates = {};

  for (const field of ["finnhub_key", "polygon_key"]) {
    const ctField = `${field}_ciphertext`;
    if (row[ctField]) {
      console.log(`  SKIP  user_id=${row.user_id.slice(0, 8)}… ${field} (already encrypted)`);
      skipped++;
      continue;
    }
    if (!row[field]) {
      skipped++;
      continue;
    }
    try {
      const enc   = encrypt(row[field]);
      const check = decrypt(enc);
      if (check !== row[field]) throw new Error("round-trip verification failed");
      updates[`${field}_ciphertext`] = enc.ciphertext;
      updates[`${field}_iv`]         = enc.iv;
      updates[`${field}_auth_tag`]   = enc.authTag;
      console.log(`  OK    user_id=${row.user_id.slice(0, 8)}… ${field} → encrypted`);
      migrated++;
    } catch (e) {
      console.error(`  ERROR user_id=${row.user_id.slice(0, 8)}… ${field}:`, e.message);
      errors++;
    }
  }

  if (Object.keys(updates).length > 0) {
    updates.encrypted = true;
    if (!DRY_RUN) {
      const { error: upErr } = await sb
        .from("user_keys")
        .update(updates)
        .eq("user_id", row.user_id);
      if (upErr) {
        console.error(`  ERROR user_id=${row.user_id.slice(0, 8)}… write failed:`, upErr.message);
        errors++;
      }
    }
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`
══════════════════════════════════
  Migrated : ${migrated}
  Skipped  : ${skipped}
  Errors   : ${errors}
  Dry-run  : ${DRY_RUN}
══════════════════════════════════`);

if (errors > 0) {
  console.error("\n✗ Some rows failed. Fix errors before running 017_drop_plaintext_secrets.sql.");
  process.exit(1);
}

if (migrated === 0 && !DRY_RUN) {
  console.log("\n✓ Nothing to migrate — all rows already encrypted or empty.");
} else if (!DRY_RUN) {
  console.log(`\n✓ Done. Verify decryption works end-to-end, then apply:`);
  console.log("    supabase/migrations/017_drop_plaintext_secrets.sql");
}
