// Quick read-only audit of SnapTrade-side state:
//   - Total registered SnapTrade users (one per MIZAN end user)
//   - Total active brokerage connections across all users
//   - Per-user breakdown (which broker, status, last_sync)
// Tells you exactly where you stand vs. the 5-connection free-tier cap.

import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

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

const CLIENT_ID = (process.env.VITE_SNAPTRADE_CLIENT_ID || process.env.SNAPTRADE_CLIENT_ID || "").trim();
const CONSUMER_KEY = (process.env.VITE_SNAPTRADE_CONSUMER_KEY || process.env.SNAPTRADE_CONSUMER_KEY || "").trim();
if (!CLIENT_ID || !CONSUMER_KEY) {
  console.error("Missing SNAPTRADE_CLIENT_ID or SNAPTRADE_CONSUMER_KEY in .env.local");
  process.exit(1);
}

function sign(reqPath, queryString, bodyObj) {
  const sigObject = { content: bodyObj || null, path: reqPath, query: queryString };
  return crypto.createHmac("sha256", CONSUMER_KEY).update(JSON.stringify(sigObject)).digest("base64");
}

function snapReq(method, endpoint, body = null, params = {}) {
  return new Promise((resolve, reject) => {
    const ts = Math.floor(Date.now() / 1000).toString();
    const q = new URLSearchParams({ clientId: CLIENT_ID, timestamp: ts, ...params });
    q.sort();
    const queryString = q.toString();
    const reqPath = `/api/v1${endpoint}`;
    const fullPath = `${reqPath}?${queryString}`;
    const signature = sign(reqPath, queryString, body);
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: "api.snaptrade.com",
      path: fullPath,
      method,
      headers: {
        "Signature": signature,
        "Content-Type": "application/json",
        ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
      },
    };
    const req = https.request(opts, res => {
      let chunks = "";
      res.on("data", d => chunks += d);
      res.on("end", () => {
        let parsed = chunks;
        try { parsed = JSON.parse(chunks); } catch {}
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

// 1. List users
console.log("→ fetching SnapTrade users…");
const usersRes = await snapReq("GET", "/snapTrade/listUsers");
if (usersRes.status !== 200) {
  console.error("× listUsers failed:", usersRes.status, usersRes.body);
  process.exit(1);
}
const userIds = Array.isArray(usersRes.body) ? usersRes.body : [];
console.log(`  ${userIds.length} registered SnapTrade users\n`);

// 2. For each user, fetch their authorizations
// listUsers returns just userIds without userSecrets. To list a user's
// authorizations we'd need their secret. Best alternative: read from
// Supabase user_snaptrade where we store both.
import { createClient } from "@supabase/supabase-js";
const sb = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);
const { data: rows, error } = await sb.from("user_snaptrade")
  .select("user_id, snaptrade_user_id, snaptrade_user_secret");
if (error) {
  console.error("× user_snaptrade select failed:", error.message);
  process.exit(1);
}
// Also include the legacy file-backed user (mizan_primary) for the owner.
const legacyFile = path.join(ROOT, ".snaptrade-users.json");
let legacy = null;
if (fs.existsSync(legacyFile)) {
  try {
    const data = JSON.parse(fs.readFileSync(legacyFile, "utf8"));
    if (data.mizan_primary) legacy = { snaptrade_user_id: "mizan_primary", snaptrade_user_secret: data.mizan_primary };
  } catch {}
}
const allUsers = [...(rows || []), ...(legacy ? [legacy] : [])];

console.log("→ counting active brokerage connections per user…\n");
let totalConnections = 0;
let active = 0;
for (const u of allUsers) {
  const r = await snapReq("GET", "/authorizations", null, {
    userId: u.snaptrade_user_id,
    userSecret: u.snaptrade_user_secret,
  });
  if (r.status !== 200) {
    console.log(`  ${u.snaptrade_user_id}: ✗ authorizations ${r.status}`);
    continue;
  }
  const auths = Array.isArray(r.body) ? r.body : [];
  totalConnections += auths.length;
  const activeForUser = auths.filter(a => !a.disabled && a.type !== "trial");
  active += activeForUser.length;
  if (auths.length > 0) {
    console.log(`  ${u.snaptrade_user_id}:`);
    for (const a of auths) {
      const broker = a.brokerage?.name || a.brokerage?.display_name || "Unknown";
      const status = a.disabled ? "disabled" : "active";
      console.log(`    · ${broker.padEnd(28)} ${status.padEnd(10)}  id=${a.id.slice(0,8)}…`);
    }
  } else {
    console.log(`  ${u.snaptrade_user_id}: (no active connections)`);
  }
}

console.log("\n" + "═".repeat(56));
console.log(`  Total SnapTrade users          : ${userIds.length}`);
console.log(`  Users we have credentials for  : ${allUsers.length}`);
console.log(`  Total brokerage connections    : ${totalConnections}`);
console.log(`  Active connections (non-trial) : ${active}`);
console.log("═".repeat(56));
console.log("\nFree-tier cap is typically 5 active connections. If you're at");
console.log("or near 5, onboarding more users will fail with SNAPTRADE_LIMIT_REACHED.");
