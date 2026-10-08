/**
 * Pure: geometry for the desk's small strategy charts. Both lines — the
 * strategy and SPUS — share ONE y-scale (never two axes), anchored so 0% is
 * always inside the box: a chart whose floor is +0.4% makes a flat week look
 * like a crash. Points without a value are skipped, not drawn at zero.
 */
const arr = (v) => (Array.isArray(v) ? v : []);
const finite = (v) => v !== null && v !== undefined && Number.isFinite(Number(v));

export function sparkPaths(points, opts) {
  // `= {}` defaults fire only for undefined; a null second argument is real.
  const o = opts && typeof opts === "object" ? opts : {};
  const w = Number(o.w) > 0 ? Number(o.w) : 280, h = Number(o.h) > 0 ? Number(o.h) : 64, pad = Number(o.pad) >= 0 ? Number(o.pad) : 4;
  const pts = arr(points).filter((p) => p && typeof p === "object");
  const vals = pts.flatMap((p) => [p.returnPct, p.benchPct]).filter(finite).map(Number);
  if (pts.length < 2 || !vals.length) return null;
  let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  if (hi - lo < 0.5) { const mid = (hi + lo) / 2; lo = mid - 0.25; hi = mid + 0.25; }
  const x = (i) => pad + (i * (w - pad * 2)) / (pts.length - 1);
  const y = (v) => pad + ((hi - Number(v)) * (h - pad * 2)) / (hi - lo);
  const line = (key) => {
    const seg = pts.map((p, i) => (finite(p[key]) ? `${x(i).toFixed(1)},${y(p[key]).toFixed(1)}` : null)).filter(Boolean);
    return seg.length >= 2 ? seg.join(" ") : null;
  };
  return { strategy: line("returnPct"), bench: line("benchPct"), zeroY: Number(y(0).toFixed(1)), w, h };
}

/**
 * Pin today's live score onto the end of a daily curve so the line ends on
 * the number printed beside it. Replaces a point already dated today.
 */
export function pinToday(points, today, live) {
  const list = arr(points).filter((p) => p && p.day !== today);
  if (!list.length || !finite(live?.returnPct)) return list;
  return [...list, { day: today, returnPct: Number(live.returnPct), benchPct: finite(live.benchPct) ? Number(live.benchPct) : null }];
}
