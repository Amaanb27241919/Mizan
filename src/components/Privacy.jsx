import LegalLayout from "./LegalLayout.jsx";

export default function Privacy() {
  return (
    <LegalLayout title="Privacy Policy" updated="May 12, 2026">
      <p className="mz-lead">
        MĪZAN ("we", "us", "the service") is a personal finance dashboard that
        helps you view your bank accounts, brokerage holdings, transactions,
        and subscriptions in one place. This Privacy Policy explains what data
        we collect, how we use it, who we share it with, and the rights you
        have over your information.
      </p>

      <h2>1. Who we are</h2>
      <p>
        MĪZAN is operated by Amaan Khan as an individual operator (referred
        to throughout this policy as "we" or "the operator"). The service is
        hosted at <a href="https://app.mizan.exchange">https://app.mizan.exchange</a>.
        For all privacy-related questions or data-subject requests,
        contact <a href="mailto:khanstyle02@gmail.com">khanstyle02@gmail.com</a>.
      </p>

      <h2>2. What data we collect</h2>
      <h3>2.1 Account data you provide</h3>
      <ul>
        <li>Your email address and password (hashed) when you sign up.</li>
        <li>Optional time-based one-time password (TOTP) factor if you enable
            multi-factor authentication.</li>
        <li>Optional preferences and settings you save inside the app.</li>
      </ul>

      <h3>2.2 Financial data via Plaid</h3>
      <p>
        When you link a bank or credit account through Plaid Link, Plaid
        returns the following to our backend on your behalf:
      </p>
      <ul>
        <li>An access token (stored server-side only, never sent to your browser).</li>
        <li>Account metadata: institution name, account name, masked number,
            type, subtype, current and available balances, currency.</li>
        <li>Recent transactions (merchant, amount, date, category).
            Transactions are fetched live each session and are not stored in our
            database.</li>
        <li>Recurring-transaction detection (subscriptions and recurring bills).</li>
      </ul>
      <p>
        You authenticate directly with your financial institution inside
        Plaid Link. We never see your bank username or password.
      </p>

      <h3>2.3 Brokerage data via SnapTrade</h3>
      <p>
        When you connect a brokerage account through SnapTrade, SnapTrade
        returns a user-id and user-secret pair used to query holdings,
        balances, and trades on your behalf. Your brokerage credentials
        never touch our servers.
      </p>

      <h3>2.4 Market data</h3>
      <p>
        We query third-party market data providers (Polygon, Finnhub, Alpaca)
        for quotes and reference data using server-side credentials. These
        queries do not transmit any personally identifying information.
      </p>

      <h3>2.5 Technical data</h3>
      <p>
        We collect minimal technical data needed to operate the service
        securely: IP address, user-agent, timestamps of security-relevant
        actions (login, MFA changes, bank connect/disconnect, session revoke),
        and unhandled error events (via Sentry, with personally identifying
        information scrubbed).
      </p>

      <h2>3. How we use your data</h2>
      <ul>
        <li>To display your accounts, balances, transactions, and holdings
            inside the MĪZAN dashboard.</li>
        <li>To calculate aggregated views (net worth, spending breakdown,
            recurring subscriptions, asset allocation).</li>
        <li>To authenticate you and secure your account.</li>
        <li>To detect anomalous activity such as authentication failure
            spikes or unusual sign-in locations.</li>
        <li>To send you transactional security alerts (e.g., new device,
            password change).</li>
        <li>To investigate and resolve service incidents.</li>
      </ul>
      <p>
        We do <strong>not</strong> sell your personal data. We do not use your
        financial data for advertising, profiling, or any commercial purpose
        beyond operating the service you signed up for.
      </p>

      <h2>4. Who we share data with</h2>
      <p>
        We share data only with the third-party processors required to
        operate the service:
      </p>
      <ul>
        <li><strong>Vercel</strong> — hosting and function execution.</li>
        <li><strong>Supabase</strong> — database, authentication, row-level security.</li>
        <li><strong>Plaid</strong> — bank aggregation. See
            <a href="https://plaid.com/legal/" target="_blank" rel="noreferrer"> Plaid's End User Privacy Policy</a>.</li>
        <li><strong>SnapTrade</strong> — brokerage aggregation. See
            <a href="https://snaptrade.com/legal" target="_blank" rel="noreferrer"> SnapTrade's privacy notice</a>.</li>
        <li><strong>Sentry</strong> — error monitoring, with PII scrubbing.</li>
        <li><strong>Resend</strong> — transactional security email.</li>
      </ul>
      <p>
        We do not share your data with advertisers, data brokers, or any
        party not listed above. We may disclose data when required by law,
        court order, or to protect the rights, safety, and property of
        users, the operator, or the public.
      </p>

      <h2>5. How long we keep your data</h2>
      <ul>
        <li>Account credentials, profile data, and connected-institution
            metadata are retained for as long as your MĪZAN account exists.</li>
        <li>Plaid transactions are <strong>not stored</strong>. They are fetched
            live each session via <code>/transactions/sync</code>.</li>
        <li>Audit log entries are retained for at least 12 months for
            security and compliance review.</li>
        <li>If you disconnect an institution, we call Plaid's
            <code>/item/remove</code> endpoint to revoke our access token and
            delete the corresponding records from our database.</li>
        <li>If you delete your MĪZAN account, all of your data — including
            Plaid and SnapTrade rows — is cascade-deleted from our database.</li>
      </ul>

      <h2>6. Your rights</h2>
      <p>
        Depending on where you live, you may have rights under the GDPR,
        CCPA, or similar laws, including the right to:
      </p>
      <ul>
        <li>Access the personal data we hold about you.</li>
        <li>Correct inaccurate data.</li>
        <li>Delete your data ("right to erasure").</li>
        <li>Export your data in a portable format.</li>
        <li>Withdraw consent for further processing.</li>
        <li>Object to or restrict certain processing.</li>
        <li>Lodge a complaint with a supervisory authority.</li>
      </ul>
      <p>
        To exercise any of these rights,
        email <a href="mailto:khanstyle02@gmail.com">khanstyle02@gmail.com</a>.
        We will respond within 30 days.
      </p>

      <h2>7. Security</h2>
      <p>
        We use industry-standard security practices, including:
      </p>
      <ul>
        <li>TLS 1.2 or higher for all data in transit.</li>
        <li>AES-256 encryption at rest for all stored data (Supabase).</li>
        <li>Row-Level Security policies so each user can only read their own data.</li>
        <li>Multi-factor authentication available to all users.</li>
        <li>Server-only storage of all access tokens and API secrets.</li>
        <li>Audit logging of every security-relevant action.</li>
        <li>Anomaly detection on authentication failures and provider errors.</li>
      </ul>
      <p>
        For a more detailed description of our security practices, see our
        <a href="https://github.com" target="_blank" rel="noreferrer"> SECURITY.md </a>
        in the project repository.
      </p>

      <h2>8. Children's privacy</h2>
      <p>
        MĪZAN is not intended for users under 18. We do not knowingly
        collect data from children. If you believe a child has provided us
        with personal data, contact us and we will delete it.
      </p>

      <h2>9. Changes to this policy</h2>
      <p>
        We may update this Privacy Policy. When we do, we update the
        "Last updated" date at the top of this page. Material changes will
        be communicated by email and via an in-app notice.
      </p>

      <h2>10. Contact</h2>
      <p>
        Questions, data requests, or complaints?
        Email <a href="mailto:khanstyle02@gmail.com">khanstyle02@gmail.com</a>.
      </p>
    </LegalLayout>
  );
}
