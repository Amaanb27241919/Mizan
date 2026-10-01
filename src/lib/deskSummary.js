/**
 * Trade Lab status-rail arithmetic. Pure — no React, no DOM, no I/O.
 *
 * The rail shows two desks side by side: the Alpaca PAPER account (whose
 * equity and day change the broker hands us directly, via /api/alpaca/account)
 * and the LIVE brokerage book, which has no such endpoint and must be derived
 * from connected accounts plus live quotes. This module is that derivation.
 *
 * THE POINT OF THIS FILE is the `coverage` it returns alongside every number.
 * A day change summed over the positions that happen to have a live quote is
 * not the day change of the book — it is the day change of part of the book,
 * and the two differ by however much is missing. Live prices arrive
 * asynchronously and some symbols never get one (OTC, some crypto, a thin
 * ETF), so a rail that printed the partial sum as "DAY −$0.28" would be
 * confidently wrong in a way nobody could see. Callers are expected to render
 * a partial figure differently, or not at all.
 *
 * Mizan has paid for exactly this class of bug before: the net-worth chart
 * pinned its tip to a bank-inclusive total while its history held
 * brokerage-only values, and the difference silently became "gain".
 */

/** Sum of balances across the accounts the Trade Lab can act on. */
export function deskEquity(accounts) {
  if (!Array.isArray(accounts)) return 0;
  return accounts.reduce((sum, a) => sum + (Number(a?.balance) || 0), 0);
}

/**
 * Day change for a live brokerage book, derived from quotes.
 *
 * `live` is the shared quote map, `{ [symbol]: { c, pc } }` — current price
 * and previous close. A position contributes qty × (c − pc), which is the only
 * honest definition available without per-account prior-close data.
 *
 * Returns { change, changePct, quoted, total, value, complete }:
 *   quoted/total  how many positions had a usable quote
 *   value         market value of the QUOTED positions only — the correct
 *                 denominator for changePct, since dividing a partial change
 *                 by the full book's value understates the move
 *   complete      every position was quoted; only then is `change` the book's
 */
export function deskDayChange(accounts, live, mapPosition) {
  const out = { change: 0, changePct: null, quoted: 0, total: 0, value: 0, complete: false };
  if (!Array.isArray(accounts) || typeof mapPosition !== "function") return out;

  const quotes = live && typeof live === "object" ? live : {};
  let prevValue = 0;

  for (const acct of accounts) {
    for (const raw of (Array.isArray(acct?.positions) ? acct.positions : [])) {
      let pos;
      // A malformed position must cost one row, never the whole rail.
      try { pos = mapPosition(raw, quotes); } catch { continue; }
      if (!pos) continue;
      out.total++;

      const sym = pos.sym || pos.symbol;
      const q = sym ? quotes[sym] : null;
      const cur = Number(q?.c), prev = Number(q?.pc), qty = Number(pos.qty);
      // Needs both legs and a quantity. A zero previous close is not a
      // "price that happens to be zero", it is a missing field, and dividing
      // by it yields Infinity.
      if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev <= 0 || !Number.isFinite(qty)) continue;

      out.quoted++;
      out.change += qty * (cur - prev);
      out.value  += qty * cur;
      prevValue  += qty * prev;
    }
  }

  out.complete = out.total > 0 && out.quoted === out.total;
  if (prevValue > 0) out.changePct = (out.change / prevValue) * 100;
  return out;
}

/**
 * Both desks, in the shape the rail renders.
 *
 * `paper` is whatever /api/alpaca/account returned (or null while loading /
 * when Alpaca is not configured) and is passed through rather than recomputed:
 * the broker's own equity figure is more authoritative than anything derived
 * here, and re-deriving it would create a second definition.
 */
export function deskSummary({ paper = null, accounts = [], live = {}, mapPosition = null } = {}) {
  const day = deskDayChange(accounts, live, mapPosition);
  return {
    paper: paper
      ? {
          equity: paper.equity ?? null,
          cash: paper.cash ?? null,
          change: paper.dayChange ?? null,
          changePct: paper.dayChangePct ?? null,
          complete: true,              // broker-reported, not derived
          accountNumber: paper.accountNumber || null,
          shared: paper.source === "shared",
          blocked: paper.tradingBlocked === true,
        }
      : null,
    live: {
      equity: deskEquity(accounts),
      cash: null,                      // SnapTrade cash is per-account; not aggregated here
      change: day.total > 0 ? day.change : null,
      changePct: day.changePct,
      complete: day.complete,
      quoted: day.quoted,
      total: day.total,
    },
  };
}
