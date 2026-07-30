/**
 * MĪZAN — net worth composition. Pure: no React, no DOM, no storage, no I/O.
 *
 * Extracted 2026-07-30. The Overview headline and the daily history snapshot had
 * each grown their OWN definition of net worth, and they disagreed:
 *   · headline  = brokerage + bank + Plaid investments + manual assets
 *   · snapshot  = brokerage account balances only
 * So the chart drew a brokerage-only line and then pinned its final point to the
 * bank-inclusive headline. The step between them landed entirely in the range
 * gain — overstated by ~$1.5k on one live account, and swinging thousands
 * negative on accounts carrying card debt. Two definitions of one number is the
 * bug; this module is the one definition.
 */

// Plaid account types that represent a brokerage, not a bank.
export const isBrokeragePlaid = (a) => a?.type === "investment" || a?.type === "brokerage";

/**
 * @param {object}   input
 * @param {Array}    input.accounts        SnapTrade accounts (already filtered to visible)
 * @param {number}   input.equityValue     Σ position market value — fallback when no broker is linked
 * @param {Array}    input.plaidAccounts   Plaid accounts
 * @param {number}   input.bankBalance     Plaid depository − credit/loan (a NEGATIVE value is valid)
 * @param {number}   input.manualAssetTotal Gold, real estate, business equity
 * @returns {{total:number, brokerageTot:number, plaidInvestmentTot:number, balanceSum:number, cash:number}}
 */
export function netWorthParts({
  accounts = [],
  equityValue = 0,
  plaidAccounts = [],
  bankBalance = 0,
  manualAssetTotal = 0,
} = {}) {
  const balanceSum = accounts.reduce((s, a) => s + (+a.balance || 0), 0);
  const cash       = accounts.reduce((s, a) => s + (+a.cash || 0), 0);
  const brokerageTot = accounts.length > 0 ? balanceSum : equityValue;

  // Plaid investment balances count ONLY when SnapTrade isn't connected at all.
  // With SnapTrade linked it is the canonical brokerage source, and adding Plaid
  // investments on top double-counts any broker linked through both (Robinhood
  // shows up in each list with the same underlying balance).
  // Depository / credit / loan always count, via bankBalance — no overlap there.
  const plaidInvestmentTot = accounts.length === 0
    ? plaidAccounts.filter(isBrokeragePlaid).reduce((s, a) => s + (+a.current_bal || 0), 0)
    : 0;

  return {
    total: brokerageTot + (+bankBalance || 0) + plaidInvestmentTot + (+manualAssetTotal || 0),
    brokerageTot,
    plaidInvestmentTot,
    balanceSum,
    cash,
  };
}

export const netWorthTotal = (input) => netWorthParts(input).total;

/**
 * True when there is enough loaded data to record a history point. Guards the
 * snapshot against writing a $0 row during the load gap, WITHOUT using
 * `total > 0` — net worth is legitimately negative for a user whose card debt
 * exceeds their investments, and that user needs a history line too.
 */
export function hasSnapshotableData({ accounts = [], plaidAccounts = [], bankBalance = 0, manualAssetTotal = 0 } = {}) {
  return accounts.length > 0
    || plaidAccounts.length > 0
    || (+bankBalance || 0) !== 0
    || (+manualAssetTotal || 0) !== 0;
}

/**
 * Days of net-worth history to retain. ONE constant because the client and the
 * nightly cron now write the same key: when the client kept 3650 and the cron
 * kept 365, every nightly run would silently trim a decade of history down to a
 * year. Whoever writes last must not be able to destroy what the other kept.
 */
export const NW_HISTORY_CAP = 3650;

/**
 * Merge the two historical net-worth series into the canonical one. Pure.
 *
 * Precedence, oldest→newest, capped at NW_HISTORY_CAP entries:
 *   1. today's freshly computed entry always wins
 *   2. otherwise the LEGACY value wins on any shared date — the legacy
 *      `networth_history` key was the bank-inclusive one, while the canonical
 *      key held brokerage-only totals written by the old client effect
 *   3. dates only one side has are carried through
 *
 * Runs against real financial history for every user, so it tolerates every
 * shape actually in the database: `{date,total,cash,accounts}` (client),
 * `{date,value}` (legacy server), a non-array/null column, and junk entries.
 * Idempotent — re-running merges the same result, which is what makes the
 * repair self-healing rather than a one-shot migration.
 */
export function mergeNetWorthHistory(canonical, legacy, todayEntry, cap = NW_HISTORY_CAP) {
  const byDate = new Map();
  for (const e of (Array.isArray(canonical) ? canonical : [])) {
    if (e?.date) byDate.set(e.date, { ...e });
  }
  for (const e of (Array.isArray(legacy) ? legacy : [])) {
    if (!e?.date) continue;
    const v = Number(e.value ?? e.total);
    if (!Number.isFinite(v)) continue;
    byDate.set(e.date, { ...(byDate.get(e.date) || {}), date: e.date, total: v });
  }
  if (todayEntry?.date && Number.isFinite(Number(todayEntry.total))) {
    byDate.set(todayEntry.date, { date: todayEntry.date, total: Number(todayEntry.total) });
  }
  return [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-cap);
}
