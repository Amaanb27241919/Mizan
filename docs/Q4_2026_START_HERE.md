# MĪZAN Q4 2026 — START HERE

**For Amaan and Claude Code · 4 October 2026 · one operational guide.** Work in `/Users/amaankhan/Documents/mizan-app`. This page consolidates the earlier Manus revenue plan, focus board, project-history review, and the subsequent local Terms/Trade corrections. **Use the Claude prompt in this file, not the older prompt in the original revenue plan.** The earlier files remain supporting research, not separate work queues.

## 1. The one-sentence goal

Test **one human-delivered, fixed-scope U.S. business-Zakat Case Lab assessment** for an owner-managed business with inventory and/or receivables. Aim for **one properly scoped paid case by 31 December 2026**. A possible **$250 pilot fee is an unvalidated hypothesis**, not a price to publish. One collected case is revenue in that month, **not $100/month recurring revenue or MRR**.

**Three tracks, kept separate:** the existing consumer Mīzan app stays free; Case Lab is a *proposed service*, not shipped software; Trade Lab is trading/research R&D, **not the Q4 product to sell**. Do not describe Trade as universally owner-only or read-only: a permission-granted non-root beta user can access trading, SnapTrade can route real orders, and Alpaca is paper-only. The current code and the latest audit have the precise gates.

## 2. Exactly what to open—and what to ignore for now

| Priority | File | Use it for |
|---|---|---|
| **1: this page** | `docs/Q4_2026_START_HERE.md` | Current business goal, next steps, copy-paste Claude prompt, weekly scorecard. |
| **2: Claude's rules** | `CLAUDE.md` | Read its **CURRENT HANDOFF** at the top, then relevant sections. The historical bounded-push text is not a fresh feature-build instruction. |
| **3: current app state** | `MIZAN-STATE-AUDIT.md` | Read the newest 4 October entry first. Preserve the founder's pre-existing audit-date edit and every other uncommitted change. Older dated entries may be superseded. |
| **4: boundaries** | `docs/COMPLIANCE.md` | Advice-output boundary, actual trading-route distinction, and gates for sensitive Case Lab work. Not legal or religious clearance. |
| **5: only if checking product claims** | `src/components/Terms.jsx`, `src/components/MizanApp.jsx`, `lib/handlers.mjs` | Verify local Terms and Trade code against the live public site. The two Terms PDFs (`legal/` and `public/legal/`) are derived from the JSX. **Local revisions have not been published or legally approved.** |

**Do not paste these five files into Claude's chat.** Claude Code can read them directly in the Mac checkout. Start with the prompt in §5 below. Do not ask Claude to read every archived proposal before its first small task.

