/**
 * MĪZAN — Sharia screening provider diff harness.
 *
 * Runs the SAME ratio engine (verdictFromFundamentals) against two different
 * fundamentals providers and reports where they disagree. This is the evidence
 * needed to decide whether the OpenBB swap is safe to promote — a screening
 * provider change is not a refactor, it can silently flip a holding's halal
 * status for every user.
 *
 * The verdict that matters is not "do they agree most of the time". It is:
 *   FLIP  — one provider says halal, the other says haram   → CRITICAL, blocks promotion
 *   GAIN  — Finnhub could not verify debt, OpenBB could     → the reason to switch
 *   LOSS  — Finnhub verified debt, OpenBB could not         → coverage regression
 *
 * Usage:
 *   node scripts/screen-provider-diff.mjs                       # default edge-case basket
 *   node scripts/screen-provider-diff.mjs AAPL MSFT O TSM       # explicit tickers
 *   OPENBB_API_BASE=http://localhost:6900 node scripts/screen-provider-diff.mjs
 *
 * Requires a running OpenBB backend:
 *   pip install "openbb[all]" && openbb-api          # serves on :6900
 *
 * Exits 1 if any FLIP is found, so it can gate a promotion decision in CI.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

// Load .env.local manually (no dotenv dep) — must happen BEFORE importing
// lib/sharia.mjs, whose provider config is read at module scope.
try {
  const envFile = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
  for (const line of envFile.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* .env.local optional — env may come from the shell */ }

if (!process.env.OPENBB_API_BASE) process.env.OPENBB_API_BASE = "http://localhost:6900";

const { _adapters } = await import("../lib/sharia.mjs");

// Default basket = the cases where Finnhub's per-filer concept matching is known to
// be weakest, not a random sample. Each line says why it earns a slot.
const DEFAULT_TICKERS = [
  "AAPL",  // mega-cap tech, clean us-gaap concepts — the easy control
  "MSFT",  // ditto; both providers must agree or the harness itself is wrong
  "NVDA",  // low debt, high cash — cash screen is the binding test
  "TSLA",  // debt has moved a lot; ratio×equity reconstruction is sensitive here
  "T",     // heavily leveraged telecom — must fail the debt screen on both
  "KO",    // moderate leverage, near the 33% line — the sensitive zone
  "O",     // REIT — NotesPayable/SecuredDebt lines bsConcept() is known to miss
  "PLD",   // REIT, different filer conventions again
  "JPM",   // bank — prohibited sector, must be haram on both regardless of ratios
  "TSM",   // foreign filer (ifrs-full_* concepts) — the prefix-agnostic path
  "BABA",  // ADR, IFRS, non-US receivables naming
  "SHOP",  // foreign (Canada), IFRS
  "XOM",   // large industrial, complex balance sheet
  "LLY",   // pharma, large intangibles
  "HLAL",  // halal ETF — NO balance sheet on either; expect review/unknown both sides
];

const tickers = process.argv.slice(2).filter(Boolean).map(s => s.toUpperCase());
const SYMBOLS = tickers.length ? tickers : DEFAULT_TICKERS;
const PAUSE_MS = Number(process.env.DIFF_PAUSE_MS || 1500); // Finnhub free tier: 3 calls/symbol

const pct = v => (Number.isFinite(v) ? `${v.toFixed(1)}%` : "—");
const pad = (s, n) => String(s ?? "").padEnd(n).slice(0, n);

async function run(adapter, tk) {
  try {
    const v = await adapter(tk);
    return { ok: true, v };
  } catch (e) {
    return { ok: false, err: e?.message || String(e) };
  }
}

