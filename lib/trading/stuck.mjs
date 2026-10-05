/**
 * Pure (no I/O): spot a strategy that keeps failing, and name WHY in words a
 * person can act on.
 *
 * Written 2026-10-04 after the funded E*TRADE DCA (`3de2c0d1`) was rejected 46
 * trading days in a row — Aug 5 to Oct 2 — and nobody found out. The broker
 * login had been revoked (SnapTrade status `reauth`), the symbol search returned
 * a non-2xx, and the resolver swallowed the status and reported "could not
 * resolve symbol SPWO", which points at the ticker instead of the connection.
 * Each day it inserted another `rejected` row and moved on.
 *
 * Two fixes live here: `describeFailure` keeps the real cause in the error, and
 * `findStuckStrategies` lets the daily sweep email the owner after a few days
 * instead of never.
 */

/** Consecutive rejections before a strategy counts as stuck. Three trading days. */
export const STUCK_THRESHOLD = 3

const arr = (x) => (Array.isArray(x) ? x : [])

/**
 * @param {Array<{id:string, enabled?:boolean}>} strategies
 * @param {Array<{strategy_id:string, status:string, created_at:string, error_msg?:string|null}>} signals
 * @param {{threshold?: number}} [opts]
 * @returns {Array<{strategy_id:string, consecutive:number, since:string, last_at:string, last_error:string|null}>}
 */
export function findStuckStrategies(strategies, signals, opts) {
  const threshold = Number(opts?.threshold) || STUCK_THRESHOLD
  const enabled = new Set(arr(strategies).filter((s) => s && s.enabled !== false && s.id).map((s) => s.id))

  // Newest first, per strategy. Shadow rows are records, never orders, so they
  // can neither break nor extend a failure streak.
  const byStrategy = new Map()
  for (const s of arr(signals)) {
    if (!s || !enabled.has(s.strategy_id) || s.status === 'shadow') continue
    const list = byStrategy.get(s.strategy_id) || []
    byStrategy.set(s.strategy_id, [...list, s])
  }

  const out = []
  for (const [strategy_id, list] of byStrategy) {
    const newestFirst = [...list].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    const streak = []
    for (const s of newestFirst) {
      if (s.status !== 'rejected') break
      streak.push(s)
    }
    if (streak.length < threshold) continue
    out.push({
      strategy_id,
      consecutive: streak.length,
      since: streak[streak.length - 1].created_at,
      last_at: streak[0].created_at,
      last_error: streak[0].error_msg ?? null,
    })
  }
  return out
}

/**
 * Turn a failed SnapTrade symbol lookup into an error that names the real cause.
 * @param {{status:number, empty?:boolean}} result
 * @param {string} [ticker]
 * @returns {string}
 */
export function describeFailure(result, ticker = '') {
  const status = Number(result?.status) || 0
  const t = String(ticker || '').toUpperCase()
  if (status === 401 || status === 403) {
    return `brokerage login rejected (HTTP ${status}) — reconnect this brokerage in Settings → Connections`
  }
  if (status === 402) {
    return `brokerage connection is read-only (HTTP 402) — reconnect it with trade permission`
  }
  if (status >= 200 && status < 300) {
    return `could not resolve symbol ${t} for account (broker returned no match)`
  }
  return `symbol lookup for ${t} failed (HTTP ${status || 'no response'})`
}
