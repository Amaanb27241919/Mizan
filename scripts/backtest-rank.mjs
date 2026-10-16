/**
 * Walk-forward backtest of Mizar's rule, using the PRODUCTION functions from
 * lib/trading/rank.mjs — a backtest of a reimplementation tests the
 * reimplementation, not the strategy.
 *
 * Mizar (97b5b48e): rank 214 SPUS names by 252-day momentum, buy top 25, hold
 * while inside top 35, inverse-vol weighted, rebalance every 7 days.
 *
 * It sweeps a parameter grid rather than testing one setting, for two reasons:
 * robustness (a rule that only works at one setting is a fitted curve), and
 * because assessStrategy needs the Sharpe of EVERY variant tried to deflate
 * the best one. The sweep is the multiple-testing correction's own input.
 *
 * NO LOOKAHEAD: at each rebalance the ranker sees only bars dated on or
 * before that day.
 *
 * KNOWN BIAS, stated up front: the universe is TODAY's SPUS membership, so
 * names dropped from the index over the window are absent. Survivorship bias
 * flatters the strategy and does NOT flatter the benchmark, so the excess
 * return here is an UPPER BOUND, not an estimate.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { rankUniverse, rebalancePlan, inverseVolWeights } from '../lib/trading/rank.mjs';
import { assessStrategy } from '../src/lib/deflatedSharpe.js';

const DIR = process.env.BT_DIR || new URL('../.backtest', import.meta.url).pathname;
const H = { 'APCA-API-KEY-ID': process.env.ALPACA_KEY_ID, 'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET };
const UNIVERSE = JSON.parse(readFileSync(`${DIR}/universe.json`, 'utf8'));
const BENCH = 'SPUS';
const START = process.argv[2] || '2021-10-01';
const CACHE = `${DIR}/bars-${START}.json`;

async function fetchBars(symbols) {
  if (existsSync(CACHE)) { process.stderr.write('using cached bars\n'); return JSON.parse(readFileSync(CACHE, 'utf8')); }
  const out = {};
  for (let i = 0; i < symbols.length; i += 40) {
    const batch = symbols.slice(i, i + 40);
    let token = null;
    do {
      const u = new URL('https://data.alpaca.markets/v2/stocks/bars');
      u.searchParams.set('symbols', batch.join(','));
      u.searchParams.set('timeframe', '1Day');
      u.searchParams.set('start', START);
      u.searchParams.set('adjustment', 'all');  // RAW would read a split as -90% momentum
      u.searchParams.set('limit', '10000');
      u.searchParams.set('feed', 'iex');
      if (token) u.searchParams.set('page_token', token);
      const r = await fetch(u, { headers: H });
      if (!r.ok) { console.error('bars failed', r.status, (await r.text()).slice(0, 160)); process.exit(1); }
      const d = await r.json();
      for (const [sym, bars] of Object.entries(d.bars || {})) (out[sym] ||= []).push(...bars.map((b) => ({ t: b.t.slice(0, 10), c: b.c })));
      token = d.next_page_token || null;
    } while (token);
    process.stderr.write(`\rfetched ${Math.min(i + 40, symbols.length)}/${symbols.length}`);
  }
  process.stderr.write('\n');
  for (const s of Object.keys(out)) out[s].sort((a, b) => a.t.localeCompare(b.t));
  writeFileSync(CACHE, JSON.stringify(out));
  return out;
}

const all = await fetchBars([...UNIVERSE, BENCH]);
const bench = all[BENCH];
if (!bench?.length) { console.error('no benchmark bars'); process.exit(1); }

const dates = bench.map((b) => b.t);
const idxOf = new Map(dates.map((d, i) => [d, i]));
// Per symbol: a close lookup and a bar-index lookup, so a window is O(1) to locate.
const S = {};
for (const [sym, bars] of Object.entries(all)) {
  S[sym] = { bars, close: new Map(bars.map((b) => [b.t, b.c])), at: new Map(bars.map((b, i) => [b.t, i])) };
}
/** The last `n` bars dated on or before `d` — momentum/volatility need no more. */
function window(sym, d, n) {
  const s = S[sym]; if (!s) return null;
  let i = s.at.get(d);
  if (i === undefined) { // not a trading day for this name; walk back
    for (let k = idxOf.get(d) - 1; k >= 0; k--) { const j = s.at.get(dates[k]); if (j !== undefined) { i = j; break; } }
  }
  if (i === undefined) return null;
  return s.bars.slice(Math.max(0, i - n + 1), i + 1);
}

