// Shared layout for the public-facing legal pages (/privacy, /terms).
// Self-contained styling: no MizanApp theme tokens, no auth context.
// Renders correctly even if the rest of the app fails to load — Plaid's
// compliance crawler must always be able to reach these documents.

export default function LegalLayout({ title, updated, children }) {
  return (
    <>
      <style>{styles}</style>
      <div className="mz-legal-root">
        <header className="mz-legal-header">
          <a className="mz-legal-brand" href="/">MĪZAN</a>
          <nav className="mz-legal-nav">
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
            <a href="/contact">Contact</a>
          </nav>
        </header>

        <main className="mz-legal-main">
          <h1>{title}</h1>
          <p className="mz-legal-updated">Last updated: {updated}</p>
          {children}
        </main>

        <footer className="mz-legal-footer">
          <span>© 2026 MĪZAN · Operated by Amaan Khan</span>
          <span className="mz-legal-footer-links">
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
            <a href="/contact">Contact</a>
            <a href="/legal/SECURITY_POLICY.pdf" target="_blank" rel="noreferrer">Security</a>
            <a href="/legal/ACCESS_CONTROLS_POLICY.pdf" target="_blank" rel="noreferrer">Access Controls</a>
            <a href="/legal/DATA_RETENTION_POLICY.pdf" target="_blank" rel="noreferrer">Data Retention</a>
          </span>
        </footer>
      </div>
    </>
  );
}

const styles = `
.mz-legal-root {
  min-height: 100vh;
  background: #faf8f4;
  color: #1c1b19;
  font-family: 'IBM Plex Sans', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 15px;
  line-height: 1.7;
  display: flex;
  flex-direction: column;
}
.mz-legal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 18px 32px;
  border-bottom: 1px solid #e8e2d6;
}
.mz-legal-brand {
  font-family: "SF Mono", Menlo, monospace;
  font-weight: 600;
  font-size: 14px;
  letter-spacing: 0.12em;
  color: #1c1b19;
  text-decoration: none;
}
.mz-legal-nav a {
  margin-left: 18px;
  color: #87827a;
  font-size: 13px;
  text-decoration: none;
}
.mz-legal-nav a:hover { color: #1c1b19; }
.mz-legal-main {
  max-width: 760px;
  margin: 0 auto;
  padding: 56px 32px 80px;
  flex: 1;
  width: 100%;
  box-sizing: border-box;
}
.mz-legal-main h1 {
  font-size: 32px;
  line-height: 1.25;
  margin: 0 0 6px;
  letter-spacing: -0.01em;
}
.mz-legal-updated {
  color: #87827a;
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin: 0 0 36px;
}
.mz-legal-main h2 {
  font-size: 20px;
  margin-top: 40px;
  margin-bottom: 12px;
  color: #1c1b19;
}
.mz-legal-main h3 {
  font-size: 16px;
  margin-top: 24px;
  margin-bottom: 8px;
  color: #44413b;
}
.mz-legal-main p,
.mz-legal-main ul,
.mz-legal-main ol {
  color: #44413b;
}
.mz-legal-main p.mz-lead {
  color: #1c1b19;
  font-size: 16px;
  margin-bottom: 28px;
}
.mz-legal-main a {
  color: #1e4e8c;
  text-decoration: none;
  border-bottom: 1px solid rgba(30, 78, 140, 0.4);
}
.mz-legal-main a:hover {
  border-bottom-color: #1e4e8c;
}
.mz-legal-main ul, .mz-legal-main ol {
  padding-left: 22px;
  margin: 10px 0 18px;
}
.mz-legal-main li {
  margin-bottom: 6px;
}
.mz-legal-main code {
  background: #f2eee6;
  border: 1px solid #e8e2d6;
  padding: 1px 6px;
  border-radius: 4px;
  font-family: "SF Mono", Menlo, monospace;
  font-size: 13px;
  color: #44413b;
}
.mz-legal-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 20px 32px;
  border-top: 1px solid #e8e2d6;
  font-size: 12px;
  color: #5C6478;
}
.mz-legal-footer-links {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}
.mz-legal-footer a {
  color: #87827a;
  text-decoration: none;
}
.mz-legal-footer a:hover {
  color: #1c1b19;
}
@media (max-width: 640px) {
  .mz-legal-header, .mz-legal-footer { padding: 16px 20px; }
  .mz-legal-main { padding: 36px 20px 60px; }
  .mz-legal-main h1 { font-size: 26px; }
  .mz-legal-footer {
    flex-direction: column;
    gap: 6px;
  }
}
`;
