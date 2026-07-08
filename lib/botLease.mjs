/**
 * MĪZAN — trading-bot per-tick CLAIM lease (pure).
 *
 * The `/api/cron/bot-signals` handler can fire more than once for the same tick:
 * the GitHub Actions weekday 15-minute schedule PLUS the Vercel daily backstop
 * both land at the top of the hour, and the endpoint is also manually POST-able
 * with the CRON_SECRET. SnapTrade's checked-place endpoint
 * exposes no client idempotency key, so two overlapping fires could each run a
 * strategy's whole loop iteration and DOUBLE-EXECUTE (duplicate BUY / double
 * SELL / racy DCA insert).
 *
 * We serialize per-strategy with an atomic compare-and-swap on the existing
 * `bot_strategies.updated_at` column used as a lease (NO new column / migration):
 * a fire may CLAIM a strategy only when its `updated_at` predates
 * `now - BOT_CLAIM_LEASE_MS`. The claim bumps `updated_at` to now, so a
 * near-simultaneous second fire fails the `WHERE updated_at < threshold`
 * predicate, matches zero rows, and skips the strategy this tick.
 *
 * Lease-window sizing — the window must sit BETWEEN:
 *   - a single cron run's wall-clock duration (so a run's own late `updated_at`
 *     writes never let an overlapping fire re-claim mid-run), and
 *   - the cron cadence (so the NEXT legitimate tick can re-claim the strategy).
 * Cadence is 15 min on weekdays; 5 min sits comfortably above a sub-minute
 * duplicate-fire gap and well below the 15-min cadence.
 *
 * Pure + dependency-free so the lease semantics are unit-testable without any
 * Supabase/cron mocking. The AUTHORITATIVE check is the DB update's WHERE clause
 * in handlers.mjs; `isStrategyClaimable` mirrors it for tests only.
 */

export const BOT_CLAIM_LEASE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * ISO timestamp a strategy's `updated_at` must be STRICTLY OLDER than to be
 * claimable on this tick (i.e. the `.lt("updated_at", ...)` bound).
 * @param {number} nowMs   - reference "now" in epoch ms (default Date.now()).
 * @param {number} leaseMs - lease window in ms (default BOT_CLAIM_LEASE_MS).
 * @returns {string} ISO-8601 threshold timestamp.
 */
export function botClaimLeaseThresholdIso(nowMs = Date.now(), leaseMs = BOT_CLAIM_LEASE_MS) {
  return new Date(nowMs - leaseMs).toISOString();
}

/**
 * Pure predicate mirroring the DB compare-and-swap: is a strategy claimable at
 * `nowMs` given its last `updated_at`? A missing/invalid timestamp is treated as
 * stale (claimable) so a strategy can never get permanently stuck unclaimable.
 * @param {string|null|undefined} updatedAtIso
 * @param {number} nowMs
 * @param {number} leaseMs
 * @returns {boolean}
 */
export function isStrategyClaimable(updatedAtIso, nowMs = Date.now(), leaseMs = BOT_CLAIM_LEASE_MS) {
  const t = Date.parse(updatedAtIso);
  if (Number.isNaN(t)) return true;
  return t < (nowMs - leaseMs);
}
