// Sign-in / sign-up screen for MIZAN.
// Magic-link auth handles both flows under the hood (Supabase auto-creates
// the user if they don't exist) — this UI surfaces the distinction so users
// know which path they're on.

import { useState } from 'react';
import { useAuth } from '../lib/auth';

const styles = {
  page: {
    minHeight: '100vh',
    width: '100%',
    background: '#0A0B0F',
    color: '#E6E8EE',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif',
    padding: '24px',
  },
  card: {
    width: '100%',
    maxWidth: 420,
    background: '#161A23',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 14,
    padding: '32px 28px',
    boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
  },
  wordmark: {
    fontSize: 14,
    letterSpacing: '0.32em',
    fontWeight: 600,
    color: '#8A93A6',
    textAlign: 'center',
    marginBottom: 22,
  },
  tabs: {
    display: 'flex',
    background: '#0A0B0F',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 10,
    padding: 4,
    marginBottom: 22,
    gap: 4,
  },
  tab: {
    flex: 1,
    padding: '8px 12px',
    background: 'transparent',
    border: 'none',
    borderRadius: 7,
    color: '#8A93A6',
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: '0.04em',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  tabActive: {
    background: '#161A23',
    color: '#E6E8EE',
    boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
  },
  heading: {
    fontSize: 22,
    fontWeight: 600,
    margin: '0 0 6px 0',
    color: '#E6E8EE',
  },
  sub: { fontSize: 13, color: '#8A93A6', margin: '0 0 22px 0', lineHeight: 1.5 },
  label: {
    display: 'block',
    fontSize: 12,
    color: '#8A93A6',
    marginBottom: 6,
  },
  input: {
    width: '100%',
    padding: '11px 13px',
    background: '#0A0B0F',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 8,
    color: '#E6E8EE',
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box',
    marginBottom: 16,
  },
  button: {
    width: '100%',
    padding: '11px 13px',
    background: 'linear-gradient(135deg, #4F76FB, #3A5BD9)',
    border: 'none',
    borderRadius: 8,
    color: '#fff',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(79,118,251,0.35)',
  },
  buttonDisabled: { opacity: 0.6, cursor: 'not-allowed', boxShadow: 'none' },
  notice: {
    fontSize: 13,
    color: '#9CDCA0',
    background: 'rgba(79,118,251,0.08)',
    border: '1px solid rgba(79,118,251,0.25)',
    padding: 14,
    borderRadius: 8,
    lineHeight: 1.5,
  },
  error: { fontSize: 12, color: '#F47373', marginTop: 10 },
  footer: {
    fontSize: 11,
    color: '#5C6478',
    textAlign: 'center',
    marginTop: 18,
    lineHeight: 1.6,
  },
};

export default function Login() {
  const { signInWithEmail, isSupabaseConfigured } = useAuth();
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const isSignUp = mode === 'signup';

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || submitting) return;
    setSubmitting(true);
    setError(null);
    const { error: err } = await signInWithEmail(email);
    setSubmitting(false);
    if (err) {
      setError(err.message || 'Failed to send link');
      return;
    }
    setSent(true);
  };

  const switchMode = (next) => {
    setMode(next);
    setSent(false);
    setError(null);
  };

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.wordmark}>MĪZAN</div>

        {!sent && (
          <div style={styles.tabs}>
            <button
              type="button"
              onClick={() => switchMode('signin')}
              style={{ ...styles.tab, ...(mode === 'signin' ? styles.tabActive : {}) }}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => switchMode('signup')}
              style={{ ...styles.tab, ...(mode === 'signup' ? styles.tabActive : {}) }}
            >
              Sign up
            </button>
          </div>
        )}

        {sent ? (
          <div style={styles.notice}>
            <div style={{ fontWeight: 600, color: '#E6E8EE', marginBottom: 6 }}>
              {isSignUp ? 'Welcome to MIZAN' : 'Welcome back'}
            </div>
            Check your email — {isSignUp ? 'confirmation' : 'sign-in'} link sent to{' '}
            <strong>{email}</strong>.
            <div style={{ marginTop: 10, fontSize: 11, color: '#5C6478' }}>
              Link expires in 1 hour. Check spam if it doesn't arrive in 30 seconds.
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <h1 style={styles.heading}>{isSignUp ? 'Create your account' : 'Sign in'}</h1>
            <p style={styles.sub}>
              {isSignUp
                ? "We'll send a confirmation link to verify your email — no password required."
                : "Enter your email and we'll send a magic sign-in link."}
            </p>
            <label style={styles.label} htmlFor="mizan-email">
              Email
            </label>
            <input
              id="mizan-email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={styles.input}
            />
            <button
              type="submit"
              disabled={submitting || !isSupabaseConfigured}
              style={{
                ...styles.button,
                ...(submitting || !isSupabaseConfigured
                  ? styles.buttonDisabled
                  : {}),
              }}
            >
              {submitting
                ? 'Sending…'
                : isSignUp
                  ? 'Send confirmation link'
                  : 'Send magic link'}
            </button>
            {!isSupabaseConfigured && (
              <div style={styles.error}>
                Supabase not configured — see supabase/README.md.
              </div>
            )}
            {error && <div style={styles.error}>{error}</div>}
          </form>
        )}

        <div style={styles.footer}>
          {isSignUp ? (
            <>Already have an account? <a onClick={() => switchMode('signin')} style={{ color: '#4F76FB', cursor: 'pointer', textDecoration: 'none' }}>Sign in instead</a></>
          ) : (
            <>New to MIZAN? <a onClick={() => switchMode('signup')} style={{ color: '#4F76FB', cursor: 'pointer', textDecoration: 'none' }}>Create an account</a></>
          )}
        </div>
      </div>
    </div>
  );
}
