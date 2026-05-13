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
          </nav>
        </header>

        <main className="mz-legal-main">
          <h1>{title}</h1>
          <p className="mz-legal-updated">Last updated: {updated}</p>
          {children}
        </main>

        <footer className="mz-legal-footer">
          <span>© 2026 MĪZAN · Operated by Amaan Khan</span>
          <span>
            <a href="mailto:khanstyle02@gmail.com">khanstyle02@gmail.com</a>
          </span>
        </footer>
      </div>
    </>
  );
}

const styles = `
.mz-legal-root {
  min-height: 100vh;
  background: #0B0F1E;
  color: #E7E9EC;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
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
  border-bottom: 1px solid #1F2530;
}
.mz-legal-brand {
  font-family: "SF Mono", Menlo, monospace;
  font-weight: 600;
  font-size: 14px;
  letter-spacing: 0.12em;
  color: #E7E9EC;
  text-decoration: none;
}
.mz-legal-nav a {
  margin-left: 18px;
  color: #7C8597;
  font-size: 13px;
  text-decoration: none;
}
.mz-legal-nav a:hover { color: #E7E9EC; }
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
  color: #7C8597;
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin: 0 0 36px;
}
.mz-legal-main h2 {
  font-size: 20px;
  margin-top: 40px;
  margin-bottom: 12px;
  color: #E7E9EC;
}
.mz-legal-main h3 {
  font-size: 16px;
  margin-top: 24px;
  margin-bottom: 8px;
  color: #B6BDD0;
}
.mz-legal-main p,
.mz-legal-main ul,
.mz-legal-main ol {
  color: #B6BDD0;
}
.mz-legal-main p.mz-lead {
  color: #E7E9EC;
  font-size: 16px;
  margin-bottom: 28px;
}
.mz-legal-main a {
  color: #7B61FF;
  text-decoration: none;
  border-bottom: 1px solid rgba(123, 97, 255, 0.4);
}
.mz-legal-main a:hover {
  border-bottom-color: #7B61FF;
}
.mz-legal-main ul, .mz-legal-main ol {
  padding-left: 22px;
  margin: 10px 0 18px;
}
.mz-legal-main li {
  margin-bottom: 6px;
}
.mz-legal-main code {
  background: #161B2D;
  border: 1px solid #1F2530;
  padding: 1px 6px;
  border-radius: 4px;
  font-family: "SF Mono", Menlo, monospace;
  font-size: 13px;
  color: #B6BDD0;
}
.mz-legal-footer {
  display: flex;
  justify-content: space-between;
  padding: 20px 32px;
  border-top: 1px solid #1F2530;
  font-size: 12px;
  color: #5C6478;
}
.mz-legal-footer a {
  color: #7C8597;
  text-decoration: none;
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
