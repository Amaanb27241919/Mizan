// Lists the brokerages your SnapTrade client_id has access to.
// If you see Tartan Bank / First Platypus / Houndstooth, it's sandbox.
// If you see Fidelity / Schwab / Robinhood / Chase / Vanguard, it's prod.

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

const ts = Math.floor(Date.now() / 1000).toString();
const q = new URLSearchParams({ clientId: CLIENT_ID, timestamp: ts });
q.sort();
const queryString = q.toString();
const reqPath = "/api/v1/brokerages";
const sigObject = { content: null, path: reqPath, query: queryString };
const signature = crypto.createHmac("sha256", CONSUMER_KEY).update(JSON.stringify(sigObject)).digest("base64");

const data = await new Promise((res, rej) => {
  const req = https.request({
    hostname: "api.snaptrade.com",
    path: `${reqPath}?${queryString}`,
    method: "GET",
    headers: { "Signature": signature, "Content-Type": "application/json" },
  }, r => { let c=""; r.on("data", d=>c+=d); r.on("end", ()=>res({ status: r.statusCode, body: c })); });
  req.on("error", rej);
  req.end();
});

if (data.status !== 200) {
  console.error("Failed:", data.status, data.body.slice(0,300));
  process.exit(1);
}

const list = JSON.parse(data.body);
console.log(`\nclient_id: ${CLIENT_ID}`);
console.log(`Total brokerages: ${list.length}\n`);

const sandboxMarkers = /tartan|platypus|houndstooth|sandbox|test|monogram|fake/i;
const realMarkers = /fidelity|charles schwab|robinhood|chase|vanguard|td ameritrade|interactive brokers|coinbase|kraken|wealthfront|ally/i;

let sandboxCount = 0;
let realCount = 0;
const sample = [];
for (const b of list) {
  const name = b.name || b.display_name || b.slug || "";
  if (sandboxMarkers.test(name)) sandboxCount++;
  if (realMarkers.test(name)) realCount++;
  if (sample.length < 25) sample.push(`  ${(b.enabled === false ? "(disabled) " : "").padEnd(11)}${name}`);
}

console.log("First 25 brokerages reported:");
sample.forEach(s => console.log(s));

console.log(`\n  Sandbox-name matches : ${sandboxCount}`);
console.log(`  Real-broker matches  : ${realCount}`);

if (sandboxCount > realCount && sandboxCount > 2) {
  console.log("\n⚠️  This looks like a SANDBOX / test client_id.");
  console.log("   Real brokers will not work. Ask SnapTrade support how to promote to production.");
} else if (realCount >= 5) {
  console.log("\n✓ This looks like a PRODUCTION client_id.");
  console.log("  Safe to proceed with the migration.");
} else {
  console.log("\n? Inconclusive. Manually inspect the list above and ask SnapTrade support if unsure.");
}
