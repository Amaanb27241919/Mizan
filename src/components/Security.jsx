import LegalLayout from "./LegalLayout.jsx";
import { legalUpdatedLabel } from "../lib/legal.js";

/**
 * Security Policy — converted from PDF to a web page 2026-08-18.
 *
 * The PDF was the only copy and had gone stale: it pointed at
 * mizan-puce.vercel.app, claimed Plaid transactions were "not persisted"
 * (2,039 rows say otherwise), and omitted Anthropic from the vendor list. The
 * page is now the source of truth; the PDF is generated from it.
 */
export default function Security() {
  return (
    <LegalLayout title="Security Policy and Procedures" updated={legalUpdatedLabel()}>
      <p className="mz-lead">
        This document describes the security practices that govern MĪZAN
        (<a href="https://app.mizan.exchange">app.mizan.exchange</a>), a personal
        finance dashboard that aggregates bank, brokerage, and market data via
        Plaid, SnapTrade, and related read-only APIs.
      </p>

      <h2>1. Scope</h2>
      <p>This policy covers:</p>
      <ul>
        <li>All systems that store, process, or transmit consumer financial data
            obtained via Plaid or SnapTrade.</li>
        <li>Administrative access to production infrastructure (Vercel, Supabase,
            GitHub, Plaid Dashboard, SnapTrade Dashboard, Anthropic Console).</li>
        <li>All code, configuration, secrets, and operational practices used to
            run the deployed application.</li>
      </ul>

      <h2>2. Governance</h2>
      <p>The operator is responsible for information security, including:</p>
      <ul>
        <li>Policy ownership and review.</li>
        <li>Vendor risk assessment for any new third-party data processor.</li>
        <li>Incident response and breach notification.</li>
        <li>Maintaining the access control matrix.</li>
      </ul>
      <p>
        Policy is reviewed <strong>quarterly</strong>, or whenever a material
        change in infrastructure, vendors, or data flows occurs — whichever is
        sooner. The review is scheduled automatically rather than by memory: an
        automated check reads this document's own review date daily and notifies
        the operator once the interval has elapsed.
      </p>

      <h2>3. Identity and Access Management</h2>
      <h3>3.1 Production system access</h3>
      <ul>
        <li>All administrative accounts (Vercel, Supabase, GitHub, Plaid,
            SnapTrade) require multi-factor authentication.</li>
        <li>Production secrets (Plaid client ID and secret, Supabase service-role
            key, SnapTrade consumer key, Anthropic API key, third-party API keys)
            are stored in Vercel environment variables, scoped per environment
            (Development, Preview, Production), and never committed to source
            control.</li>
        <li>Principle of least privilege: the public-facing application uses the
            Supabase anonymous key with Row-Level Security policies. The
            service-role key (which bypasses RLS) is used only on the server side
            and never transmitted to the browser.</li>
      </ul>

      <h3>3.2 Consumer access</h3>
      <ul>
        <li>End users authenticate via Supabase Auth (email + password).</li>
        <li>Multi-factor authentication (TOTP) is available to end users through
            the in-app account settings.</li>
        <li>Sessions use Supabase-issued JWTs; the server validates the JWT on
            every request that touches consumer financial data.</li>
        <li>Row-Level Security (RLS) policies enforce that each authenticated
            user can read only their own rows in Supabase tables.</li>
      </ul>

      <h2>4. Infrastructure and Network Security</h2>
      <ul>
        <li><strong>Encryption in transit:</strong> TLS 1.2 or better is enforced
            for all client-to-server traffic via Vercel. HSTS is set in response
            headers.</li>
        <li><strong>Encryption at rest:</strong> Supabase Postgres uses AES-256
            disk-level encryption. SnapTrade user secrets are additionally
            encrypted at the application layer (AES-256-GCM) before storage.</li>
        <li><strong>Secret storage:</strong> All API credentials are managed via
            Vercel encrypted environment variables. No secrets exist in the
            source repository.</li>
        <li><strong>Content Security Policy:</strong> A strict CSP is set via{" "}
            <code>vercel.json</code>, including explicit allowlists for Plaid and
            SnapTrade origins.</li>
        <li><strong>Security headers:</strong> <code>Strict-Transport-Security</code>,{" "}
            <code>X-Content-Type-Options</code>, <code>X-Frame-Options</code>,{" "}
            <code>Referrer-Policy</code>, and <code>Permissions-Policy</code> are
            set on all responses.</li>
        <li><strong>Rate limiting:</strong> Database-backed per-user and per-IP
            rate limits apply to authentication and data endpoints. Repeated
            authentication failures from one address trigger a temporary block.</li>
      </ul>

      <h2>5. Development and Vulnerability Management</h2>
      <ul>
        <li><strong>Dependency scanning:</strong> GitHub's automated dependency
            security alerts (Dependabot) are enabled. Vulnerable dependencies are
            reviewed and patched on receipt.</li>
        <li><strong>Patch management:</strong> Upstream package updates are
            applied through standard <code>npm</code> workflows. Production
            deploys go through Vercel CI.</li>
        <li><strong>Automated testing:</strong> A unit and end-to-end suite runs
            against the production build before release, including checks that
            published policy statements match the system's actual behaviour.</li>
        <li><strong>Runtime monitoring:</strong> Sentry captures and alerts on
            backend exceptions and frontend errors in production, with personally
            identifying information scrubbed.</li>
        <li><strong>Anomaly detection:</strong> Automated detectors monitor
            authentication failure spikes, provider error-rate spikes, scheduled
            job staleness, upstream data-feed failures, credential
            misconfiguration, and new-device sign-ins, with email alerts.</li>
        <li><strong>Audit logging:</strong> Every security-relevant event (login,
            MFA enrollment, bank connect, bank disconnect, session revoke, account
            deletion) is recorded to an append-only <code>audit_log</code> table.</li>
      </ul>

      <h2>6. Privacy and Data Handling</h2>
      <p>
        Refer to the <a href="/privacy">Privacy Policy</a> for the full
        data-handling disclosure to end users, and the{" "}
        <a href="/data-retention">Data Retention Policy</a> for retention periods
        by category.
      </p>
      <h3>6.1 Data categories</h3>
      <ul>
        <li><strong>Authentication data:</strong> email, hashed password (via
            Supabase Auth), optional TOTP factor.</li>
        <li><strong>Plaid access tokens:</strong> stored server-side only in{" "}
            <code>plaid_tokens</code> (RLS-protected, never returned to the
            browser).</li>
        <li><strong>Plaid account metadata:</strong> institution name, account
            name, masked number, current and available balances, currency. Stored
            in <code>plaid_accounts</code> with RLS.</li>
        <li><strong>Plaid transactions:</strong> stored in{" "}
            <code>plaid_transactions</code> with RLS, synced incrementally via{" "}
            <code>/transactions/sync</code>, so that budgets, spending history and
            recurring-payment detection persist across sessions.</li>
        <li><strong>SnapTrade user mapping:</strong> opaque user-id and
            user-secret pair per Supabase user, stored encrypted in{" "}
            <code>user_snaptrade</code>.</li>
        <li><strong>Product usage counters:</strong> a per-user view count per
            navigation destination in <code>nav_usage</code>. Counters only — no
            timeline, no financial data, no IP or device details.</li>
      </ul>

      <h3>6.2 Consent</h3>
      <ul>
        <li>End users consent to data collection at signup (acceptance of the
            Terms of Service and Privacy Policy).</li>
        <li>Plaid Link's own consent flow obtains explicit consent for each
            institution linked, with the user retaining the ability to disconnect
            at any time.</li>
      </ul>

      <h2>7. Incident Response</h2>
      <p>
        If the operator becomes aware of a confirmed or suspected security
        incident affecting consumer financial data:
      </p>
      <ol>
        <li>Contain the incident (revoke tokens, rotate credentials, take
            affected systems offline).</li>
        <li>Investigate scope and root cause using Sentry, audit logs, and
            Vercel/Supabase access logs.</li>
        <li>Notify affected users without undue delay and in accordance with
            applicable law.</li>
        <li>Notify Plaid and SnapTrade where their data or systems are
            implicated.</li>
        <li>Document the incident, remediation, and lessons learned.</li>
      </ol>

      <h2>8. Vendor Risk</h2>
      <p>
        The following third parties process or store consumer data on behalf of
        MĪZAN. Each is reviewed for SOC 2 / ISO 27001 / equivalent attestation and
        a published security policy before integration:
      </p>
      <ul>
        <li><strong>Vercel</strong> — hosting, edge network, function execution.</li>
        <li><strong>Supabase</strong> — Postgres database, authentication, RLS enforcement.</li>
        <li><strong>Plaid</strong> — bank aggregation.</li>
        <li><strong>SnapTrade</strong> — brokerage aggregation.</li>
        <li><strong>Anthropic</strong> — AI Assistant. Portfolio context is sent
            only when the user sends a message to the Assistant.</li>
        <li><strong>Sentry</strong> — error monitoring (PII scrubbing enabled).</li>
        <li><strong>Resend</strong> — transactional email.</li>
      </ul>

      <h2>9. Contact</h2>
      <p>
        Security questions or vulnerability reports:{" "}
        <a href="mailto:khanstyle02@gmail.com">khanstyle02@gmail.com</a>.
      </p>
      <p>
        For end-user data requests (access, deletion, correction), refer to the
        contact channel listed in the <a href="/privacy">Privacy Policy</a>.
      </p>
    </LegalLayout>
  );
}