// Classify the disagreement by how much it actually matters to a user.
function classify(fh, ob) {
  if (!fh.ok || !ob.ok) return "ERROR";
  const a = fh.v.status, b = ob.v.status;
  const opposed = (x, y) => x === "halal" && y === "haram";
  if (opposed(a, b) || opposed(b, a)) return "FLIP";
  if (a !== b) return "SHIFT"; // e.g. review→halal: meaningful but not contradictory
  if (fh.v.debtKnown === false && ob.v.debtKnown === true) return "GAIN";
  if (fh.v.debtKnown === true && ob.v.debtKnown === false) return "LOSS";
  return "MATCH";
}

console.log(`\nSharia provider diff — finnhub vs openbb (${process.env.OPENBB_API_BASE})`);
console.log(`${SYMBOLS.length} symbols, ${PAUSE_MS}ms between symbols\n`);
console.log(pad("SYM", 6) + pad("FINNHUB", 10) + pad("OPENBB", 10) + pad("DEBT/MC fh", 12) + pad("DEBT/MC obb", 12) + pad("DEBTKNOWN", 12) + "VERDICT");
console.log("-".repeat(84));

const rows = [];
for (const [i, tk] of SYMBOLS.entries()) {
  // Different upstream services — safe to hit concurrently.
  const [fh, ob] = await Promise.all([run(_adapters.finnhub, tk), run(_adapters.openbb, tk)]);
  const verdict = classify(fh, ob);
  rows.push({
    tk, verdict,
    finnhub: fh.ok ? { status: fh.v.status, debtR: fh.v.debtR, cashR: fh.v.cashR, recvR: fh.v.recvR, mc: fh.v.marketCap, assets: fh.v.assets, industry: fh.v.industry, debtKnown: fh.v.debtKnown, passCount: fh.v.passCount } : { error: fh.err },
    openbb: ob.ok ? { status: ob.v.status, debtR: ob.v.debtR, cashR: ob.v.cashR, recvR: ob.v.recvR, mc: ob.v.marketCap, assets: ob.v.assets, industry: ob.v.industry, debtKnown: ob.v.debtKnown, passCount: ob.v.passCount } : { error: ob.err },
  });

  const known = `${fh.ok ? (fh.v.debtKnown ? "Y" : "N") : "?"} → ${ob.ok ? (ob.v.debtKnown ? "Y" : "N") : "?"}`;
  console.log(
    pad(tk, 6) +
    pad(fh.ok ? fh.v.status : `ERR`, 10) +
    pad(ob.ok ? ob.v.status : `ERR`, 10) +
    pad(fh.ok ? pct(fh.v.debtR) : fh.err, 12) +
    pad(ob.ok ? pct(ob.v.debtR) : ob.err, 12) +
    pad(known, 12) +
    verdict
  );
  if (i < SYMBOLS.length - 1) await new Promise(r => setTimeout(r, PAUSE_MS));
}

const tally = rows.reduce((acc, r) => ({ ...acc, [r.verdict]: (acc[r.verdict] || 0) + 1 }), {});
console.log("\n" + "-".repeat(84));
console.log("SUMMARY:", Object.entries(tally).map(([k, v]) => `${k}=${v}`).join("  "));
console.log("  MATCH  same status, same debt verifiability");
console.log("  GAIN   OpenBB verified debt where Finnhub could not  ← the case for switching");
console.log("  LOSS   Finnhub verified debt where OpenBB could not  ← coverage regression");
console.log("  SHIFT  status changed but not contradictorily (e.g. review → halal)");
console.log("  FLIP   halal ⇄ haram — CRITICAL, investigate before promoting");
console.log("  ERROR  one provider threw (no data / backend down)");

const out = path.join(ROOT, "screen-provider-diff.json");
fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), base: process.env.OPENBB_API_BASE, provider: process.env.OPENBB_PROVIDER || "yfinance", rows }, null, 2));
console.log(`\nFull per-symbol detail → ${path.relative(ROOT, out)}`);

if (tally.FLIP) {
  console.error(`\n✗ ${tally.FLIP} halal⇄haram flip(s). Do NOT promote OpenBB until each is explained.`);
  process.exit(1);
}
console.log("\n✓ No halal⇄haram flips.");
