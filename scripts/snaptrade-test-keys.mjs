// Verifies a SnapTrade client_id + consumer_key pair works.
//
// Usage:
//   SNAPTRADE_NEW_CLIENT_ID="xxx" SNAPTRADE_NEW_CONSUMER_KEY="yyy" \
//     node scripts/snaptrade-test-keys.mjs
//
// Calls a low-impact endpoint (listBrokerages) which requires valid auth
// but doesn't read user data. A 200 response means the keys are good.
// Any 401/403 means the signature or client_id is wrong.

import https from "node:https";
import crypto from "node:crypto";

const CLIENT_ID = (process.env.SNAPTRADE_NEW_CLIENT_ID || "").trim();
const CONSUMER_KEY = (process.env.SNAPTRADE_NEW_CONSUMER_KEY || "").trim();
if (!CLIENT_ID || !CONSUMER_KEY) {
  console.error("× Set SNAPTRADE_NEW_CLIENT_ID and SNAPTRADE_NEW_CONSUMER_KEY env vars first.");
  console.error("  Example:");
  console.error('    SNAPTRADE_NEW_CLIENT_ID="abc123" SNAPTRADE_NEW_CONSUMER_KEY="xyz789" node scripts/snaptrade-test-keys.mjs');
  process.exit(2);
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

console.log("→ testing new SnapTrade keys");
console.log(`  client_id    : ${CLIENT_ID}`);
console.log(`  consumer_key : ${CONSUMER_KEY.slice(0, 4)}…${CONSUMER_KEY.slice(-4)}  (${CONSUMER_KEY.length} chars)\n`);

// 1) listBrokerages — no userSecret required, just clientId + signature
const broker = await snapReq("GET", "/brokerages");
if (broker.status === 200) {
  const count = Array.isArray(broker.body) ? broker.body.length : 0;
  console.log(`  ✓ listBrokerages: ${broker.status}  (${count} brokerages returned)`);
} else {
  console.error(`  ✗ listBrokerages: ${broker.status}`);
  console.error("    body:", JSON.stringify(broker.body, null, 2).slice(0, 500));
  console.error("\n  The new keys do NOT work. Common causes:");
  console.error("    - Wrong client_id (case-sensitive, no spaces)");
  console.error("    - Wrong consumer_key (regenerated in dashboard after copy?)");
  console.error("    - Keys are from a different SnapTrade environment");
  process.exit(1);
}

// 2) listUsers — also clientId-only, confirms account-level access
const users = await snapReq("GET", "/snapTrade/listUsers");
if (users.status === 200) {
  const list = Array.isArray(users.body) ? users.body : [];
  console.log(`  ✓ listUsers     : ${users.status}  (${list.length} users currently registered)`);
} else {
  console.warn(`  ! listUsers     : ${users.status}  (non-fatal, but worth checking)`);
}

console.log("\n✓ Keys are valid. Safe to proceed with migration.");
console.log("  Next steps:");
console.log("    1) Update Vercel env vars (see RUNBOOK_SNAPTRADE_MIGRATION.md §3)");
console.log("    2) Run scripts/snaptrade-wipe-credentials.mjs");
console.log("    3) Redeploy + reconnect brokers");
