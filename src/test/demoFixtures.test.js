// Guards the demo fixtures in MizanApp.jsx against the failure fixed on
// 2026-08-14: DEMO_ACTIVITIES was generated with Math.random() at module load,
// so every page refresh produced a different history and the demo Overview's
// figures moved on their own (all-time contributions $275k–$280k, activity
// count 393–408, money-weighted return swinging a full percentage point).
//
// The fixture lives inside the 11k-line monolith and is deliberately NOT
// extracted (CLAUDE.md §8: do not split MizanApp.jsx). So this test slices the
// demo block straight out of the source and evaluates it in a fresh node:vm
// context — each evaluation is one simulated "page load", which is the only
// way to observe the module-load nondeterminism this test exists to catch.
// The block is plain JS (no JSX), which is what makes this work. Evaluating a
// slice of first-party source read from disk at test time is the point; it is
// not user input. If the markers ever move, the test fails loudly rather than
// silently passing on an empty slice.
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const SRC = path.resolve(__dirname, "../components/MizanApp.jsx");
let block;

beforeAll(() => {
  const lines = fs.readFileSync(SRC, "utf8").split("\n");
  const start = lines.findIndex((l) => l.startsWith("const _pos ="));
  const end = lines.findIndex((l) => l.startsWith("const DEMO_SHARIA"));
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(
      `Could not locate the demo fixture block in MizanApp.jsx (start=${start}, end=${end}). ` +
      `The 'const _pos =' / 'const DEMO_SHARIA' markers moved — update this test.`,
    );
  }
  block = lines.slice(start, end).join("\n");
});

// Each call re-evaluates the block in a brand-new context — one page load.
const loadDemoFixtures = () =>
  vm.runInNewContext(`${block}\n({ DEMO_ACCOUNTS, DEMO_ACTIVITIES })`);

const symOf = (s) => (typeof s === "string" ? s : s?.symbol || "");
const sumType = (acts, type) =>
  acts.filter((a) => (a.type || "").toUpperCase() === type).reduce((s, a) => s + (+a.amount || 0), 0);

describe("demo fixtures — MizanApp.jsx", () => {
  it("finds the demo block (marker sanity)", async () => {
    const { DEMO_ACCOUNTS, DEMO_ACTIVITIES } = loadDemoFixtures();
    expect(DEMO_ACCOUNTS.length).toBeGreaterThan(0);
    expect(DEMO_ACTIVITIES.length).toBeGreaterThan(0);
  });

  // THE regression test. Two loads must be identical.
  it("generates an identical activity history on every load", async () => {
    const a = loadDemoFixtures().DEMO_ACTIVITIES;
    const b = loadDemoFixtures().DEMO_ACTIVITIES;
    expect(b.length).toBe(a.length);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("keeps every Overview activity figure stable across loads", async () => {
    const runs = [];
    for (let i = 0; i < 3; i++) {
      const acts = loadDemoFixtures().DEMO_ACTIVITIES;
      runs.push(JSON.stringify({
        contrib: sumType(acts, "DEPOSIT"),
        dividends: sumType(acts, "DIVIDEND"),
        fees: sumType(acts, "FEE"),
        withdrawals: sumType(acts, "WITHDRAWAL"),
        count: acts.length,
      }));
    }
    expect(new Set(runs).size).toBe(1);
  });

  it("holds the balance invariant: balance === cash + Σ(position market value)", async () => {
    const { DEMO_ACCOUNTS } = loadDemoFixtures();
    for (const a of DEMO_ACCOUNTS) {
      const posMV = (a.positions || []).reduce((s, p) => s + p.price * p.units, 0);
      expect(a.balance).toBeCloseTo((a.cash || 0) + posMV, 2);
    }
  });

  // The BUY lots must imply the same cost basis the holding itself reports, or
  // anything reconstructing basis from activities contradicts the holdings
  // table. Drift was 3%–53% before the 2026-08-14 fix.
  it("reconciles BUY lot prices to each position's average_purchase_price", async () => {
    const { DEMO_ACCOUNTS, DEMO_ACTIVITIES } = loadDemoFixtures();
    const buys = {};
    for (const a of DEMO_ACTIVITIES) {
      if ((a.type || "").toUpperCase() !== "BUY") continue;
      const k = symOf(a.symbol);
      if (!k) continue;
      buys[k] = buys[k] || { units: 0, cost: 0 };
      buys[k].units += a.units;
      buys[k].cost += Math.abs(a.amount);
    }
    let checked = 0;
    for (const acct of DEMO_ACCOUNTS) {
      for (const p of acct.positions) {
        const b = buys[p.symbol.symbol];
        if (!b) continue;
        expect(b.cost / b.units).toBeCloseTo(p.average_purchase_price, 6);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(15);
  });

  // Contributions above current value make a book of pure winners report a
  // LOSS on the Overview — which is what the demo did before the fix
  // ($277k contributed against $264k held → −1.8% money-weighted return).
  it("keeps total contributions below the portfolio's current value", async () => {
    const { DEMO_ACCOUNTS, DEMO_ACTIVITIES } = loadDemoFixtures();
    const value = DEMO_ACCOUNTS.reduce((s, a) => s + a.balance, 0);
    const contributed = sumType(DEMO_ACTIVITIES, "DEPOSIT");
    expect(contributed).toBeGreaterThan(0);
    expect(contributed).toBeLessThan(value);
  });

  // The persona is meant to read as a healthy long-term holder, so every
  // position's AVERAGE cost sits below its current price. Individual lots may
  // sit above it (the add-on lot on AMAGX/HLAL/SCHD does) — that is realistic
  // and intentional; it is the blended basis that must show a gain.
  it("keeps every position's average cost below its current price", async () => {
    const { DEMO_ACCOUNTS } = loadDemoFixtures();
    let mv = 0, cost = 0;
    for (const acct of DEMO_ACCOUNTS) {
      for (const p of acct.positions) {
        expect(p.average_purchase_price).toBeLessThan(p.price);
        mv += p.units * p.price;
        cost += p.units * p.average_purchase_price;
      }
    }
    expect(mv - cost).toBeGreaterThan(0); // aggregate unrealized gain is positive
  });

  it("emits no NaN/undefined amounts into any activity", async () => {
    const { DEMO_ACTIVITIES } = loadDemoFixtures();
    for (const a of DEMO_ACTIVITIES) {
      expect(Number.isFinite(a.amount)).toBe(true);
      expect(a.trade_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
