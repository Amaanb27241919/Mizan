/**
 * MĪZAN — BillsCalendar
 *
 * Surfaces recurring merchants (already detected upstream) as a list of
 * upcoming bills with an estimated next-due-date inferred from the median
 * gap between charges. Pairs with the /api/cron/bill-reminders server
 * cron, which fires a web-push three days before each bill's expected
 * next-due-date.
 *
 * Props
 *   recurring  — array from Finances() (merchant, monthCount, avgPerCharge,
 *                estMonthly, lastDate, ...).
 *   txns       — raw bank transactions; we re-group to capture per-charge
 *                dates so cadence/median-gap can be computed.
 *   accounts   — optional Plaid accounts list. Used for institution_name +
 *                masked digits when a merchant resolves to a single account.
 *   demoMode   — passthrough flag (purely cosmetic — does not change logic).
 *
 * Cadence labeling (median gap, days):
 *   <=10  → "weekly"
 *   11-18 → "biweekly"
 *   19-45 → "monthly"
 *   46-100→ "quarterly"
 *   >100  → "irregular"
 *
 * Accent colors mirror the existing tile system (dim red for <=3 days,
 * soft coral/gold for 4-7 days, plain otherwise). All styling is
 * self-contained so the component can be imported without prop-drilling
 * the theme tokens.
 */

import React, { useMemo } from "react";

// ── Local style tokens ─────────────────────────────────────────────────
// These mirror the CSS variables defined in MizanApp.jsx's THEME_CSS so
// the tile blends in regardless of light/dark theme. No exports — kept
// scoped to this file.
const FP = "'IBM Plex Sans',system-ui,-apple-system,BlinkMacSystemFont,sans-serif";
const FM = "'IBM Plex Mono','JetBrains Mono','Menlo','Monaco',monospace";
const FU = FP;
const COL = {
  card:    "var(--mz-card)",
  border:  "var(--mz-border)",
  text:    "var(--mz-text)",
  textHi:  "var(--mz-textHi)",
  muted:   "var(--mz-muted)",
  red:     "#b23a3d",   // rust
  gold:    "#b8842a",   // amber
  blue:    "#1e4e8c",   // gold — primary accent
  rLg:     "var(--r-lg)",
  rMd:     "var(--r-md)",
  s2:      "var(--s-2)",
  s3:      "var(--s-3)",
  s4:      "var(--s-4)",
  s5:      "var(--s-5)",
};

const fmtUSD = v => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const fmtDateShort = iso => {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
};

// Pure helpers exported for tests.

/**
 * Median value of a numeric array. Returns NaN on empty input.
 */
export function median(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return NaN;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Label the cadence implied by the median gap (days) between charges.
 */
export function labelCadence(medianGapDays) {
  if (!Number.isFinite(medianGapDays)) return "irregular";
  if (medianGapDays <= 10)   return "weekly";
  if (medianGapDays <= 18)   return "biweekly";
  if (medianGapDays <= 45)   return "monthly";
  if (medianGapDays <= 100)  return "quarterly";
  return "irregular";
}

/**
 * From a list of YYYY-MM-DD strings, return { sortedAsc, gapsDays, medianGap }.
 */
export function gapStats(isoDates) {
  const sorted = [...(isoDates || [])].filter(Boolean).sort();
  const gaps = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const a = new Date(`${sorted[i - 1]}T00:00:00Z`).getTime();
    const b = new Date(`${sorted[i]}T00:00:00Z`).getTime();
    const days = Math.round((b - a) / 86_400_000);
    if (days > 0) gaps.push(days);
  }
  return { sortedAsc: sorted, gapsDays: gaps, medianGap: median(gaps) };
}

/**
 * Walk bank transactions, group by merchant key (merchant_name||name) and
 * compute per-merchant cadence + expected next due date. Uses the same
 * inclusion rule as Finances' recurring memo: merchant must hit at least
 * two distinct months. Only outflows (amount > 0 in Plaid convention).
 *
 * Returns an array sorted by ascending expectedNextDate (soonest first).
 */
export function buildBills(txns, accounts, todayIso) {
  const today = todayIso || new Date().toISOString().slice(0, 10);
  const todayMs = new Date(`${today}T00:00:00Z`).getTime();
  if (!Array.isArray(txns)) return [];

  // Group raw transactions by merchant key.
  const byMerchant = new Map();
  for (const t of txns) {
    const key = (t.merchant_name || t.name || "").trim();
    if (!key) continue;
    if (typeof t.amount !== "number" || t.amount <= 0) continue;
    const month = (t.date || "").slice(0, 7);
    if (!month) continue;
    let entry = byMerchant.get(key);
    if (!entry) {
      entry = { merchant: key, dates: [], amounts: [], months: new Set(), accountIds: new Set() };
      byMerchant.set(key, entry);
    }
    entry.dates.push(t.date);
    entry.amounts.push(t.amount);
    entry.months.add(month);
    if (t.account_id) entry.accountIds.add(t.account_id);
  }

  const acctById = new Map();
  for (const a of (accounts || [])) {
    if (a && a.account_id) acctById.set(a.account_id, a);
  }

  const bills = [];
  for (const entry of byMerchant.values()) {
    if (entry.months.size < 2) continue; // mirrors the existing recurring rule

    const { sortedAsc, medianGap } = gapStats(entry.dates);
    const lastDate = sortedAsc[sortedAsc.length - 1];
    const cadence  = labelCadence(medianGap);

    // Expected next due date = last + median gap. Fall back to last + 30
    // days when we don't yet have two distinct charge dates to draw a gap
    // from (rare — requires 2+ months but a single charge per month is
    // possible).
    const gapForProjection = Number.isFinite(medianGap) ? medianGap : 30;
    const lastMs = new Date(`${lastDate}T00:00:00Z`).getTime();
    let nextMs = lastMs + gapForProjection * 86_400_000;
    // If the projected date is in the past, roll it forward until it sits
    // on or after today — picking the next anticipated charge, not a
    // missed one.
    while (nextMs < todayMs) nextMs += gapForProjection * 86_400_000;
    const expectedNextDate = new Date(nextMs).toISOString().slice(0, 10);
    const daysUntil = Math.round((nextMs - todayMs) / 86_400_000);

    const avgPerCharge = entry.amounts.reduce((s, n) => s + n, 0) / entry.amounts.length;

    // If every charge came from the same account, surface its label.
    let accountLabel = null;
    if (entry.accountIds.size === 1) {
      const onlyId = [...entry.accountIds][0];
      const a = acctById.get(onlyId);
      if (a) {
        const inst = a.institution_name || "Bank";
        accountLabel = a.mask ? `${inst} ····${a.mask}` : inst;
      }
    } else if (entry.accountIds.size > 1) {
      accountLabel = `${entry.accountIds.size} accounts`;
    }

    bills.push({
      merchant: entry.merchant,
      cadence,
      medianGap,
      lastDate,
      expectedNextDate,
      daysUntil,
      estAmount: avgPerCharge,
      account: accountLabel,
    });
  }

  return bills.sort((a, b) => a.expectedNextDate.localeCompare(b.expectedNextDate));
}

