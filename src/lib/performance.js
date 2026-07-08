// Portfolio performance analytics — pure, dependency-free, unit-testable.
//
// Phase 2 of the benchmark roadmap. The benchmarked apps get return math
// subtly wrong (Ghostfolio's TWR/MWR classes are unimplemented stubs; Maybe is
// avg-cost only). These functions give Mizan honest, standard measures:
//   - money-weighted return (XIRR)   → what the investor actually earned, timing included
//   - realized / unrealized split    → gains banked vs still on paper
//   - max drawdown / volatility / Sharpe → risk, from the daily net-worth curve
//
// All amounts are plain numbers. Dates accept ISO strings or Date objects.
// Nothing here touches React, the DOM, or storage.

const DAY_MS = 86_400_000;
const YEAR_DAYS = 365.25;
const TRADING_DAYS = 252;

const toTime = (d) => (d instanceof Date ? d.getTime() : new Date(d).getTime());

// ── XIRR (money-weighted, annualized) ─────────────────────────────────────────
// Net present value of dated cashflows at a given annual rate. Convention:
// money INTO the portfolio is negative, money OUT (and the terminal value) is
// positive — the standard IRR sign convention.
function xnpv(rate, cashflows, t0) {
  let sum = 0;
  for (const cf of cashflows) {
    const years = (toTime(cf.date) - t0) / (DAY_MS * YEAR_DAYS);
    sum += cf.amount / Math.pow(1 + rate, years);
  }
  return sum;
}

function dxnpv(rate, cashflows, t0) {
  let sum = 0;
  for (const cf of cashflows) {
    const years = (toTime(cf.date) - t0) / (DAY_MS * YEAR_DAYS);
    if (years === 0) continue;
    sum += (-years * cf.amount) / Math.pow(1 + rate, years + 1);
  }
  return sum;
}

