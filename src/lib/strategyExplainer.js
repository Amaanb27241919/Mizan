/**
 * Pure (no React, no I/O): a strategy explained in plain English, generated
 * from the rules it actually runs on (its params), so the explanation can
 * never drift from the strategy. Owner, 2026-10-08: "I won't always remember
 * and people will ask."
 *
 * Every sentence below was checked against the engine that reads the param:
 *   buy_top / hold_zone / momentum_days → lib/trading/rank.mjs (rank by
 *     trailing return, buy the top N, keep while inside the hold zone)
 *   sizing → inverseVolWeights (calmer names get more money)
 *   ai_gate → aiGateDecision (a buy is skipped on a SELL consensus or a haram
 *     verdict; names not reviewed by the cutoff go through)
 *   protective_stop_pct → armProtectiveStops (a stop below the average price paid)
 *   cash_sweep / earnings_filter_days / whole_shares / min_relative_volume
 * It describes the user's own rules. It never says whether to run them.
 */
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null);
const arr = (v) => (Array.isArray(v) ? v : []);
const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const usd = (n) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (n) => `${Number(n) % 1 ? Number(n).toFixed(1) : Number(n)}%`;

function cadence(days) {
  const d = num(days);
  if (d === null) return null;
  if (d <= 1) return "every trading day";
  if (d === 7) return "once a week";
  if (d >= 28 && d <= 31) return "once a month";
  return `every ${d} days`;
}
function lookback(days) {
  const d = num(days);
  if (d === null) return "recent";
  if (d >= 240 && d <= 260) return "12-month";
  if (d >= 120 && d <= 130) return "6-month";
  if (d >= 60 && d <= 66) return "3-month";
  return `${d}-day`;
}
/** "etf_holdings_cache:SPUS (Alpha Vantage, 219 raw -> 214 valid)" → { fund, count } */
function universeOf(p) {
  const tickers = arr(p.universe_tickers);
  if (tickers.length > 1) return { fund: null, count: tickers.length };
  const src = String(p.universe_source || "");
  const fund = (src.match(/:([A-Z]{2,6})\b/) || [])[1] || null;
  const count = num((src.match(/->\s*(\d+)\s*valid/) || [])[1]);
  return { fund, count };
}

/** Params that are bookkeeping, not rules — ignored when pairing strategies. */
const BOOKKEEPING = new Set(["experiment", "experiment_group", "last_rebalance", "universe_source", "high_water", "notes",
  "last_dca_date", "ai_gate_cutoff_et", "last_screen", "benchmark", "broker", "dca_waiting_for_funds", "universe", "executed_as",
  "detailed_rules", "entry_rules", "exit_rules", "universe_tickers"]);
const RULE_NAME = {
  ai_gate: "the AI gate", protective_stop_pct: "the protective stop", whole_shares: "whole shares only",
  min_relative_volume: "the volume check", cash_sweep: "the SPSK cash sweep", earnings_filter_days: "the earnings filter",
};

function code(s) {
  const p = obj(s?.params) || {};
  const m = String(p.experiment || "").match(/^([A-Z])(?:\s*·\s*([a-z]+))?\s*:/);
  if (m) return m[2] ? `${m[1]}·${m[2]}` : m[1];
  if (p.layer === "shadow") return "Shadow";
  return null;
}
const isPaperish = (s) => obj(s?.params)?.broker === "alpaca_paper" || obj(s?.progress)?.paper === true;

/** The one rule two strategies differ by, or null when it is more than one. */
function soleDifference(a, b) {
  if (!a || !b || a.strategy_type !== b.strategy_type || a.id === b.id) return null;
  // A shadow panel never trades, so it is nobody's control and tests nothing
  // by comparison — "the control for Shadow" was the first render of this.
  if (obj(a.params)?.layer === "shadow" || obj(b.params)?.layer === "shadow") return null;
  const pa = obj(a.params) || {}, pb = obj(b.params) || {};
  const keys = new Set([...Object.keys(pa), ...Object.keys(pb)].filter((k) => !BOOKKEEPING.has(k)));
  const diff = [...keys].filter((k) => JSON.stringify(pa[k] ?? null) !== JSON.stringify(pb[k] ?? null));
  for (const k of ["stop_loss_pct", "profit_target_pct"]) if (num(a[k]) !== num(b[k])) diff.push(k);
  return diff.length === 1 ? diff[0] : null;
}