**Research shelf, not active tickets:** the original Manus *Mīzan Q4 2026 revenue plan* explains the rationale, the *Q4 focus board* has sample outreach messages, and the *project context review* indexes four shared conversations and eight Project files. Their recommendations and old code observations are historical. The three Trade Lab proposal Markdown files and five screenshots in the Manus Project are concepts/evidence, not proof of current production behavior. Prior chat histories: [domain and competition](https://manus.im/share/cbwN6VPHUDuU5r223fK3jP), [independent adjudication](https://manus.im/share/8PxPTlPBRKjOPqj0NUbKPB), [capability audit](https://manus.im/share/lEUQDjdZMQS1yU8ZheBYyO), [HalalAI comparison](https://manus.im/share/hqSegqGbwbvky9bF56saU2). **None is required reading for this week's outreach.**

## 3. What has already happened; what has not

**Done locally on 4 October:** inspected the current Mac checkout and the [public landing site](https://www.mizan.exchange/); revised `CLAUDE.md`, the audit, `docs/COMPLIANCE.md`, Terms JSX, Trade disclosure/comments, and related regression tests; regenerated only the two Terms PDFs. **1,077 unit tests passed, the build passed**, and both PDF copies matched. This is an **uncommitted local working tree**, not a release. Claude should inspect `git status --short` and **never reset, stash, overwrite, or redeploy it without an explicit request**.

**Not done or not verified here:** publication of changed Terms, legal review, U.S. signup smoke test, production broker/DB state, a named contracted scholar, buyer interviews, paid cases, pricing validation, merchant setup, a secure client-document workflow, or Case Lab software. The [currently published Terms](https://app.mizan.exchange/terms) may therefore still differ from local JSX. **Review and decide publication separately; do not deploy this draft automatically.**

**Do not conflate the two legal issues:** correcting an existing app's inaccurate read-only claim does *not* create Case Lab service terms. Selling an assessment will require its own scoped agreement, document/retention terms, reviewer arrangement, and appropriate review.

## 4. Founder actions, in order—not four parallel projects

1. **Monday 5 October — 25 minutes:** send **one** inquiry to a qualified scholar/reviewer. Ask if they would independently review a single dated owner-managed-business Zakat workpaper; request scope, fee, turnaround, confidentiality, permitted wording, and responsibility for unresolved questions. Do **not** say the service is already scholar-reviewed. A “no” is a useful answer.
2. **This week — three outreach attempts:** message three owner-managers or accountants for 15-minute discovery conversations. Ask what is difficult about inventory/receivables, how they handle it now, what written result would be useful, and whether they have paid for help. **Do not request financial statements or account access.**
3. **Separate trust decision:** review the local Terms/Trade correction against the [public landing page](https://www.mizan.exchange/) and [published Terms](https://app.mizan.exchange/terms); obtain appropriate review and decide if/when to publish. This is **not** a reason to expand trading access or build Case Lab.
4. **By 18 October:** if no qualified willing reviewer with a defined scope, stop using “scholar-reviewed.” Continue discovery or make an explicit pivot; never substitute an AI model for sign-off.
5. **By 1 November:** aim for ten cumulative qualified conversations and two written, properly scoped *proposals*, after reviewer cost/scope are understood. A compliment or signup is not a proposal or sale. Only consider a minimal lead page if conversations show it is needed.
6. **By 15 November:** seek one genuine paid commitment. Before accepting records or fees, settle method, independent sign-off, minimum-necessary secure transfer, deletion, default-**no-reuse** rights, direct costs, separate service terms, payment and refund process. No commitment despite the planned asks? **Pause coding and change the offer, customer, channel, or fee.**
7. **By 31 December:** report **cash collected in December**, completed cases, direct costs, referrals, and lessons. Report actual MRR separately (likely $0 unless a real recurring product and customers exist). Do not count paper-trading returns, promises, or unpaid work.

**Today's fallback if frozen:** send the reviewer inquiry. Stop after 25 minutes. Tomorrow, send one buyer inquiry. No catch-up marathon.

## 5. Paste this exact prompt into Claude Code now

From Mac Terminal, in the app directory:

```bash
cd ~/Documents/mizan-app
claude
```

Then paste the following **single task**:

> Read `docs/Q4_2026_START_HERE.md`, the CURRENT HANDOFF at the top of `CLAUDE.md`, the newest entry of `MIZAN-STATE-AUDIT.md`, and `docs/COMPLIANCE.md`. Inspect `git status --short` and the current Terms/Trade route source. Preserve every existing edit, especially the founder's audit-date change. This is **read-only planning**: do not edit files, commit, push, deploy, change trading/auth/cron/schema, build checkout, or collect client documents. The local Terms/Trade correction and Terms PDFs have already been made but are **not published or legally reviewed**; verify their status, do not redo them. Our only Q4 revenue experiment is one human-delivered, fixed-scope U.S. business-Zakat assessment. Consumer Mīzan remains free; Trade Lab is not this offer. **In your response**, deliver (1) a blank one-page case workpaper outline containing entity, as-of date, source/provenance, methodology, inventory, receivables, liabilities, assumptions, calculation, preparer, independent reviewer, limitations, revision history and default-no-reuse rights—no client data; (2) a minimal lead-page outline **only if** reviewer scope and a buyer conversation justify it, otherwise say “not yet”; and (3) a concise factual note separating local Terms, published Terms, trading capabilities, and the decisions/review needed before publishing. End with **one smallest proposed next ticket**, the three founder decisions you still need, and “No repository files changed.” Stop and wait for explicit authorization before implementation.

**If Claude suggests building a platform, subscription, bot, paywall, or five competing tickets:** reply, “Park that. Show me the next single evidence-producing action for this week's Case Lab experiment.” Claude is the **one implementation owner**; Amaan decides which ticket, if any, starts.

## 6. Friday 15-minute scoreboard (copy these six lines)

- Reviewer: **not yet / yes / no**; exact scope, fee and permissible claim: ________.
- Qualified buyer conversations or attempts this week: **0 / 3**; cumulative toward ten: ________.
- Written scoped proposals: ________; paid commitments: ________.
- **Cash collected:** $________; **direct cost:** $________; **recurring MRR:** $________ (separate).
- Most repeated buyer problem: ________; one unresolved permission/method question: ________.
- **Next week's three outcomes:** 1. ________  2. ________  3. ________. **Next physical action:** ________.

**Working rule:** one 25-minute founder outreach block before code each weekday; **one open Claude ticket**; three weekly outcomes; park all other ideas. “Not now” includes a consumer paywall, AI-trading subscription, live Trade expansion, accounting integration, broad redesign, and unverified purification factors. If evidence changes the bet, decide that explicitly rather than adding a fourth project.
