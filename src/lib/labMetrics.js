/**
 * Pure: the Trade Lab's risk-adjusted figures (proposal §16) — Sharpe, Sortino,
 * volatility, drawdown from the paper account's daily equity, and each
 * strategy's closed-trade win rate. The ratio math is performance.js's
 * (the same functions the main app's RETURN & RISK panel uses); this adds
 * Sortino and the honest "not enough days yet" gate.
 *
 * Risk-free rate is 0 — the riba-consistent choice: there is no interest-
 * bearing benchmark to subtract.
 */
import { sharpeRatio, annualizedVolatility, maxDrawdown, annualizedReturn } from "./performance.js";

const arr = (v) => (Array.isArray(v) ? v : []);
const fin = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
export const MIN_RISK_DAYS = 20;

/** Daily simple returns from [{t, v}] equity points (one per day, ascending). */
export function dailyReturnsFromPoints(points) {
  const v = arr(points).map((p) => fin(p?.v)).filter((x) => x !== null && x > 0);
  const out = [];
  for (let i = 1; i < v.length; i++) out.push(v[i] / v[i - 1] - 1);
  return out;
}

/** Sortino: annualised mean over annualised DOWNSIDE deviation. Null with no down days. */
export function sortinoRatio(returns) {
  const r = arr(returns).filter((x) => Number.isFinite(x));
  if (r.length < 2) return null;
  const down = r.map((x) => Math.min(0, x));
  const dd = Math.sqrt(down.reduce((s, x) => s + x * x, 0) / r.length) * Math.sqrt(252);
  return dd > 0 ? annualizedReturn(r) / dd : null;
}

/** The account's risk figures, or {ready:false} until there are enough days to mean anything. */
export function riskFromPoints(points, opts) {
  const minDays = fin(opts?.minDays) ?? MIN_RISK_DAYS;
  const r = dailyReturnsFromPoints(points);
  if (r.length < minDays) return { ready: false, days: r.length, needed: minDays };
  return { ready: true, days: r.length, sharpe: sharpeRatio(r, 0), sortino: sortinoRatio(r),
    volatility: annualizedVolatility(r), maxDrawdown: maxDrawdown(r) };
}

/** A strategy's closed round trips, from the server's progress block. Null before any close. */
export function winRate(progress) {
  const p = progress && typeof progress === "object" ? progress : {};
  const closed = fin(p.closed_count) ?? 0, wins = fin(p.wins) ?? 0, losses = fin(p.losses) ?? 0;
  if (!(closed > 0)) return null;
  return { closed, wins, losses, rate: Math.round((wins / closed) * 1000) / 10, realized: fin(p.realized_pnl) };
}