function rankRules(s, p) {
  const u = universeOf(p);
  const top = num(p.buy_top), hold = num(p.hold_zone);
  const pool = u.count ? `the ${u.count} halal stocks in ${u.fund || "its list"}` : `the halal stocks in ${u.fund || "its list"}`;
  const out = [
    `Ranks ${pool} by their ${lookback(p.momentum_days)} price gain and buys the top ${top ?? "few"}${hold ? `; a holding is kept while it stays in the top ${hold}` : ""}.`,
    `Rebalances ${cadence(p.rebalance_days) || "on a schedule"}. Calmer stocks get a bigger slice and jumpier ones a smaller one (volatility sizing).`,
  ];
  if (p.whole_shares) out.push(`Buys whole shares only${top ? `, each priced at most ${usd((num(s.capital_allocated) || 0) / top)} (its money ÷ ${top} slots)` : ""} — the way a small E*TRADE account has to.`);
  if (num(p.earnings_filter_days)) out.push(`Skips any stock reporting earnings within ${num(p.earnings_filter_days)} days.`);
  if (p.ai_gate) out.push(`Before buying, an AI panel (Claude, Gemini, DeepSeek) reviews each name's news. A name the panel agrees to sell is skipped; one it has not reviewed by ${p.ai_gate_cutoff_et || "the cutoff"} ET goes through.`);
  if (p.cash_sweep) out.push(`Parks idle cash in ${p.cash_sweep} (a sukuk fund) rather than leaving it uninvested.`);
  if (num(p.protective_stop_pct)) out.push(`Keeps a sell-stop ${pct(p.protective_stop_pct)} below what it paid for each holding.`);
  return out;
}

function swingRules(s, p) {
  const n = arr(p.universe_tickers).length;
  const out = [
    `Watches ${n > 1 ? `${n} large halal stocks` : "a list of halal stocks"} and buys the strongest one once it is up ${pct(p.entry_threshold_pct ?? 1)} on the day${num(p.min_relative_volume) ? ` and trading at least ${num(p.min_relative_volume)}× its usual volume` : ""}.`,
    `Holds one position at a time. Sells at +${pct(s.profit_target_pct ?? 0)}, at a ${pct(s.stop_loss_pct ?? 0)} loss${num(p.trail_pct) ? `, or if it falls ${pct(p.trail_pct)} from its high once it is up ${pct(p.trail_activate_pct ?? p.trail_pct)}` : ""}.`,
  ];
  if (p.broker_exits) out.push("The exit orders are placed at the broker the moment it buys, so they work even between checks.");
  return out;
}

function dcaRules(s, p) {
  const basket = arr(typeof p.basket === "string" ? (() => { try { return JSON.parse(p.basket); } catch { return []; } })() : p.basket);
  const mix = basket.map((b) => `${b.ticker} ${Math.round((num(b.weight) || 0) * 100)}%`).join(" · ");
  return [
    `Every ${num(p.dca_cadence_days) || 7} days it buys ${num(p.dca_amount) ? usd(p.dca_amount) : "a set amount"} of whichever fund is furthest below its target${mix ? ` (${mix})` : ""}.`,
    "Whole shares only. It never sells — new money does the rebalancing.",
    "If the account cannot afford a share it waits for a deposit instead of failing.",
  ];
}

/**
 * strat: a /api/bot/strategies row (with progress); all: every strategy, for pairing.
 * → { code, title, oneLine, rules[], tests|null, money }
 */