/** Accent colour: red <=3 days, gold 4-7 days, default otherwise. */
function accentFor(daysUntil) {
  if (!Number.isFinite(daysUntil)) return null;
  if (daysUntil <= 3) return COL.red;
  if (daysUntil <= 7) return COL.gold;
  return null;
}

export default function BillsCalendar({ recurring, txns, accounts, demoMode }) {
  const bills = useMemo(() => buildBills(txns, accounts), [txns, accounts]);

  // The header tile statistic prefers the upstream `recurring` summary
  // (already trustworthy and pre-filtered to 2+ months) over recomputing
  // it from txns. Falls back gracefully when only one is present.
  const countForHeader = Array.isArray(recurring) && recurring.length > 0
    ? recurring.length
    : bills.length;
  const estMonthlyTotal = Array.isArray(recurring) && recurring.length > 0
    ? recurring.reduce((s, r) => s + (Number(r.estMonthly) || 0), 0)
    : bills.reduce((s, b) => {
        // Approximate a monthly figure from cadence when we only have bills.
        const perMonth = b.cadence === "weekly"   ? b.estAmount * 4
                       : b.cadence === "biweekly" ? b.estAmount * 2
                       : b.cadence === "monthly"  ? b.estAmount
                       : b.cadence === "quarterly"? b.estAmount / 3
                       : b.estAmount;
        return s + perMonth;
      }, 0);

  if (countForHeader === 0) return null;

  return (
    <div
      data-testid="bills-calendar"
      style={{
        background: COL.card,
        border: `1px solid ${COL.gold}40`,
        borderRadius: COL.rLg,
        padding: `${COL.s5} ${COL.s5}`,
        boxShadow: "var(--sh-md)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div style={{
        fontFamily: FM, fontSize: 10, color: COL.gold,
        letterSpacing: "0.16em", fontWeight: 600, marginBottom: COL.s3,
      }}>
        UPCOMING BILLS · {countForHeader} recurring detected · ~{fmtUSD(estMonthlyTotal)}/month estimated
        {demoMode ? " · DEMO" : ""}
      </div>

      {bills.length === 0 ? (
        <div style={{ fontFamily: FM, fontSize: 12, color: COL.muted, padding: `${COL.s3} 0` }}>
          No bill dates yet — need at least two charges from the same merchant to project a next-due date.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: COL.s2 }}>
          {bills.map(b => {
            const accent = accentFor(b.daysUntil);
            return (
              <div
                key={b.merchant}
                data-merchant={b.merchant}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1.6fr) 0.8fr 1fr 0.8fr 1.1fr",
                  gap: COL.s3,
                  alignItems: "center",
                  padding: `${COL.s3} ${COL.s4}`,
                  borderRadius: COL.rMd,
                  border: `1px solid ${accent ? `${accent}55` : COL.border}`,
                  background: accent ? `${accent}10` : "transparent",
                }}
              >
                <span style={{
                  fontFamily: FU, fontSize: 13, fontWeight: 600, color: COL.textHi,
                  letterSpacing: "-0.005em",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {b.merchant}
                </span>
                <span style={{ fontFamily: FM, fontSize: 11, color: COL.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  {b.cadence}
                </span>
                <span style={{
                  fontFamily: FM, fontSize: 11,
                  color: accent || COL.text,
                  fontVariantNumeric: "tabular-nums",
                }}>
                  {fmtDateShort(b.expectedNextDate)}
                  {Number.isFinite(b.daysUntil) && (
                    <span style={{ marginLeft: 6, color: accent || COL.muted }}>
                      ({b.daysUntil === 0 ? "today" : b.daysUntil === 1 ? "tomorrow" : `in ${b.daysUntil}d`})
                    </span>
                  )}
                </span>
                <span style={{
                  fontFamily: FU, fontSize: 13, fontWeight: 600,
                  color: COL.textHi, textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                }}>
                  {fmtUSD(b.estAmount)}
                </span>
                <span style={{
                  fontFamily: FM, fontSize: 11, color: COL.muted, textAlign: "right",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {b.account || "—"}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
