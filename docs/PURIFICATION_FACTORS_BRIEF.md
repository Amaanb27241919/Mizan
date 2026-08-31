# Purification factors — correctness fix and Saturna integration

**Status: correctness bug. Fix the minimum before ISNA (4 Sept 2026); do the
schema work after.**

## The problem

`supabase/migrations/019_purification.sql` models purification as a single
percentage of dividend income (`impurity_pct numeric(6,4)`). That unit is right
for the SP Funds and Wahed ETFs, which publish a percentage.

It is the **wrong unit for the Amana funds.** Saturna does not publish a
percentage. It publishes an annual **dollar factor per share**, set at fiscal
year end (31 May), which the shareholder multiplies by their own share count.

Our seeded rows are therefore estimates standing in for a figure the issuer
actually publishes:

```
('AMAGX', 1.20, 'Amana Growth Fund — issuer estimate, verify at saturna.com annually'),
('AMANX', 2.40, 'Amana Income Fund — issuer estimate, verify at saturna.com annually')
```

Nobody has performed the annual verification the comment asks for. If the
purification screen is demonstrated to anyone from Saturna and our AMAGX figure
does not reconcile to their published factor times the share count, that is the
worst possible moment to discover the mismatch.

Saturna's published factors also cover share classes we do not model at all:
AMANX / AMINX, AMAGX / AMIGX, AMDWX / AMIDX. Institutional and investor classes
carry different factors.

## Before Friday — the minimum

1. Open the Saturna purification calculator and the historical page and record,
   by hand, the current fiscal-year factor for every Amana share class, with the
   as-of date. Note that Saturna's own pages did not agree in an automated read
   on 31 Aug 2026 — the tools page gave AMANX as $0.0112113 as of 31 May 2025
   while the calculator page served $0.0136213, which the historical page
   attributes to fiscal 2024. **Confirm on screen. Do not trust a scrape, and do
   not repeat the discrepancy to anyone until it is confirmed.**
2. Either correct the two seeded rows to a defensible figure, or — better, and
   more honest — make the demo's Amana rows visibly read as an estimate with the
   issuer named, so nothing on screen claims to be Saturna's official number when
   it is not.
3. Do not show a precise AMAGX purification dollar amount to anyone from Saturna
   until step 1 is done.

## The proper fix — after the conference

Support two calculation modes rather than one.

- Migration: add `method text NOT NULL DEFAULT 'pct_of_dividend'` constrained to
  `('pct_of_dividend','per_share_annual')`, plus `per_share_usd numeric(12,7)`,
  `fiscal_year_end date`, and `source_url text`. Keep `impurity_pct` for the
  percentage funds. Add a check constraint so exactly one of the two value
  columns is populated for a given method.
- Seed the Amana share classes under `per_share_annual` with the published
  factor, the 31 May fiscal year end, and `source_url` pointing at Saturna's
  calculator. Attribute the figure to Saturna in `source`, verbatim.
- Update `/api/purification/calculate` in `lib/handlers.mjs` to branch on
  `method`: percentage funds keep the existing dividend-income path;
  `per_share_annual` funds multiply the holder's share count by the factor for
  the applicable fiscal year. The response must carry the method, the as-of date,
  and the attribution so the UI can display where the number came from.
- The UI must distinguish an **issuer-published** figure from a Mīzan estimate.
  This is a trust surface: a user donating money on the strength of our number
  deserves to know whose number it is.
- Extend the annual-review cron already used for the legal pages to remind on
  1 June each year that Saturna's new factors are out.
- Tests: unit coverage for both calculation paths, a fixture per method, and a
  guard that a `per_share_annual` row cannot be read through the percentage path.

## Why this matters beyond correctness

Saturna already does the hard part — they compute the authoritative factor for
their own funds. What their shareholder still has to do by hand is look up the
right year, remember their share count, type it into a web form, and keep their
own record. Their calculator also covers only Amana funds, which is a small share
of that shareholder's total portfolio, and Saturna states plainly that
purification is distinct from zakat and offers no zakat tool.

That is the integration conversation, and it is a better opening than a demo:
*we already rely on your published factors and would rather apply them exactly as
you publish them, attributed to you, than estimate.* It asks them for nothing but
permission and accuracy, and it makes their annual work reach further than their
own calculator can.

Nothing in this file changes the compliance posture: purification arithmetic
against a disclosed, issuer-published factor is T0.
