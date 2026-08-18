import LegalLayout from "./LegalLayout.jsx";
import { legalUpdatedLabel } from "../lib/legal.js";

/**
 * Data Retention and Disposal Policy — converted from PDF 2026-08-18.
 *
 * The PDF version was materially wrong: it listed a `sessions` table that does
 * not exist, claimed Plaid transactions had "zero retention" while
 * plaid_transactions holds thousands of rows, and omitted fourteen tables that
 * do exist. The schedule below was rebuilt against the live schema.
 */
export default function DataRetention() {
  return (
    <LegalLayout title="Data Retention and Disposal Policy" updated={legalUpdatedLabel()}>
      <p className="mz-lead">
        This policy defines how long MĪZAN retains consumer data, when and how
        that data is deleted, and how compliance with applicable data-protection
        laws (GDPR, CCPA, and equivalents) is maintained. It applies to all
        consumer data obtained via Plaid, SnapTrade, and related providers, and
        to the operator's own administrative records.
      </p>

      <h2>1. Purpose</h2>
      <p>
        To minimize data exposure by retaining consumer financial data only for
        as long as required to deliver the service, to enable consumers to
        exercise their right of erasure, and to ensure that retained data is
        disposed of securely when no longer needed.
      </p>

      <h2>2. Scope</h2>
      <ul>
        <li>All consumer data stored in the Supabase project, including
            authentication records, profile data, Plaid tokens, account metadata
            and transactions, SnapTrade user records, budgets, goals, audit logs,
            and net-worth history.</li>
        <li>Operational records that contain consumer identifiers (Sentry error
            events, Vercel logs, Resend email logs).</li>
        <li>Backups maintained by infrastructure vendors (Supabase, Vercel).</li>
      </ul>

      <h2>3. Data Categories and Retention Periods</h2>
      <p>
        The schedule below reflects the live database schema. Where a row says
        "until account deletion", the data is removed automatically by cascading
        foreign keys when the account is deleted (see §4.2).
      </p>
      <div className="mz-table-wrap">
        <table>
          <thead>
            <tr><th>Category</th><th>Storage</th><th>Retention</th></tr>
          </thead>
          <tbody>
            <tr><td>Authentication credentials (hashed password, MFA factors)</td><td>Supabase Auth (<code>auth.users</code>)</td><td>Until account deletion</td></tr>
            <tr><td>User profile (email, name, preferences)</td><td><code>profiles</code></td><td>Until account deletion</td></tr>
            <tr><td>Plaid access tokens</td><td><code>plaid_tokens</code></td><td>Until institution disconnect or account deletion; revoked at Plaid via <code>/item/remove</code></td></tr>
            <tr><td>Plaid account metadata (institution, mask, balances)</td><td><code>plaid_accounts</code> (RLS-protected)</td><td>Until institution disconnect or account deletion</td></tr>
            <tr><td><strong>Plaid transactions</strong></td><td><code>plaid_transactions</code> (RLS-protected)</td><td><strong>Stored.</strong> Until institution disconnect or account deletion. Synced incrementally so budgets and spending history persist.</td></tr>
            <tr><td>SnapTrade user-id / user-secret pair</td><td><code>user_snaptrade</code> (encrypted at rest)</td><td>Until account deletion</td></tr>
            <tr><td>SnapTrade holdings / activities</td><td>Not stored — live pass-through</td><td>Zero retention</td></tr>
            <tr><td>Budgets (amounts assigned, rollover flags, monthly income)</td><td><code>budget_entries</code>, <code>budget_months</code></td><td>Until account deletion</td></tr>
            <tr><td>Savings goals and debts</td><td><code>goals</code>, <code>user_state</code></td><td>Until account deletion</td></tr>
            <tr><td>Net-worth history snapshots</td><td><code>user_state</code></td><td>Until account deletion</td></tr>
            <tr><td>Account nicknames</td><td><code>account_nicknames</code></td><td>Until account deletion</td></tr>
            <tr><td>Support messages</td><td><code>messages</code></td><td>Until account deletion</td></tr>
            <tr><td>Product usage counters (per-section view counts)</td><td><code>nav_usage</code></td><td>Until account deletion. Counters only — no timeline, no financial data, no IP or device details.</td></tr>
            <tr><td>Trading-bot strategies and pending signals (beta feature)</td><td><code>bot_strategies</code>, <code>pending_signals</code>, <code>account_full_auto</code></td><td>Until account deletion</td></tr>
            <tr><td>Audit log entries</td><td><code>audit_log</code></td><td>Minimum 12 months; reviewed during policy review</td></tr>
            <tr><td>Security events (IP blocks, failure tracking)</td><td><code>security_events</code></td><td>Rolling; purged by the daily cleanup job</td></tr>
            <tr><td>Web push subscriptions</td><td><code>push_subscriptions</code></td><td>Until the user unsubscribes or the account is deleted</td></tr>
            <tr><td>Cached market data</td><td><code>polygon_cache</code>, <code>etf_holdings_cache</code>, <code>purification_ratios</code></td><td>Rolling cache, evicted by TTL; contains no consumer identifiers</td></tr>
            <tr><td>Rate limit counters</td><td><code>rate_limits</code></td><td>Rolling buckets; oldest rows evicted automatically</td></tr>
            <tr><td>Scheduled job heartbeats</td><td><code>cron_jobs</code></td><td>Operational only; no consumer identifiers</td></tr>
            <tr><td>Runtime error events</td><td>Sentry (PII scrubbed)</td><td>30–90 days per Sentry's retention tier</td></tr>
            <tr><td>Function logs</td><td>Vercel</td><td>Per Vercel's plan-level retention</td></tr>
            <tr><td>AI Assistant messages</td><td>Not stored by MĪZAN</td><td>Zero retention on our side; subject to Anthropic's own policy in transit</td></tr>
          </tbody>
        </table>
      </div>

      <h2>4. Deletion Triggers and Mechanisms</h2>
      <h3>4.1 User-initiated institution disconnect</h3>
      <ol>
        <li>Calls Plaid's <code>/item/remove</code> endpoint, revoking the access
            token on Plaid's side.</li>
        <li>Deletes the corresponding row from <code>plaid_tokens</code>.</li>
        <li>Deletes all rows from <code>plaid_accounts</code> and{" "}
            <code>plaid_transactions</code> for that institution.</li>
        <li>Writes a <code>bank.disconnect</code> entry to <code>audit_log</code>.</li>
      </ol>

      <h3>4.2 User-initiated account deletion</h3>
      <ol>
        <li>All rows referencing the user's <code>user_id</code> are
            cascade-deleted via Postgres <code>ON DELETE CASCADE</code>
            foreign-key constraints. Every table listed in §3 that is scoped to a
            user is covered.</li>
        <li>Plaid <code>/item/remove</code> is called for each linked institution
            to revoke access tokens upstream.</li>
        <li>SnapTrade <code>/snapTrade/deleteUser</code> is called to remove the
            user's record on SnapTrade.</li>
        <li>The Supabase Auth record is deleted via the admin API.</li>
      </ol>

      <h3>4.3 Data-subject erasure requests</h3>
      <p>
        Erasure requests under GDPR, CCPA, or equivalent statutes are honored
        within 30 days of receipt. Requests are routed to{" "}
        <a href="mailto:khanstyle02@gmail.com">khanstyle02@gmail.com</a> (also
        published in the <a href="/privacy">Privacy Policy</a>). The operator
        verifies the request originates from the account holder, then triggers
        the same account-deletion flow described in §4.2 and confirms completion
        in writing.
      </p>

      <h3>4.4 Automatic eviction</h3>
      <ul>
        <li>Cache tables are evicted by a TTL field and rebuilt on demand.</li>
        <li><code>rate_limits</code> buckets are overwritten in place; older
            buckets are evicted by the daily cleanup job.</li>
        <li>The daily cleanup job also purges aged <code>audit_log</code> and{" "}
            <code>security_events</code> rows beyond their retention window.</li>
      </ul>

      <h2>5. Disposal Standards</h2>
      <ul>
        <li>Database deletions execute as standard SQL <code>DELETE</code> against
            Supabase Postgres, which marks rows for vacuuming by the underlying
            engine. Vacuum overwrites the row's storage location with new data on
            subsequent writes; no row content is preserved.</li>
        <li>Supabase maintains point-in-time-recovery backups for a rolling
            window. On account deletion, residual copies of consumer data in
            these backups age out within that window. No restore-from-backup is
            performed against a deleted account.</li>
        <li>Plaid access tokens are revoked at Plaid via <code>/item/remove</code>{" "}
            before local deletion, so even a stale token cannot be used
            post-deletion.</li>
        <li>Audit log entries are purged when their owning user account is
            deleted (cascade), or, where retained for compliance, after the
            12-month minimum has elapsed and no active investigation references
            them.</li>
      </ul>

      <h2>6. Vendor Data Handling</h2>
      <p>
        The following processors retain copies of consumer data under their own
        retention policies, summarized here for transparency:
      </p>
      <ul>
        <li><strong>Supabase</strong> — primary store; subject to the deletion
            mechanisms above. Backups age out per Supabase's backup window.</li>
        <li><strong>Plaid</strong> — retains access tokens until{" "}
            <code>/item/remove</code> is called, then per Plaid's End User Data
            Protection schedule.</li>
        <li><strong>SnapTrade</strong> — retains the SnapTrade user record until{" "}
            <code>/snapTrade/deleteUser</code> is called.</li>
        <li><strong>Anthropic</strong> — receives portfolio context only when the
            user sends a message to the AI Assistant; retention per Anthropic's
            own policy. MĪZAN stores no Assistant conversation history.</li>
        <li><strong>Sentry</strong> — retains scrubbed error events per Sentry's
            plan-level retention (30–90 days typical); no consumer financial data
            is sent.</li>
        <li><strong>Vercel</strong> — retains function logs per its plan-level
            retention; logs do not include consumer financial data.</li>
        <li><strong>Resend</strong> — retains transactional email metadata for
            delivery troubleshooting per Resend's policy.</li>
      </ul>

      <h2>7. Legal Hold</h2>
      <p>
        If the operator receives a lawful preservation order, subpoena, or
        written notice of pending litigation referencing specific consumer data,
        the affected records are excluded from the routine deletion processes
        above until the legal hold is lifted. Holds are documented as{" "}
        <code>legal.hold</code> entries in <code>audit_log</code> with the date,
        the requesting authority, and the scope of the preserved data. No legal
        holds are active at the publication date of this policy.
      </p>

      <h2>8. Compliance and Review</h2>
      <p>
        This policy is designed to meet the obligations of the GDPR (right to
        erasure, storage limitation), the CCPA/CPRA (right to delete, data
        minimization), and equivalent state and national statutes. It is reviewed
        <strong> quarterly</strong>, and whenever a schema or vendor change
        alters what is stored. The review is triggered automatically from this
        document's own review date rather than relying on memory.
      </p>

      <h2>9. Contact</h2>
      <p>
        Retention or deletion questions:{" "}
        <a href="mailto:khanstyle02@gmail.com">khanstyle02@gmail.com</a>.
      </p>
    </LegalLayout>
  );
}
