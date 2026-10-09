/**
 * Pure: the proposal's five kill-switch levels (§14 — global, broker,
 * account, strategy, symbol) stated against what the code ACTUALLY has, so the
 * Risk page shows the real safety net and names the gaps instead of implying a
 * complete one. Built from the strategy list the tab already holds.
 *
 * What exists (verified 2026-10-09):
 *  - global:   PATCH /api/bot/strategies/pause-all ("Pause all automation")
 *  - strategy: each strategy's own Pause/Resume
 *  - account:  real-money full-auto is a per-account opt-in, off by default
 *  - symbol:   no manual switch; the AAOIFI gate refuses failing names on
 *              every buy path (strategies and hand orders)
 *  - broker:   none — pausing a broker means pausing its strategies
 */
const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null);

export function killSwitchRows(strategies) {
  const list = arr(strategies).filter(obj);
  const paused = list.filter((s) => s.enabled === false);
  const allPaused = list.length > 0 && paused.length === list.length;
  const live = list.filter((s) => !(obj(s.params)?.broker === "alpaca_paper" || obj(s.progress)?.paper === true) && obj(s.params)?.layer !== "shadow");
  return [
    { level: "Global", built: true, mark: allPaused ? "block" : "off",
      state: list.length === 0 ? "no strategies" : allPaused ? "engaged — every strategy is paused" : "not engaged",
      where: "Strategies → Pause all automation" },
    { level: "Strategy", built: true, mark: paused.length ? "warn" : "off",
      state: paused.length ? `${paused.length} paused` : "none paused",
      where: "Strategies → each row's Pause" },
    { level: "Account", built: true, mark: "off",
      state: live.length ? `${live.length} real-money ${live.length === 1 ? "strategy" : "strategies"}; full-auto is opt-in per account` : "no real-money strategies",
      where: "Strategies → Full-auto accounts (off by default)" },
    { level: "Symbol", built: "partial", mark: "ok",
      state: "the AAOIFI gate refuses a failing name on every buy; there is no manual block list",
      where: "automatic" },
    { level: "Broker", built: false, mark: "unknown",
      state: "not built — pausing a broker means pausing its strategies", where: "—" },
  ];
}
