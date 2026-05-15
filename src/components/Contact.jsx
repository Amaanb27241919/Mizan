import LegalLayout from "./LegalLayout.jsx";

export default function Contact() {
  return (
    <LegalLayout title="Contact" updated="May 14, 2026">
      <p className="mz-lead">
        MĪZAN is operated by Amaan Khan as an individual. Whether you have a
        product question, a privacy or data request, a security concern, or
        feedback on the app, all messages route to the same inbox and are
        read by the operator.
      </p>

      <h2>General inquiries</h2>
      <p>
        Product questions, feedback, account help, partnership requests, or
        anything else not covered below.
      </p>
      <p>
        Email <a href="mailto:khanstyle02@gmail.com">khanstyle02@gmail.com</a>
      </p>

      <h2>Privacy and data requests</h2>
      <p>
        Requests under the GDPR (EU), CCPA (California), or equivalent
        statutes — including access, correction, erasure, portability,
        withdrawal of consent, or restriction of processing — are honored
        within 30 days of receipt.
      </p>
      <p>
        Email <a href="mailto:khanstyle02@gmail.com">khanstyle02@gmail.com</a> with
        the subject line <strong>"Data request"</strong>. Please include the
        account email so we can verify your identity before acting.
      </p>
      <p>
        Full details on what we collect, how long we retain it, and your
        rights are in the <a href="/privacy">Privacy Policy</a> and the{" "}
        <a href="/legal/DATA_RETENTION_POLICY.pdf" target="_blank" rel="noreferrer">Data Retention Policy</a>.
      </p>

      <h2>Security disclosures</h2>
      <p>
        If you have discovered a vulnerability or suspect a security
        incident affecting MĪZAN, please report it directly to the
        operator. Do not post details publicly until we have had a chance
        to investigate and remediate.
      </p>
      <p>
        Email <a href="mailto:khanstyle02@gmail.com">khanstyle02@gmail.com</a> with
        the subject line <strong>"SECURITY:"</strong> followed by a short
        description. We respond to security reports within 72 hours and
        publish remediation timelines per the{" "}
        <a href="/legal/SECURITY_POLICY.pdf" target="_blank" rel="noreferrer">Security Policy</a>.
      </p>

      <h2>Partnership and integration inquiries</h2>
      <p>
        If you are a financial institution, a broker, an aggregator
        (Plaid, SnapTrade, etc.), or a compliance reviewer working with
        MĪZAN, please email{" "}
        <a href="mailto:khanstyle02@gmail.com">khanstyle02@gmail.com</a> and
        include your organization, your role, and the reason for the
        outreach. Compliance-related requests are routed first.
      </p>

      <h2>Response times</h2>
      <ul>
        <li>General inquiries: typically within 2 business days</li>
        <li>Data-subject requests: within 30 days, per applicable law</li>
        <li>Security reports: within 72 hours</li>
        <li>Partnership inquiries: within 5 business days</li>
      </ul>

      <h2>Operator details</h2>
      <p>
        Operated by <strong>Amaan Khan</strong> as an individual.
        MĪZAN is hosted at{" "}
        <a href="https://mizan-puce.vercel.app">https://mizan-puce.vercel.app</a>.
      </p>
    </LegalLayout>
  );
}
