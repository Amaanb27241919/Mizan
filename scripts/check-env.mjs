/**
 * MĪZAN — environment variable validator.
 *
 * Imported at the top of api/[...path].mjs and server.js so the function
 * (or local dev server) fails fast at boot with a precise error instead
 * of returning 500s when an upstream API call later finds the key missing.
 *
 * Required vs optional:
 *   - REQUIRED_VARS  — hard fail (exit 1) if any are missing in Vercel
 *   - OPTIONAL_VARS  — logged as warnings; features degrade gracefully
 *
 * Run standalone:    node scripts/check-env.mjs
 * Imported via:      import "./scripts/check-env.mjs"  (auto-runs)
 */

// SnapTrade, Finnhub, Polygon, Anthropic, Plaid all degrade gracefully
// when missing (the route returns a 503-ish error), so we don't hard-fail
// on them — only on the bare minimum needed for the server to boot and
// authenticate users.
const REQUIRED_VARS = [
  // Supabase admin client — without these, every authenticated request
  // returns "auth: not configured" and the server is effectively useless.
  "SUPABASE_URL",                // or VITE_SUPABASE_URL fallback
  "SUPABASE_SERVICE_ROLE_KEY",
];

// Soft-required: server boots without them, but the named feature breaks.
const OPTIONAL_VARS = [
  // SnapTrade — brokerage connect/sync. Without it, /api/snaptrade/* 503s.
  { name: "SNAPTRADE_CLIENT_ID",     also: "VITE_SNAPTRADE_CLIENT_ID",    feature: "Brokerage connections (SnapTrade)" },
  { name: "SNAPTRADE_CONSUMER_KEY",  also: "VITE_SNAPTRADE_CONSUMER_KEY", feature: "Brokerage connections (SnapTrade)" },
  // Market data
  { name: "VITE_FINNHUB_KEY",        feature: "Real-time quotes + news (Finnhub)" },
  { name: "POLYGON_KEY",             also: "VITE_POLYGON_KEY",            feature: "Historical bars / backtester (Polygon)" },
  { name: "ANTHROPIC_KEY",           also: "VITE_ANTHROPIC_KEY",          feature: "AI Advisor (Claude)" },
  // Plaid banking
  { name: "PLAID_CLIENT_ID",         feature: "Bank aggregation (Plaid)" },
  { name: "PLAID_SECRET",            feature: "Bank aggregation (Plaid)" },
  // Admin
  { name: "OWNER_EMAIL",             feature: "Owner-claim of legacy mizan_primary SnapTrade record" },
  // Cron security
  { name: "CRON_SECRET",             feature: "Auth bearer required by /api/cron/sync (otherwise cron is unprotected)" },
  // Alerting
  { name: "RESEND_API_KEY",          feature: "Email alerts (brute-force, cron staleness, SnapTrade spike, new device)" },
  { name: "ALERT_FROM",              feature: "From: header for alert emails (defaults to alerts@mizan.app)" },
];

// Vite-only / client-side. Validated separately for the build step, not
// the server runtime — included here for documentation only.
const CLIENT_VARS = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
  "VITE_OWNER_EMAIL",
];

const has = (k) => {
  const v = process.env[k];
  return typeof v === "string" && v.trim().length > 0;
};

function checkEnv({ silent = false } = {}) {
  const log = silent ? () => {} : (...args) => console.log(...args);
  const missing = [];

  log("[env] verifying required variables…");
  for (const name of REQUIRED_VARS) {
    // SUPABASE_URL also accepts its VITE_ counterpart as a fallback.
    const alt = name === "SUPABASE_URL" ? "VITE_SUPABASE_URL" : null;
    const ok = has(name) || (alt && has(alt));
    if (ok) {
      log(`  ✓ ${name}${alt && !has(name) ? `  (via ${alt})` : ""}`);
    } else {
      log(`  ✗ ${name}${alt ? `  (or ${alt})` : ""}  — MISSING`);
      missing.push(name);
    }
  }

  log("[env] checking optional features…");
  for (const opt of OPTIONAL_VARS) {
    const ok = has(opt.name) || (opt.also && has(opt.also));
    if (ok) {
      log(`  ✓ ${opt.name}${opt.also && !has(opt.name) ? `  (via ${opt.also})` : ""}`);
    } else {
      log(`  ∘ ${opt.name}${opt.also ? `  (or ${opt.also})` : ""}  — ${opt.feature} disabled`);
    }
  }

  if (missing.length > 0) {
    console.error(`\n[env] FATAL: ${missing.length} required variable${missing.length === 1 ? "" : "s"} missing: ${missing.join(", ")}`);
    console.error("[env] Set them in Vercel Dashboard → Settings → Environment Variables, or .env.local for local dev.");
    return { ok: false, missing };
  }

  log("[env] all required variables present.");
  return { ok: true, missing: [] };
}

// Auto-run when imported. In Vercel, each cold-start runs this once.
// Don't crash the function on missing vars in production (returning 500
// is friendlier than 502) — log loudly and continue. Standalone invocation
// (`node scripts/check-env.mjs`) hard-exits so CI can gate on it.
const isCli = import.meta.url === `file://${process.argv[1]}`;
const result = checkEnv({ silent: false });
if (isCli && !result.ok) process.exit(1);

export { checkEnv, REQUIRED_VARS, OPTIONAL_VARS, CLIENT_VARS };
