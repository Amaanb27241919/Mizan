// Performance analytics panel (Overview) — money-weighted return, realized vs
// unrealized position P&L, and risk metrics. Phase 2 of the benchmark roadmap.
//
// Decoupled from MizanApp like Goals.jsx: it re-derives theme tokens from CSS
// custom properties and takes everything it needs as props. All math lives in
// ../lib/performance.js (pure + unit-tested).
import React, { useMemo, useState } from "react";
import {
  moneyWeightedReturn,
  unrealizedFromHoldings,
  realizedFromActivities,
  riskMetrics,
} from "../lib/performance.js";

const T = {
  card: "var(--mz-card)", surface: "var(--mz-surface)",
  border: "var(--mz-border)", borderHi: "var(--mz-borderHi)",
  text: "var(--mz-text)", textHi: "var(--mz-textHi)", muted: "var(--mz-muted)",
  blue: "#1e4e8c", gain: "#117a52", gold: "#b8842a", loss: "#b23a3d",
  s1: "var(--s-1)", s2: "var(--s-2)", s3: "var(--s-3)", s4: "var(--s-4)",
  s5: "var(--s-5)", s6: "var(--s-6)",
  rSm: "var(--r-sm)", rMd: "var(--r-md)", rLg: "var(--r-lg)",
};
const FP = "'IBM Plex Sans',system-ui,-apple-system,BlinkMacSystemFont,sans-serif";
const FM = "'IBM Plex Mono','JetBrains Mono','Menlo','Monaco',monospace";
const FU = FP;

