import LegalLayout from "./LegalLayout.jsx";

export default function Terms() {
  return (
    <LegalLayout title="Terms of Service" updated="May 12, 2026">
      <p className="mz-lead">
        These Terms of Service ("Terms") govern your use of MĪZAN
        (the "Service"). By creating an account or otherwise using the
        Service you agree to these Terms. If you do not agree, do not
        use the Service.
      </p>

      <h2>1. The service</h2>
      <p>
        MĪZAN is a personal finance dashboard that aggregates your bank
        accounts, brokerage holdings, transactions, and subscriptions
        into a single read-only view. The Service relies on third-party
        providers (including Plaid and SnapTrade) to retrieve your
        financial data with your authorization.
      </p>
      <p>
        MĪZAN is read-only. The Service does not initiate payments,
        transfer money, place trades, or otherwise act on your accounts.
      </p>

      <h2>2. Not financial advice</h2>
      <p>
        MĪZAN is an informational and aggregation tool. It is not, and
        should not be interpreted as, financial, tax, investment, legal,
        or accounting advice. We are not a registered investment adviser,
        broker-dealer, or financial planner. Any screening, charts,
        comparisons, or computed values shown in the app are produced
        algorithmically and are provided for your reference only. Always
        consult a qualified professional before making financial
        decisions.
      </p>

      <h2>3. Your account</h2>
      <ul>
        <li>You must be at least 18 years old to use the Service.</li>
        <li>You are responsible for maintaining the confidentiality of
            your credentials, including any multi-factor authentication
            secrets.</li>
        <li>You are responsible for all activity that occurs under your
            account.</li>
        <li>Notify us immediately at <a href="mailto:khanstyle02@gmail.com">khanstyle02@gmail.com</a> if
            you suspect unauthorized access to your account.</li>
      </ul>

      <h2>4. Third-party services</h2>
      <p>
        Linking your bank or brokerage requires you to authenticate
        through that institution's own login flow (typically via Plaid
        or SnapTrade). Your use of those flows is subject to those
        providers' own terms and privacy notices, including:
      </p>
      <ul>
        <li><a href="https://plaid.com/legal/" target="_blank" rel="noreferrer">Plaid End User Privacy Policy</a></li>
        <li><a href="https://snaptrade.com/legal" target="_blank" rel="noreferrer">SnapTrade Terms and Privacy Notice</a></li>
      </ul>
      <p>
        We are not responsible for the availability, accuracy, or
        behavior of third-party services. Connection issues, data
        delays, and outages at your financial institutions or
        aggregators are outside our control.
      </p>

      <h2>5. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Reverse-engineer, scrape, or attempt to extract source code
            beyond what is publicly available.</li>
        <li>Access accounts other than your own.</li>
        <li>Use the Service to violate any law or third-party right.</li>
        <li>Attempt to interfere with the Service's security,
            availability, or integrity (including rate-limiting
            mechanisms).</li>
        <li>Resell or commercially redistribute the Service or its data.</li>
      </ul>

      <h2>6. Intellectual property</h2>
      <p>
        The Service, including its design, code, and content, is owned
        by Amaan Khan or licensed from third parties. These Terms grant
        you a limited, non-exclusive, non-transferable license to use
        the Service for your personal, non-commercial use. We retain all
        other rights.
      </p>

      <h2>7. Disclaimers</h2>
      <p>
        THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT
        WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING IMPLIED
        WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE,
        TITLE, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE
        WILL BE UNINTERRUPTED, ACCURATE, SECURE, OR ERROR-FREE.
      </p>

      <h2>8. Limitation of liability</h2>
      <p>
        TO THE FULLEST EXTENT PERMITTED BY LAW, THE OPERATOR SHALL NOT
        BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL,
        OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, REVENUE, DATA, OR
        GOODWILL, ARISING OUT OF OR IN CONNECTION WITH YOUR USE OF THE
        SERVICE. OUR AGGREGATE LIABILITY FOR ALL CLAIMS RELATING TO THE
        SERVICE IS LIMITED TO ONE HUNDRED U.S. DOLLARS (US $100).
      </p>

      <h2>9. Termination</h2>
      <p>
        You may delete your account at any time from the in-app account
        settings. We may suspend or terminate your access to the Service
        if you violate these Terms or use the Service in a way that
        creates risk for us, other users, or our third-party providers.
        On termination, your data is deleted from our systems in
        accordance with our Privacy Policy.
      </p>

      <h2>10. Changes</h2>
      <p>
        We may revise these Terms from time to time. When we do, we
        update the "Last updated" date at the top of this page. Your
        continued use of the Service after a change constitutes
        acceptance of the revised Terms.
      </p>

      <h2>11. Governing law</h2>
      <p>
        These Terms are governed by the laws of the State of New York,
        without regard to its conflict-of-law principles. Any dispute
        arising out of or relating to these Terms or the Service will
        be resolved exclusively in the state or federal courts located
        in New York County, New York.
      </p>

      <h2>12. Contact</h2>
      <p>
        Questions about these Terms?
        Email <a href="mailto:khanstyle02@gmail.com">khanstyle02@gmail.com</a>.
      </p>
    </LegalLayout>
  );
}