const COST_BPS = Number(process.env.COST_BPS ?? 10);   // round-trip spread+impact, per unit turnover
function backtest({ buyTop, holdZone, momentumDays, rebalanceDays }) {
  const START_EQUITY = 100_000;
  let cash = START_EQUITY, holdings = new Map(), held = [];
  const equity = [];
  let lastIdx = -Infinity, rebalances = 0, trades = 0;
  const firstIdx = momentumDays + 5;
  if (firstIdx >= dates.length) return null;

  for (let i = firstIdx; i < dates.length; i++) {
    const d = dates[i], prev = dates[i - 1];
    for (const [sym, dollars] of holdings) {
      const c0 = S[sym]?.close.get(prev), c1 = S[sym]?.close.get(d);
      if (c0 > 0 && c1 > 0) holdings.set(sym, dollars * (c1 / c0));
    }
    if (i - lastIdx >= rebalanceDays) {
      const sliced = {};
      for (const sym of UNIVERSE) {
        // Rank on data up to YESTERDAY, execute at today's close. Ranking and
        // trading on the same close is a lookahead: that price is not
        // knowable until the bar is finished.
        const w = window(sym, prev, momentumDays);
        if (w && w.length >= 30) sliced[sym] = w;
      }
      const ranked = rankUniverse(sliced, { lookbackDays: momentumDays });
      const plan = rebalancePlan({ ranked, held, buyTop, holdZone });
      const weights = inverseVolWeights(ranked, plan.target);
      const eq0 = [...holdings.values()].reduce((s, v) => s + v, 0) + cash;
      trades += plan.buy.length + plan.sell.length;
      // Turnover cost: commission-free does not mean free. Spread and impact
      // are charged on the notional actually traded.
      const nextW = new Map();
      for (const [sym, w] of Object.entries(weights || {})) if (w > 0 && S[sym]?.close.get(d) > 0) nextW.set(sym, w);
      let turnover = 0;
      const syms = new Set([...holdings.keys(), ...nextW.keys()]);
      for (const sym of syms) turnover += Math.abs((nextW.get(sym) || 0) - (holdings.get(sym) || 0) / (eq0 || 1));
      const eq = eq0 * (1 - COST_BPS / 10000 * turnover);
      holdings = new Map(); let deployed = 0;
      for (const [sym, w] of nextW) { holdings.set(sym, eq * w); deployed += eq * w; }
      cash = eq - deployed; held = [...holdings.keys()];
      lastIdx = i; rebalances++;
    }
    equity.push([...holdings.values()].reduce((s, v) => s + v, 0) + cash);
  }
  const rets = [];
  for (let i = 1; i < equity.length; i++) if (equity[i - 1] > 0) rets.push(equity[i] / equity[i - 1] - 1);
  return { equity, rets, rebalances, trades, firstIdx };
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const sharpeA = (a) => (sd(a) > 0 ? (mean(a) / sd(a)) * Math.sqrt(252) : null);
const maxDD = (s) => { let p = -Infinity, w = 0; for (const v of s) { p = Math.max(p, v); w = Math.min(w, v / p - 1); } return w; };

// The grid. Mizar's live setting is buyTop 25 / momentum 252 / rebalance 7.
const GRID = [];
for (const buyTop of [10, 15, 25]) for (const momentumDays of [63, 126, 252]) for (const rebalanceDays of [7, 21])
  GRID.push({ buyTop, holdZone: Math.round(buyTop * 1.4), momentumDays, rebalanceDays });

const results = [];
for (const g of GRID) {
  const r = backtest(g);
  if (!r || r.rets.length < 30) continue;
  const total = r.equity.at(-1) / 100_000 - 1;
  const bFirst = S[BENCH].close.get(dates[r.firstIdx]), bLast = S[BENCH].close.get(dates.at(-1));
  results.push({ ...g, days: r.equity.length, total_pct: +(100 * total).toFixed(2),
    bench_pct: +(100 * (bLast / bFirst - 1)).toFixed(2), excess_pct: +(100 * (total - (bLast / bFirst - 1))).toFixed(2),
    sharpe: +sharpeA(r.rets).toFixed(3), maxdd_pct: +(100 * maxDD(r.equity)).toFixed(1),
    rebalances: r.rebalances, trades: r.trades, _rets: r.rets });
  process.stderr.write(`\r${results.length}/${GRID.length} variants`);
}
process.stderr.write('\n');

results.sort((a, b) => b.sharpe - a.sharpe);
const bRets = [];
for (let i = 1; i < bench.length; i++) if (bench[i - 1].c > 0) bRets.push(bench[i].c / bench[i - 1].c - 1);

console.log(`\nWindow ${dates[results[0] ? 0 : 0]} … ${dates.at(-1)}  ·  ${dates.length} trading days  ·  universe ${Object.keys(all).length - 1}/${UNIVERSE.length} with bars`);
console.log(`Benchmark ${BENCH}: Sharpe ${sharpeA(bRets).toFixed(3)}\n`);
console.log(`cost assumption: ${COST_BPS} bps per unit turnover\n`);
console.log('buyTop  mom  reb |  total%  bench%  excess% | sharpe  maxDD%  trades');
for (const r of results) {
  const live = (r.buyTop === 25 && r.momentumDays === 252 && r.rebalanceDays === 7) ? '  <- LIVE (Mizar)' : '';
  console.log(
    String(r.buyTop).padStart(6), String(r.momentumDays).padStart(4), String(r.rebalanceDays).padStart(4), '|',
    String(r.total_pct).padStart(7), String(r.bench_pct).padStart(7), String(r.excess_pct).padStart(8), '|',
    String(r.sharpe).padStart(6), String(r.maxdd_pct).padStart(7), String(r.trades).padStart(6), live);
}

const trialSharpes = results.map((r) => r.sharpe / Math.sqrt(252)); // back to per-period
const best = results[0];
console.log(`\nDeflated Sharpe for the BEST variant (buyTop ${best.buyTop}, mom ${best.momentumDays}, reb ${best.rebalanceDays}), against all ${results.length} trials:`);
console.log(JSON.stringify(assessStrategy({ returns: best._rets, trialSharpes }), null, 1));

const liveRow = results.find((r) => r.buyTop === 25 && r.momentumDays === 252 && r.rebalanceDays === 7);
if (liveRow) {
  console.log(`\nDeflated Sharpe for the LIVE setting (Mizar):`);
  console.log(JSON.stringify(assessStrategy({ returns: liveRow._rets, trialSharpes }), null, 1));
}
