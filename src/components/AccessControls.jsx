import LegalLayout from "./LegalLayout.jsx";
import { legalUpdatedLabel } from "../lib/legal.js";

/**
 * Access Controls Policy — converted from PDF 2026-08-18.
 * Review cadence moved from annual to quarterly to match the other policies,
 * and the vendor/table inventories were refreshed against the live system.
 */
export default function AccessControls() {
  return (
    <LegalLayout title="Access Controls Policy" updated={legalUpdatedLabel()}>
      <p className="mz-lead">
        This policy defines the access controls MĪZAN uses to limit access to
        production assets and consumer financial data. It applies to all systems
        that store, process, or transmit data obtained via Plaid, SnapTrade, or
        related providers, and to all personnel with administrative access to
        those systems.
      </p>

      <h2>1. Purpose</h2>
      <p>
        To ensure that access to production systems and consumer data is
        restricted to authorized personnel, granted on the principle of least
        privilege, monitored continuously, and reviewed periodically. This policy
        supports compliance with Plaid's End User Data Protection requirements
        and applicable data-protection laws (GDPR, CCPA).
      </p>

      <h2>2. Scope</h2>
      <ul>
        <li>All production hosting and data-platform accounts (Vercel, Supabase,
            GitHub, Plaid Dashboard, SnapTrade Dashboard, Anthropic Console,
            Sentry, Resend).</li>
        <li>All consumer-data tables in the Supabase project — including{" "}
            <code>plaid_tokens</code>, <code>plaid_accounts</code>,{" "}
            <code>plaid_transactions</code>, <code>user_snaptrade</code>,{" "}
            <code>user_state</code>, <code>budget_entries</code>,{" "}
            <code>goals</code>, <code>messages</code>, <code>nav_usage</code>,
            and <code>audit_log</code>.</li>
        <li>All secrets and credentials used to authenticate to third-party APIs
            (Plaid client ID/secret, Supabase service-role key, SnapTrade
            consumer key, Anthropic API key, market-data provider keys,
            transactional email keys, at-rest encryption key).</li>
        <li>All personnel with administrative responsibilities. MĪZAN currently
            has one operator (Amaan Khan), so "personnel" refers to that single
            principal. The policy is written to scale as additional personnel are
            added.</li>
      </ul>

      <h2>3. Roles and Responsibilities</h2>
      <div className="mz-table-wrap">
        <table>
          <thead>
            <tr><th>Role</th><th>Responsibility</th><th>Current holder</th></tr>
          </thead>
          <tbody>
            <tr><td>Policy Owner</td><td>Maintains, reviews, and approves this policy.</td><td>Amaan Khan</td></tr>
            <tr><td>Access Approver</td><td>Reviews and approves new administrative access requests.</td><td>Amaan Khan</td></tr>
            <tr><td>Access Reviewer</td><td>Performs periodic access reviews and audits.</td><td>Amaan Khan</td></tr>
            <tr><td>Incident Responder</td><td>Investigates suspected access compromise.</td><td>Amaan Khan</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        Until separation of duties is operationally feasible, the operator holds
        all roles. Approval of one's own access is documented in writing in the
        audit record (operator email plus timestamp).
      </p>

      <h2>4. Access Provisioning</h2>
      <h3>4.1 Administrative access</h3>
      <ul>
        <li>New administrative access requires written justification, approval by
            the Access Approver, and enrollment of multi-factor authentication
            before activation.</li>
        <li>Administrative accounts use unique credentials per provider. Shared
            logins are prohibited.</li>
        <li>Service-role credentials are stored only in Vercel encrypted
            environment variables, scoped per environment, and never committed to
            source control or shared by email or chat.</li>
      </ul>

      <h3>4.2 Consumer access</h3>
      <ul>
        <li>End users authenticate to MĪZAN via Supabase Auth (email + password)
            and receive a Supabase-issued JWT for the session.</li>
        <li>End users may enroll a TOTP-based multi-factor factor through the
            in-app account settings.</li>
        <li>Every authenticated request that touches consumer financial data
            validates the JWT server-side. Anonymous or invalid-JWT requests are
            refused before any data access occurs.</li>
      </ul>

      <h2>5. Role-Based Access Control (RBAC)</h2>
      <p>
        MĪZAN enforces RBAC at the database layer via Supabase Postgres
        Row-Level Security (RLS):
      </p>
      <ul>
        <li>Every table containing consumer data has RLS enabled, with policies
            restricting <code>SELECT</code>, <code>INSERT</code>,{" "}
            <code>UPDATE</code>, and <code>DELETE</code> to rows where{" "}
            <code>auth.uid() = user_id</code>.</li>
        <li>The public-facing application uses the Supabase anonymous
            (<code>anon</code>) key, which is subject to RLS.</li>
        <li>Server-side operations that must bypass RLS (token storage,
            cross-user maintenance) use the <code>service-role</code> key, which
            is stored in Vercel environment variables and never transmitted to
            the browser under any code path.</li>
        <li>Where a table must be written but never client-authored — such as the
            product usage counters — writes go through a{" "}
            <code>SECURITY DEFINER</code> function with no client write policy at
            all, so a caller cannot set an arbitrary value or attribute a write
            to another user.</li>
        <li>The operator's elevated role inside the application is gated by a{" "}
            <code>profiles.is_root</code> column, set only via direct SQL by the
            policy owner. Root status grants additional UI but does not bypass
            RLS-enforced ownership of consumer data.</li>
      </ul>

      <h2>6. Authentication Strength</h2>
      <ul>
        <li>Multi-factor authentication is <strong>required</strong> on every
            administrative account.</li>
        <li>Passwords satisfy each provider's minimum complexity requirements.
            Operator passwords are stored in a reputable password manager and
            never reused across providers.</li>
        <li>Multi-factor authentication is offered to all end users via Supabase
            TOTP. Enrollment is voluntary today; enforcement before sensitive
            operations is on the policy roadmap.</li>
        <li>JWT sessions issued by Supabase Auth are short-lived and refreshed
            via the standard Supabase refresh-token flow.</li>
        <li>Repeated authentication failures from a single address trigger a
            temporary block, recorded in <code>security_events</code>.</li>
      </ul>

      <h2>7. Access Modification and De-Provisioning</h2>
      <ul>
        <li>If a role changes or a principal departs, the Access Approver revokes
            administrative credentials for that principal within 24 hours:
            provider-side account deactivation, password rotation for any shared
            service accounts (none today), and rotation of Vercel environment
            variables touched by the departing principal.</li>
        <li>End users may revoke a specific session from the in-app Sessions
            panel or trigger a full sign-out, both of which invalidate the
            corresponding Supabase session(s).</li>
        <li>Account deletion by an end user is destructive: all rows referencing
            their <code>user_id</code> are removed via{" "}
            <code>ON DELETE CASCADE</code>, and Plaid access tokens are revoked
            via Plaid's <code>/item/remove</code> endpoint before deletion.</li>
      </ul>

      <h2>8. Periodic Access Reviews</h2>
      <ul>
        <li>The Access Reviewer audits the list of accounts with administrative
            access at least <strong>quarterly</strong>, or whenever a material
            change in personnel or vendors occurs — whichever is sooner. The
            review is prompted automatically from this document's own review
            date rather than relying on memory.</li>
        <li>The review includes: confirmation that MFA remains active on every
            admin account, verification that no orphaned credentials exist,
            confirmation that Vercel environment variables match the documented
            inventory, and a sample inspection of <code>audit_log</code> rows
            from the prior period.</li>
        <li>The review is recorded as an entry in <code>audit_log</code> with
            action <code>access.review</code> and the date of the review.</li>
      </ul>

      <h2>9. Audit Logging</h2>
      <p>
        MĪZAN writes an append-only audit record for every security-relevant
        action, including (but not limited to):
      </p>
      <ul>
        <li>Sign-in success and sign-in failure</li>
        <li>MFA enrollment, verification, and unenrollment</li>
        <li>Password reset and email change</li>
        <li>Bank or brokerage connect and disconnect</li>
        <li>Session revoke and account deletion</li>
        <li>Force-refresh and other privileged operations</li>
      </ul>
      <p>
        Audit entries include user ID, action, target, IP address, and
        user-agent. Audit data is retained for at least 12 months and is reviewed
        during incident investigations and the periodic access review.
      </p>

      <h2>10. Secret and Credential Management</h2>
      <ul>
        <li>All API secrets are stored in Vercel encrypted environment variables,
            scoped per environment (Production, Preview, Development).</li>
        <li>No secrets are stored in source control. Repository hygiene is
            enforced via <code>.gitignore</code> entries for <code>.env*</code>{" "}
            files and runtime state files.</li>
        <li>An automated daily credential preflight verifies that required
            credentials are present and functional, so a misconfiguration
            surfaces as an alert rather than as a silent outage.</li>
        <li>Suspected secret exposure triggers immediate rotation via the
            relevant provider dashboard and a security incident review.</li>
      </ul>

      <h2>11. Incident Response for Access Compromise</h2>
      <ol>
        <li>Contain: revoke compromised credentials, rotate associated secrets,
            and force sign-out where applicable.</li>
        <li>Investigate using Sentry, Vercel logs, Supabase access logs, and the{" "}
            <code>audit_log</code> table.</li>
        <li>Notify affected users without undue delay and in accordance with
            applicable law.</li>
        <li>Notify Plaid and SnapTrade where their systems or data are
            implicated.</li>
        <li>Document the incident, remediation, and lessons learned.</li>
      </ol>

      <h2>12. Contact</h2>
      <p>
        Access or credential questions:{" "}
        <a href="mailto:khanstyle02@gmail.com">khanstyle02@gmail.com</a>.
      </p>
    </LegalLayout>
  );
}
