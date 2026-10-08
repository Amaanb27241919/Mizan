/**
 * Pure: the AI Committee's own scorecard — how often each analyst answered,
 * why it failed when it did, and how often the panel agreed, split, opposed
 * itself, or had no view. Screen-only rows (the Sharia gate stopped the name
 * before any model was asked) are counted separately: they are not reviews.
 */
const arr = (v) => (Array.isArray(v) ? v : []);

export function committeeStats(rows, providers) {
  const perProvider = {};
  for (const p of arr(providers)) if (p?.provider) perProvider[p.provider] = { answered: 0, failed: 0, codes: [] };
  const slot = (k) => (perProvider[k] ||= { answered: 0, failed: 0, codes: [] });
  let reviewed = 0, screened = 0, agreed = 0, split = 0, opposed = 0, noView = 0;
  for (const r of arr(rows)) {
    if (!r || typeof r !== "object") continue;
    if (r.screen_only) { screened++; continue; }
    reviewed++;
    const e = r.ensemble && typeof r.ensemble === "object" ? r.ensemble : {};
    for (const m of arr(e.per_model)) if (m?.provider) slot(m.provider).answered++;
    for (const f of arr(r.failures)) {
      if (!f?.provider) continue;
      const s = slot(f.provider);
      s.failed++;
      if (f.code && !s.codes.includes(f.code)) s.codes.push(f.code);
    }
    if (!e.ok) noView++;
    else if (e.opposed) opposed++;
    else if (e.unanimous) agreed++;
    else split++;
  }
  return { reviewed, screened, agreed, split, opposed, noView, perProvider };
}
