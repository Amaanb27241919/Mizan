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
