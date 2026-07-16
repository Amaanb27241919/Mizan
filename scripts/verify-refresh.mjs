#!/usr/bin/env node
/**
 * One-shot verification for /api/snaptrade/refresh.
 *
 * Loads .env.local for the owner's mizan_primary secret (SNAPTRADE_PRIMARY_SECRET;
 * the legacy .snaptrade-users.json flat file is a DEPRECATED local fallback —
 * production stores secrets in Supabase user_snaptrade, not on the filesystem),
 * lists active authorizations, and fires POST /authorizations/{id}/refresh
 * against the FIRST connection. Prints every step so we can confirm the
 * signing + endpoint shape match what SnapTrade expects.
 *
 * Cost: burns one (1) per-connection refresh from SnapTrade's hourly
 * quota for the first connection only. Other connections are left alone.
 */

import fs from "node:fs";
import https from "node:https";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

// Load .env.local manually (no dotenv dep).
const envFile = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
for (const line of envFile.split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const CLIENT_ID    = (process.env.VITE_SNAPTRADE_CLIENT_ID    || process.env.SNAPTRADE_CLIENT_ID    || "").trim();
const CONSUMER_KEY = (process.env.VITE_SNAPTRADE_CONSUMER_KEY || process.env.SNAPTRADE_CONSUMER_KEY || "").trim();
const userId = "mizan_primary";

// Preferred source: SNAPTRADE_PRIMARY_SECRET in .env.local. The .snaptrade-users.json
// flat file is DEPRECATED (prod keeps secrets in Supabase user_snaptrade) — read only
// as a local fallback, with a warning, so this script no longer depends on it.
let userSecret = (process.env.SNAPTRADE_PRIMARY_SECRET || "").trim();
if (!userSecret) {
  try {
    const users = JSON.parse(fs.readFileSync(path.join(ROOT, ".snaptrade-users.json"), "utf8"));
    userSecret = (users["mizan_primary"] || "").trim();
    if (userSecret) console.warn("⚠ Read mizan_primary from the DEPRECATED .snaptrade-users.json flat file. Prefer SNAPTRADE_PRIMARY_SECRET in .env.local.\n");
  } catch { /* flat file absent — expected; it's deprecated */ }
}

if (!CLIENT_ID || !CONSUMER_KEY) { console.error("Missing SnapTrade keys in .env.local"); process.exit(1); }
if (!userSecret)                 { console.error("Missing mizan_primary secret — set SNAPTRADE_PRIMARY_SECRET in .env.local"); process.exit(1); }

console.log(`CLIENT_ID:   ${CLIENT_ID.slice(0, 8)}…`);
console.log(`USER:        ${userId}`);
console.log(`USER_SECRET: ${userSecret.slice(0, 6)}…\n`);

function snapReq(method, endpoint, bodyObj, extraQuery = {}) {
  return new Promise((resolve, reject) => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const queryParams = { clientId: CLIENT_ID, timestamp, ...extraQuery };
    const queryString = Object.keys(queryParams).sort()
      .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`).join("&");
    const reqPath = `/api/v1${endpoint}`;
    const sigObject = { content: bodyObj || null, path: reqPath, query: queryString };
    const signature = crypto.createHmac("sha256", CONSUMER_KEY).update(JSON.stringify(sigObject)).digest("base64");
    const bodyStr = bodyObj ? JSON.stringify(bodyObj) : "";
    const headers = { "Content-Type": "application/json", Signature: signature };
    if (bodyStr) headers["Content-Length"] = Buffer.byteLength(bodyStr);
    const req = https.request({
      hostname: "api.snaptrade.com", port: 443,
      path: `${reqPath}?${queryString}`, method, headers,
    }, res => {
      let data = ""; res.on("data", c => (data += c));
      res.on("end", () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                          catch { resolve({ status: res.statusCode, body: data }); } });
    });
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

(async () => {
  console.log("── STEP 1: GET /authorizations ─────────────────");
  const auths = await snapReq("GET", "/authorizations", null, { userId, userSecret });
  console.log(`Status: ${auths.status}`);
  if (auths.status !== 200) {
    console.error("FAIL: could not list authorizations\n", auths.body);
    process.exit(2);
  }
  const list = Array.isArray(auths.body) ? auths.body : [];
  if (list.length === 0) {
    console.log("No connections — owner has no active broker authorizations.");
    process.exit(0);
  }
  console.log(`Found ${list.length} connection(s):`);
  list.forEach(a => console.log(`  - ${a.id}  ${a.brokerage?.name || a.brokerage?.display_name || "?"}  disabled=${a.disabled || false}`));

  console.log("\n── STEP 2: POST /authorizations/{first}/refresh ─");
  const first = list[0];
  console.log(`Target: ${first.id} (${first.brokerage?.name || "?"})`);
  const refresh = await snapReq("POST", `/authorizations/${first.id}/refresh`, null, { userId, userSecret });
  console.log(`Status: ${refresh.status}`);
  console.log(`Body:   ${typeof refresh.body === "object" ? JSON.stringify(refresh.body, null, 2) : refresh.body}`);

  if (refresh.status >= 200 && refresh.status < 300) {
    console.log("\n✓ SnapTrade accepted the refresh. Endpoint shape is correct.");
  } else if (refresh.status === 429) {
    console.log("\n⚠ SnapTrade is rate-limiting this connection right now (429). Endpoint exists; retry in ~1 hour.");
  } else {
    console.log(`\n✗ Unexpected status ${refresh.status}. See body above.`);
    process.exit(3);
  }
})().catch(err => { console.error("FATAL:", err); process.exit(99); });