export function explainStrategy(strat, all) {
  const s = obj(strat) || {};
  const p = obj(s.params) || {};
  const label = String(p.experiment || "").replace(/^[A-Z](?:\s*·\s*[a-z]+)?\s*:\s*/, "").trim();
  const c = code(s);
  const shadow = p.layer === "shadow";
  const paper = isPaperish(s);
  const cap = num(s.capital_allocated) || 0;

  let rules, oneLine;
  if (shadow) {
    rules = ["Never places an order — it cannot, by any path.",
      `Each ${cadence(p.rebalance_days) === "every trading day" ? "trading day" : "round"}, an AI panel reviews the ranked halal stocks and records what each model thought.`,
      "The record is the point: it shows, over months, whether the models' calls would have helped."];
    oneLine = "An AI research panel that only takes notes.";
  } else if (s.strategy_type === "dca") {
    rules = dcaRules(s, p);
    oneLine = "Steady weekly buying into three halal funds, held for the long run.";
  } else if (s.strategy_type === "rank_rebalance") {
    rules = rankRules(s, p);
    // The distinguishing facts, so cards that share an engine read differently.
    const cad = { "once a week": "weekly", "once a month": "monthly", "every trading day": "daily" }[cadence(p.rebalance_days)] || cadence(p.rebalance_days);
    const extras = [p.ai_gate && "an AI check before each buy", num(p.protective_stop_pct) && `a ${pct(p.protective_stop_pct)} stop`,
      p.whole_shares && "whole shares only"].filter(Boolean);
    oneLine = `The ${num(p.buy_top) ?? ""} strongest halal stocks${cad ? `, rebalanced ${cad}` : ""}${extras.length ? `, with ${extras.join(" and ")}` : ""}.`.replace("The  ", "The ");
  } else if (s.strategy_type === "breakout" || s.strategy_type === "momentum") {
    rules = swingRules(s, p);
    oneLine = "Short swing trades in one strong halal stock at a time.";
  } else {
    rules = [String(s.nl_description || "A custom strategy.").split(/(?<=\.)\s/)[0]];
    oneLine = rules[0];
  }
  // Force-selling a failed holding is the rank engine's (screenPlanInputs);
  // the DCA never sells, so it is not promised for every type.
  if (!shadow) rules.push(s.strategy_type === "rank_rebalance"
    ? "Every buy must pass Mizan's AAOIFI Sharia screen, and a holding that later fails is sold at the next rebalance."
    : "Every buy must pass Mizan's AAOIFI Sharia screen.");

  // What it is for: the one rule it differs from a sibling by, when there is one.
  let tests = null;
  for (const o of arr(all)) {
    const k = soleDifference(s, o);
    if (!k) continue;
    const other = code(o) || (obj(o.params)?.layer === "shadow" ? "Shadow" : "the live control");
    const has = (x) => { const v = obj(x.params)?.[k]; return v !== undefined && v !== null && v !== false; };
    const name = RULE_NAME[k] || k.replace(/_/g, " ");
    tests = has(s) && !has(o)
      ? `Tests ${name}: ${other} runs the same rules without it, so the gap between them is what ${name} adds.`
      : !has(s) && has(o)
        ? `The control for ${other}: the same rules without ${name}, so ${other} minus this is what ${name} adds.`
        : `Compared with ${other}, which differs only in ${name}.`;
    break;
  }
  // A control's own rules have nothing distinctive — say what it is a control for.
  if (tests && tests.startsWith("The control for ")) oneLine = `${oneLine.replace(/\.$/, "")} — the control for ${tests.slice(16).split(":")[0]}.`;
  if (!tests && p.experiment_group) tests = `One part of experiment ${p.experiment_group}${label ? ` — ${label}` : ""}.`;

  const money = shadow ? "No money — records only."
    : paper ? `${usd(cap)} of paper money. Fills are simulated; nothing real is at stake.`
    : `${usd(cap)} of real money at your broker.`;
  return { code: c, title: label || oneLine, oneLine, rules, tests, money };
}
