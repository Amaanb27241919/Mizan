/**
 * Pure: the AI Committee's own scorecard — how often each analyst answered,
 * why it failed when it did, and how often the panel agreed, split, opposed
 * itself, or had no view. Screen-only rows (the Sharia gate stopped the name
 * before any model was asked) are counted separately: they are not reviews.
 */
const arr = (v) => (Array.isArray(v) ? v : []);

/**
 * A failure's code, corrected for rows recorded before 2026-10-09: an empty
 * provider account was stored as "http_400" with the provider's message in
 * `detail`. Read from the message so old rows say "out of credits" too.
 */
export function failureCode(f) {
  const c = f && typeof f === "object" ? String(f.code || "") : "";
  const d = f && typeof f === "object" ? String(f.detail || "") : "";
  if (c === "http_402" || c === "skipped_no_credits" || /credit balance is too low|purchase credits|insufficient (credits|balance|funds)/i.test(d)) return "no_credits";
  if (c === "skipped_repeated_timeouts") return "timed out";
  return c;
}

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
      const fc = failureCode(f);
      if (fc && !s.codes.includes(fc)) s.codes.push(fc);
    }
    if (!e.ok) noView++;
    else if (e.opposed) opposed++;
    else if (e.unanimous) agreed++;
    else split++;
  }
  return { reviewed, screened, agreed, split, opposed, noView, perProvider };
}
