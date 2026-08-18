// Legal-document accuracy and review cadence.
//
// WHY: the 2026-08-18 review found the published Privacy Policy asserting that
// bank transactions were "not stored" while 2,039 rows sat in the database
// across 4 users, and omitting Anthropic from its processor list while the AI
// Assistant sent holdings and cost basis to it. Neither was deliberate — the
// policy was written in May, the features shipped after. Documents describing
// how software behaves go stale precisely because software changes, so the
// claims that can be checked mechanically are checked here.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  LEGAL_LAST_UPDATED, REVIEW_INTERVAL_DAYS, LEGAL_DOCUMENTS,
  daysSinceLegalReview, isLegalReviewDue, legalUpdatedLabel,
} from "../lib/legal.js";

// Collapse JSX line-wrapping before matching. Prose in these files is wrapped
// for readability, so a phrase can straddle a newline plus indentation — an
// assertion written against the sentence would fail on formatting alone.
const privacyRaw = fs.readFileSync(path.resolve(__dirname, "../components/Privacy.jsx"), "utf8");
const privacy = privacyRaw.replace(/\s+/g, " ");

describe("review cadence", () => {
  it("uses a quarterly interval", () => {
    expect(REVIEW_INTERVAL_DAYS).toBe(90);
  });
  it("is not due immediately after a review, and is due after the interval", () => {
    const reviewed = new Date(`${LEGAL_LAST_UPDATED}T00:00:00Z`);
    expect(isLegalReviewDue(reviewed)).toBe(false);
    const later = new Date(reviewed.getTime() + (REVIEW_INTERVAL_DAYS + 1) * 86_400_000);
    expect(isLegalReviewDue(later)).toBe(true);
    expect(daysSinceLegalReview(later)).toBe(REVIEW_INTERVAL_DAYS + 1);
  });
  it("treats an unparseable date as overdue rather than silently fine", () => {
    // Fail loud: a typo in the constant must not disable the reminder.
    expect(isLegalReviewDue(new Date(), "not-a-date")).toBe(true);
  });
  it("renders a human date for the page header", () => {
    expect(legalUpdatedLabel("2026-08-18")).toBe("August 18, 2026");
  });
  it("lists every published document so the reminder can name them", () => {
    const ids = LEGAL_DOCUMENTS.map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining(["privacy", "terms", "security", "retention", "access"]));
  });
});

describe("privacy policy states what the system actually does", () => {
  it("does NOT claim bank transactions go unstored", () => {
    // The false claim. plaid_transactions holds ~2,000 rows spanning months.
    expect(privacy).not.toMatch(/transactions are\s*<strong>\s*not stored/i);
    expect(privacy).not.toMatch(/not stored in our database/i);
  });

  it("discloses that transactions ARE stored, and for how long", () => {
    expect(privacy).toMatch(/are stored/i);
    expect(privacy).toMatch(/as long as the institution stays/i);
  });

  it("names Anthropic as a processor, because portfolio data is sent there", () => {
    // /api/advisor posts holdings and cost basis to api.anthropic.com. A
    // processor list that omits it is materially incomplete.
    //
    // Asserts the PROCESSOR-LIST ENTRY, not the word. A first version of this
    // matched /Anthropic/, which still passed when the list item was removed
    // because the name survived in the link text — a guard that cannot fail is
    // worse than none, since it reads as coverage.
    expect(privacy).toMatch(/<li><strong>Anthropic<\/strong>/);
    // ...and that it says what actually leaves the app.
    expect(privacy).toMatch(/holdings, cost basis and screening verdicts.{0,60}sent to/i);
    expect(privacy).toMatch(/anthropic\.com\/legal\/privacy/);
  });

  it("discloses the product usage counters", () => {
    // migration 028 nav_usage. Counting is defensible; not saying so is not.
    expect(privacy).toMatch(/usage counts/i);
    expect(privacy).toMatch(/counter, not an/i);       // framed honestly
    expect(privacy).toMatch(/no financial information/i);
  });

  it("contains no duplicated sentences", () => {
    // Editing prose in place is how a lead-in survives its own replacement:
    // the first PDF regeneration printed "Recent transactions (merchant,
    // amount, date, category)." twice in a row, and every other test passed
    // straight through it. Reading the rendered output caught it; this makes
    // the machine catch it next time.
    const sentences = privacy
      .replace(/<[^>]+>/g, " ")            // strip JSX/HTML tags
      .split(/(?<=\.)\s+/)
      .map((x) => x.trim())
      .filter((x) => x.length > 40);       // ignore fragments and short labels
    const seen = new Set();
    const dupes = [];
    for (const sentence of sentences) {
      const key = sentence.toLowerCase().replace(/\s+/g, " ");
      if (seen.has(key)) dupes.push(sentence.slice(0, 60));
      seen.add(key);
    }
    expect(dupes, `repeated sentences: ${dupes.join(" | ")}`).toEqual([]);
  });

  it("takes its date from the shared constant, not a hardcoded string", () => {
    // Two dates that can disagree eventually do.
    expect(privacyRaw).toMatch(/updated=\{legalUpdatedLabel\(\)\}/);
    expect(privacyRaw).not.toMatch(/updated="[A-Z]/);
  });

  it("points at the production host", () => {
    expect(privacy).toMatch(/app\.mizan\.exchange/);
    expect(privacy).not.toMatch(/mizan-puce\.vercel\.app/);
  });
});