// Solve for the annual rate r where xnpv(r) = 0. Newton's method with a
// bisection fallback (robust when Newton diverges). Returns null when the
// cashflows can't yield a rate (need at least one inflow and one outflow).
export function xirr(cashflows) {
  const cfs = [...(cashflows || [])]
    .filter((c) => c && Number.isFinite(Number(c.amount)) && c.date != null)
    .map((c) => ({ amount: Number(c.amount), date: c.date }))
    .sort((a, b) => toTime(a.date) - toTime(b.date));
  if (cfs.length < 2) return null;
  const hasPos = cfs.some((c) => c.amount > 0);
  const hasNeg = cfs.some((c) => c.amount < 0);
  if (!hasPos || !hasNeg) return null;
  const t0 = toTime(cfs[0].date);

  // Newton's method
  let rate = 0.1;
  for (let i = 0; i < 100; i++) {
    const v = xnpv(rate, cfs, t0);
    const d = dxnpv(rate, cfs, t0);
    if (!Number.isFinite(v) || !Number.isFinite(d) || d === 0) break;
    const next = rate - v / d;
    if (!Number.isFinite(next) || next <= -0.9999) break;
    if (Math.abs(next - rate) < 1e-7) return next;
    rate = next;
  }

  // Bisection fallback over a wide bracket
  let lo = -0.9999, hi = 100;
  const fLo = xnpv(lo, cfs, t0), fHi = xnpv(hi, cfs, t0);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || fLo * fHi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = xnpv(mid, cfs, t0);
    if (Math.abs(fMid) < 1e-7) return mid;
    if (fLo * fMid < 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

// Build the external-cashflow series for a money-weighted return: contributions
// are money in (negative), withdrawals are money out (positive), and the
// current portfolio value is a positive terminal cashflow dated `asOf`.
// Dividends/fees are internal (already reflected in currentValue) — excluded.
export function buildCashflows(activities, currentValue, asOf = new Date()) {
  const cfs = [];
  for (const a of activities || []) {
    const type = String(a?.type || "").toUpperCase();
    const amt = Math.abs(Number(a?.amount) || 0);
    const date = a?.trade_date || a?.settlement_date;
    if (!date || amt <= 0) continue;
    if (type === "DEPOSIT") cfs.push({ date, amount: -amt });     // cash in
    else if (type === "WITHDRAWAL") cfs.push({ date, amount: amt }); // cash out
  }
  if (currentValue > 0) cfs.push({ date: asOf, amount: currentValue });
  return cfs;
}

// Money-weighted annualized return from activity flows + current value.
// Returns { rate, hasFlows } — rate is a decimal (0.1 = 10%/yr) or null.
export function moneyWeightedReturn(activities, currentValue, asOf = new Date()) {
  const cfs = buildCashflows(activities, currentValue, asOf);
  const flowCount = cfs.filter((c) => c.amount < 0).length;
  return { rate: xirr(cfs), hasFlows: flowCount > 0, cashflows: cfs };
}

// ── Modified-Dietz / ROAI (day-weighted-average-capital return) ────────────────
// Whole-period return that credits the gain against the *average* capital that
// was actually at work — not just the opening balance. Each external flow is
// weighted by the fraction of the period it was invested:
//
//   avgCapital = startValue + Σ( flowᵢ × daysRemainingᵢ / periodDays )
//   gain       = endValue − startValue − Σ flowᵢ         (the part flows don't explain)
//   return     = gain / avgCapital
//
// Flow sign is money-INTO-the-portfolio positive (deposit +, withdrawal −) — the
// opposite of the XIRR cashflow convention, but the standard Modified-Dietz one.
// `daysRemaining` = days from the flow to endDate, so an early deposit (invested
// longer) earns more weight (→1 at the start, →0 at the end). Returns a decimal
// (0.1 = +10%) or null when it can't be computed honestly — see the guards.
export function modifiedDietzReturn({ startValue, endValue, startDate, endDate, flows = [] } = {}) {
  const sv = Number(startValue);
  const ev = Number(endValue);
  if (!Number.isFinite(sv) || !Number.isFinite(ev)) return null;      // missing start/end value
  if (startDate == null || endDate == null) return null;              // missing period bounds
  const t0 = toTime(startDate);
  const t1 = toTime(endDate);
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return null;      // unparseable dates
  const periodDays = (t1 - t0) / DAY_MS;
  if (!(periodDays > 0)) return null;                                 // empty / single-day period

  let netFlows = 0;        // Σ flowᵢ           (subtracted from the numerator)
  let weightedFlows = 0;   // Σ flowᵢ × weightᵢ (added to the denominator)
  for (const f of flows || []) {
    const amt = Number(f?.amount);
    if (!Number.isFinite(amt) || amt === 0) continue;
    if (f?.date == null) continue;
    const ft = toTime(f.date);
    if (!Number.isFinite(ft) || ft < t0 || ft > t1) continue;        // outside the period → skip
    const daysRemaining = (t1 - ft) / DAY_MS;
    netFlows += amt;
    weightedFlows += amt * (daysRemaining / periodDays);
  }

  const avgCapital = sv + weightedFlows;                             // day-weighted denominator
  if (!(avgCapital > 0)) return null;                               // zero / negative denominator guard
  return (ev - sv - netFlows) / avgCapital;                         // gain ÷ average capital
}

// Whole-period average-capital (Modified-Dietz) return from activity flows + the
// daily net-worth curve. Anchors the period start to the earliest net-worth
// snapshot (its value + date) and the end to `currentValue` as of `asOf`.
// Reuses buildCashflows (the same parser XIRR feeds on) and flips the sign to the
// Modified-Dietz convention. Mirrors moneyWeightedReturn's shape: { rate, hasFlows }.
export function averageCapitalReturn(activities, netWorthHistory, currentValue, asOf = new Date()) {
  const rows = [...(netWorthHistory || [])]
    .filter((h) => h && h.date != null && Number.isFinite(Number(h.total)))
    .sort((a, b) => toTime(a.date) - toTime(b.date));
  if (rows.length < 1) return { rate: null, hasFlows: false };       // no start value → can't anchor
  const startValue = Number(rows[0].total);
  const startDate = rows[0].date;
  // Passing 0 suppresses buildCashflows' terminal value; negate to flip deposits
  // (−amt in the XIRR convention) to +amt here (money into the portfolio).
  const flows = buildCashflows(activities, 0, asOf).map((c) => ({ date: c.date, amount: -c.amount }));
  const t0 = toTime(startDate), t1 = toTime(asOf);
  const hasFlows = flows.some((f) => { const t = toTime(f.date); return t >= t0 && t <= t1; });
  const rate = modifiedDietzReturn({ startValue, endValue: currentValue, startDate, endDate: asOf, flows });
  return { rate, hasFlows };
}

// ── Return decomposition (realized / unrealized / simple) ─────────────────────
// Unrealized from current holdings: Σ shares×(price − avgCost). `holdings` is
// the merged position shape { sh, px, ac } used app-wide.
export function unrealizedFromHoldings(holdings) {
  let marketValue = 0, cost = 0;
  for (const h of holdings || []) {
    const sh = Number(h?.sh) || 0;
    const px = Number(h?.px) || 0;
    const ac = Number(h?.ac) || 0;
    if (sh <= 0) continue;
    marketValue += sh * px;
    if (ac > 0) cost += sh * ac;
  }
  return { marketValue, cost, unrealized: marketValue - cost };
}

// Realized P&L from SELL activities using a symbol→avgCost map (same defensible
// approximation the Tax tab uses — avg cost, not lot-level). `normSym` resolves
// the activity's symbol shape. Returns { realized, missingBasis }.
export function realizedFromActivities(activities, avgCostBySymbol, normSym, sinceISO = null) {
  let realized = 0, missingBasis = 0;
  for (const a of activities || []) {
    if (String(a?.type || "").toUpperCase() !== "SELL") continue;
    const when = a?.trade_date || a?.settlement_date || "";
    if (sinceISO && when < sinceISO) continue;
    const sym = normSym ? normSym(a.symbol) : String(a?.symbol || "").toUpperCase();
    const proceeds = Math.abs(Number(a?.amount) || 0);
    const units = Math.abs(Number(a?.units) || 0);
    const ac = avgCostBySymbol?.[sym];
    if (!sym || !units || !ac) { missingBasis++; continue; }
    realized += proceeds - units * ac;
  }
  return { realized, missingBasis };
}

// ── Risk metrics (from the daily net-worth curve) ─────────────────────────────
// Flow-adjusted daily returns: r_t = (V_t − V_{t-1} − netFlow_t) / V_{t-1}.
// Subtracting the day's external flow stops a deposit from reading as a "gain."
// `history` = [{date, total}] (any order); `flowsByDate` = { 'YYYY-MM-DD': netFlowIntoPortfolio }.
export function dailyReturns(history, flowsByDate = {}) {
  const rows = [...(history || [])]
    .filter((h) => h && h.date && Number.isFinite(Number(h.total)))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = Number(rows[i - 1].total);
    const cur = Number(rows[i].total);
    if (!(prev > 0)) continue;
    const flow = Number(flowsByDate[String(rows[i].date).slice(0, 10)]) || 0;
    out.push((cur - prev - flow) / prev);
  }
  return out;
}

// Net external flow into the portfolio per day (deposits − withdrawals), keyed
// by YYYY-MM-DD — feeds dailyReturns so risk isn't distorted by contributions.
export function flowsByDate(activities) {
  const map = {};
  for (const a of activities || []) {
    const type = String(a?.type || "").toUpperCase();
    const amt = Math.abs(Number(a?.amount) || 0);
    const date = (a?.trade_date || a?.settlement_date || "").slice(0, 10);
    if (!date || amt <= 0) continue;
    if (type === "DEPOSIT") map[date] = (map[date] || 0) + amt;
    else if (type === "WITHDRAWAL") map[date] = (map[date] || 0) - amt;
  }
  return map;
}

// Max drawdown from a returns series: largest peak-to-trough drop of the
// cumulative-return index. Returns a positive decimal (0.25 = −25%).
export function maxDrawdown(returns) {
  if (!returns || returns.length === 0) return 0;
  let idx = 1, peak = 1, maxDD = 0;
  for (const r of returns) {
    idx *= 1 + r;
    if (idx > peak) peak = idx;
    const dd = peak > 0 ? (peak - idx) / peak : 0;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
function stdev(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}

// Annualized volatility = daily stdev × √252.
export function annualizedVolatility(returns) {
  return stdev(returns || []) * Math.sqrt(TRADING_DAYS);
}

// Annualized return from the daily series (arithmetic mean × 252).
export function annualizedReturn(returns) {
  return mean(returns || []) * TRADING_DAYS;
}

// Sharpe ratio with a risk-free rate. Default rf = 0, which is also the
// riba-consistent choice for a Sharia app (no interest-bearing benchmark).
export function sharpeRatio(returns, riskFreeAnnual = 0) {
  const vol = annualizedVolatility(returns);
  if (!(vol > 0)) return null;
  return (annualizedReturn(returns) - riskFreeAnnual) / vol;
}

// One-call risk summary. `minPoints` guards against noise from a too-short
// history — returns { ready:false } until enough daily snapshots exist.
export function riskMetrics(history, activities, { minPoints = 20, riskFreeAnnual = 0 } = {}) {
  const returns = dailyReturns(history, flowsByDate(activities));
  if (returns.length < minPoints) {
    return { ready: false, points: returns.length, needed: minPoints };
  }
  return {
    ready: true,
    points: returns.length,
    maxDrawdown: maxDrawdown(returns),
    volatility: annualizedVolatility(returns),
    annualizedReturn: annualizedReturn(returns),
    sharpe: sharpeRatio(returns, riskFreeAnnual),
  };
}