const fmtUSD = (v) => `${v < 0 ? "−" : ""}$${Math.abs(+v || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const fmtPct = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;
const fc = (v) => (v > 0 ? T.gain : v < 0 ? T.loss : T.muted);

// Resolve SnapTrade's three symbol shapes (string | {symbol} | {symbol:{raw_symbol}}).
function normSym(sym) {
  let s = sym;
  let depth = 0;
  while (s && typeof s === "object" && s.symbol && typeof s.symbol === "object" && depth < 3) { s = s.symbol; depth++; }
  if (typeof s === "string") return s.toUpperCase();
  const tk = s?.symbol || s?.raw_symbol || s?.ticker || "";
  return String(tk || "").toUpperCase();
}

function Stat({ label, value, sub, color, big }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ fontFamily: FM, fontSize: 9, color: T.muted, letterSpacing: "0.16em", fontWeight: 600 }}>{label}</div>
      <div style={{ fontFamily: FU, fontSize: big ? 26 : 18, fontWeight: 700, color: color || T.textHi, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ fontFamily: FM, fontSize: 10, color: T.muted }}>{sub}</div>}
    </div>
  );
}

export default function PerformancePanel({
  holdings = [],
  activities = [],
  netWorthHistory = [],
  currentValue = 0,
  mask = (v) => v,
}) {
  const [open, setOpen] = useState(false);

  const perf = useMemo(() => {
    // Money-weighted (XIRR) return over all external cashflows.
    const mwr = moneyWeightedReturn(activities, currentValue);
    // Position P&L: unrealized from holdings + realized from SELLs (avg cost).
    const { marketValue, cost, unrealized } = unrealizedFromHoldings(holdings);
    const avgCostBySymbol = {};
    holdings.forEach((h) => { if (h?.tk && Number(h.ac) > 0) avgCostBySymbol[String(h.tk).toUpperCase()] = Number(h.ac); });
    const { realized, missingBasis } = realizedFromActivities(activities, avgCostBySymbol, normSym);
    // Total P&L is position-derived (realized + unrealized) so it reconciles
    // exactly with the Position P&L tiles below and the Overview hero's Total
    // Return — never a separate account-balance-minus-deposits figure that could
    // disagree. Simple return expresses it against the cost basis actually paid.
    const totalPnl = realized + unrealized;
    const simplePct = cost > 0 ? (totalPnl / cost) * 100 : null;
    const unrealizedPct = cost > 0 ? (unrealized / cost) * 100 : null;
    const risk = riskMetrics(netWorthHistory, activities, { minPoints: 20, riskFreeAnnual: 0 });
    return { mwr, marketValue, cost, unrealized, unrealizedPct, realized, missingBasis, totalPnl, simplePct, risk };
  }, [holdings, activities, netWorthHistory, currentValue]);

  const mwrPct = perf.mwr.rate != null ? perf.mwr.rate * 100 : null;

  return (
    <div className="bento-tile" style={{
      background: `radial-gradient(circle at 0% 0%, ${T.blue}12, transparent 55%), ${T.card}`,
      border: `1px solid ${T.border}`,
      borderTop: `2px solid ${T.blue}`,
      borderLeft: `1px solid ${T.blue}30`,
      borderRadius: T.rLg,
      boxShadow: "var(--sh-md)",
      overflow: "hidden",
    }}>
      {/* Header — click to expand (secondary panel, collapsed by default) */}
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: T.s3, padding: `${T.s4} ${T.s5}`, background: "transparent", border: "none", cursor: "pointer", textAlign: "left",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontFamily: FM, fontSize: 11, color: T.blue, letterSpacing: "0.18em", fontWeight: 600 }}>RETURN &amp; RISK</span>
          <span style={{ fontFamily: FP, fontSize: 12, color: T.muted }}>
            {mwrPct != null
              ? <>Money-weighted return <span style={{ fontFamily: FM, color: fc(mwrPct), fontWeight: 600 }}>{fmtPct(mwrPct)}/yr</span></>
              : <>Return &amp; risk analytics</>}
          </span>
        </div>
        <span style={{ fontFamily: FM, fontSize: 16, color: T.muted, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>›</span>
      </button>

      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: T.s5, padding: `0 ${T.s5} ${T.s5}` }}>
          {/* Return lens */}
          <div>
            <div style={{ fontFamily: FM, fontSize: 10, color: T.muted, letterSpacing: "0.12em", fontWeight: 600, marginBottom: T.s3 }}>RETURN</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: T.s4 }}>
              <Stat big label="MONEY-WEIGHTED (XIRR)"
                value={mwrPct != null ? fmtPct(mwrPct) : "—"}
                sub={mwrPct != null ? "annualized · timing-aware" : (perf.mwr.hasFlows ? "not enough data" : "no contributions logged")}
                color={mwrPct != null ? fc(mwrPct) : T.muted} />
              <Stat label="TOTAL P&amp;L"
                value={mask(fmtUSD(perf.totalPnl))}
                sub="realized + unrealized"
                color={fc(perf.totalPnl)} />
              <Stat label="SIMPLE RETURN"
                value={perf.simplePct != null ? fmtPct(perf.simplePct) : "—"}
                sub="total P&amp;L ÷ cost basis"
                color={perf.simplePct != null ? fc(perf.simplePct) : T.muted} />
            </div>
          </div>

          {/* Position P&L lens */}
          <div>
            <div style={{ fontFamily: FM, fontSize: 10, color: T.muted, letterSpacing: "0.12em", fontWeight: 600, marginBottom: T.s3 }}>POSITION P&amp;L</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: T.s4 }}>
              <Stat label="UNREALIZED"
                value={mask(fmtUSD(perf.unrealized))}
                sub={perf.unrealizedPct != null ? `${fmtPct(perf.unrealizedPct)} on cost` : "on current holdings"}
                color={fc(perf.unrealized)} />
              <Stat label="REALIZED"
                value={mask(fmtUSD(perf.realized))}
                sub={perf.missingBasis > 0 ? `${perf.missingBasis} sell${perf.missingBasis === 1 ? "" : "s"} missing basis` : "from closed sells"}
                color={fc(perf.realized)} />
              <Stat label="MARKET VALUE"
                value={mask(fmtUSD(perf.marketValue))}
                sub={`cost ${mask(fmtUSD(perf.cost))}`} />
            </div>
          </div>

          {/* Risk lens */}
          <div>
            <div style={{ fontFamily: FM, fontSize: 10, color: T.muted, letterSpacing: "0.12em", fontWeight: 600, marginBottom: T.s3 }}>RISK</div>
            {perf.risk.ready ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: T.s4 }}>
                <Stat label="MAX DRAWDOWN"
                  value={`−${(perf.risk.maxDrawdown * 100).toFixed(1)}%`}
                  sub="largest peak-to-trough" color={T.loss} />
                <Stat label="VOLATILITY"
                  value={`${(perf.risk.volatility * 100).toFixed(1)}%`}
                  sub="annualized" />
                <Stat label="SHARPE"
                  value={perf.risk.sharpe != null ? perf.risk.sharpe.toFixed(2) : "—"}
                  sub="vs 0% (riba-free) rate"
                  color={perf.risk.sharpe != null ? fc(perf.risk.sharpe) : T.muted} />
              </div>
            ) : (
              <div style={{ fontFamily: FP, fontSize: 12, color: T.muted, padding: `${T.s3} ${T.s4}`, background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.rMd }}>
                Accruing daily history — {perf.risk.points}/{perf.risk.needed} days. Drawdown, volatility, and Sharpe unlock once enough net-worth snapshots exist (they build while the app is open).
              </div>
            )}
          </div>

          <div style={{ fontFamily: FP, fontSize: 10, color: T.muted, lineHeight: 1.5 }}>
            Estimates. Money-weighted return (XIRR) uses your logged contributions/withdrawals + current value. Position P&amp;L uses average cost (broker doesn't supply lots). Risk uses the daily net-worth curve, flow-adjusted so deposits don't read as gains; Sharpe assumes a 0% risk-free rate (riba-free). Not financial advice.
          </div>
        </div>
      )}
    </div>
  );
}
