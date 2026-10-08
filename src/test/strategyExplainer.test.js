import { describe, it, expect } from "vitest";
import { explainStrategy } from "../lib/strategyExplainer.js";

const SRC = "etf_holdings_cache:SPUS (Alpha Vantage, 219 raw -> 214 valid)";
const rank = (id, params, cap = 250000) => ({ id, strategy_type: "rank_rebalance", capital_allocated: String(cap), stop_loss_pct: "15", profit_target_pct: null,
  params: { broker: "alpaca_paper", buy_top: 15, hold_zone: 25, momentum_days: 252, rebalance_days: 30, cash_sweep: "SPSK", earnings_filter_days: 3, universe_source: SRC, ...params } });
const A = rank("a", { experiment: "A: reference system + AI gate", ai_gate: true, ai_gate_cutoff_et: "12:00", last_rebalance: "2026-10-07" });
const B = rank("b", { experiment: "B: reference system, no AI", last_rebalance: "2026-10-06" });
const LIVE = rank("l", { buy_top: 25, hold_zone: 35, rebalance_days: 7, cash_sweep: undefined, earnings_filter_days: undefined }, 95000);
const C = rank("c", { experiment: "C: live strategy + 15% stop", buy_top: 25, hold_zone: 35, rebalance_days: 7, cash_sweep: undefined, earnings_filter_days: undefined, protective_stop_pct: 15 }, 200000);
const ALL = [A, B, LIVE, C];

describe("explainStrategy", () => {
  it("states a rank strategy's rules from its params", () => {
    const e = explainStrategy(A, ALL);
    expect(e.code).toBe("A");
    expect(e.title).toBe("reference system + AI gate");
    expect(e.rules[0]).toBe("Ranks the 214 halal stocks in SPUS by their 12-month price gain and buys the top 15; a holding is kept while it stays in the top 25.");
    expect(e.rules.join(" ")).toMatch(/once a month/);
    expect(e.rules.join(" ")).toMatch(/earnings within 3 days/);
    expect(e.rules.join(" ")).toMatch(/not reviewed by 12:00 ET goes through/);
    expect(e.rules.join(" ")).toMatch(/SPSK \(a sukuk fund\)/);
    expect(e.rules.at(-1)).toMatch(/AAOIFI/);
    expect(e.money).toBe("$250,000 of paper money. Fills are simulated; nothing real is at stake.");
    expect(e.oneLine).toBe("The 15 strongest halal stocks, rebalanced monthly, with an AI check before each buy.");
  });

  it("names what an experiment tests by the ONE rule it differs from a sibling by", () => {
    expect(explainStrategy(A, ALL).tests).toBe("Tests the AI gate: B runs the same rules without it, so the gap between them is what the AI gate adds.");
    expect(explainStrategy(B, ALL).tests).toBe("The control for A: the same rules without the AI gate, so A minus this is what the AI gate adds.");
    expect(explainStrategy(C, ALL).tests).toMatch(/^Tests the protective stop: the live control runs the same rules/);
    expect(explainStrategy(C, ALL).rules.join(" ")).toMatch(/sell-stop 15% below what it paid/);
    // Cards sharing an engine must not read alike.
    expect(explainStrategy(B, ALL).oneLine).toBe("The 15 strongest halal stocks, rebalanced monthly — the control for A.");
    expect(explainStrategy(C, ALL).oneLine).toBe("The 25 strongest halal stocks, rebalanced weekly, with a 15% stop.");
  });

  it("never pairs with the shadow panel, which trades nothing", () => {
    const SH = rank("s", { layer: "shadow", research_panel: true });
    expect(explainStrategy(B, [B, SH]).tests).toBeNull();
    expect(explainStrategy(SH, [B, SH]).tests).toBeNull();
  });

  it("ignores bookkeeping (dates, labels) when pairing, and does not pair across two differences", () => {
    const X = rank("x", { ai_gate: true, whole_shares: true });
    expect(explainStrategy(X, [X, B]).tests).toBeNull();
  });

  it("explains the swing, the shadow panel and the DCA", () => {
    const D = { id: "d", strategy_type: "breakout", capital_allocated: "150000", stop_loss_pct: "3", profit_target_pct: "5",
      params: { broker: "alpaca_paper", experiment: "D: swing", entry_threshold_pct: 1.5, trail_pct: 2, trail_activate_pct: 2, broker_exits: true, universe_tickers: Array(25).fill("X") } };
    const d = explainStrategy(D, [D]);
    expect(d.rules[0]).toBe("Watches 25 large halal stocks and buys the strongest one once it is up 1.5% on the day.");
    expect(d.rules[1]).toBe("Holds one position at a time. Sells at +5%, at a 3% loss, or if it falls 2% from its high once it is up 2%.");
    const Esw = { ...D, id: "e", params: { ...D.params, experiment: "E · swing: D + volume confirmation", experiment_group: "E", min_relative_volume: 1.5 } };
    expect(explainStrategy(Esw, [D, Esw]).rules[0]).toMatch(/at least 1.5× its usual volume/);
    expect(explainStrategy(Esw, [D, Esw]).tests).toMatch(/^Tests the volume check: D runs the same rules/);

    const SH = rank("s", { layer: "shadow", research_panel: true, rebalance_days: 1 }, 0);
    const sh = explainStrategy(SH, []);
    expect(sh.code).toBe("Shadow");
    expect(sh.rules[0]).toMatch(/Never places an order/);
    expect(sh.money).toBe("No money — records only.");
    expect(sh.rules.join(" ")).not.toMatch(/AAOIFI/);

    const DCA = { id: "dca", strategy_type: "dca", capital_allocated: "175",
      params: { dca_amount: 50, dca_cadence_days: 7, basket: JSON.stringify([{ ticker: "SPUS", weight: 0.5 }, { ticker: "SPWO", weight: 0.3 }, { ticker: "SPSK", weight: 0.2 }]) } };
    const dca = explainStrategy(DCA, []);
    expect(dca.rules[0]).toBe("Every 7 days it buys $50 of whichever fund is furthest below its target (SPUS 50% · SPWO 30% · SPSK 20%).");
    expect(dca.money).toBe("$175 of real money at your broker.");
  });

  it("small-account sizing states the per-slot price cap", () => {
    const F = rank("f", { experiment: "F: small account", buy_top: 3, hold_zone: 6, whole_shares: true }, 300);
    expect(explainStrategy(F, [F]).rules.join(" ")).toMatch(/each priced at most \$100 \(its money ÷ 3 slots\)/);
  });
});
