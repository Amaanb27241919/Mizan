/**
 * Legal-document metadata, in one place so nothing can drift.
 *
 * The review date lives here rather than being typed into each page because it
 * is also what the DAILY health sweep reads (lib/anomaly.mjs → checkLegalReview,
 * surfaced in /api/cron/cleanup). A reminder derived from the document's own
 * date cannot fall out of step with the document; a reminder on a separate
 * calendar always eventually does.
 *
 * Update LEGAL_LAST_UPDATED whenever a policy changes materially. The sweep
 * emails the owner once REVIEW_INTERVAL_DAYS have passed, so letting it go
 * stale is a visible event rather than a silent one.
 */

/** ISO date of the last substantive review of the legal documents. */
export const LEGAL_LAST_UPDATED = "2026-08-18";

/** Owner decision 2026-08-18: quarterly cadence. */
export const REVIEW_INTERVAL_DAYS = 90;

/** Human-readable form used in page headers. */
export function legalUpdatedLabel(iso = LEGAL_LAST_UPDATED) {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso
    : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** Days since the last review. */
export function daysSinceLegalReview(now = new Date(), iso = LEGAL_LAST_UPDATED) {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return Infinity;   // unparseable → treat as overdue
  return Math.floor((now.getTime() - d.getTime()) / 86_400_000);
}

/** Is a review overdue? */
export function isLegalReviewDue(now = new Date(), iso = LEGAL_LAST_UPDATED) {
  return daysSinceLegalReview(now, iso) >= REVIEW_INTERVAL_DAYS;
}

/**
 * Every legal document Mizan publishes, and where it lives. Kept here so the
 * review sweep can name what needs re-reading instead of saying "the legal
 * docs" and leaving the operator to remember which those are.
 */
export const LEGAL_DOCUMENTS = [
  { id: "privacy",   title: "Privacy Policy",         href: "/privacy", web: true },
  { id: "terms",     title: "Terms of Service",       href: "/terms",   web: true },
  { id: "security",  title: "Security Policy",        href: "/legal/SECURITY_POLICY.pdf",         web: false },
  { id: "retention", title: "Data Retention Policy",  href: "/legal/DATA_RETENTION_POLICY.pdf",   web: false },
  { id: "access",    title: "Access Controls Policy", href: "/legal/ACCESS_CONTROLS_POLICY.pdf",  web: false },
];
