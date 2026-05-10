// Magic-link login screen for MIZAN.
// Inline styles only — does not depend on MizanApp's `T` token.

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
    maxWidth: 400,
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
    marginBottom: 28,
  },
  heading: {
    fontSize: 22,
    fontWeight: 600,
    margin: '0 0 8px 0',
    color: '#E6E8EE',
  },
  sub: { fontSize: 13, color: '#8A93A6', margin: '0 0 22px 0' },
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
    background: '#4F76FB',
    border: 'none',
    borderRadius: 8,
    color: '#fff',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  buttonDisabled: { opacity: 0.6, cursor: 'not-allowed' },
  notice: {
    fontSize: 13,
    color: '#9CDCA0',
    background: 'rgba(79,118,251,0.08)',
    border: '1px solid rgba(79,118,251,0.25)',
    padding: 12,
    borderRadius: 8,
    lineHeight: 1.4,
  },
  error: { fontSize: 12, color: '#F47373', marginTop: 10 },
};

export default function Login() {
  const { signInWithEmail, isSupabaseConfigured } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

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

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.wordmark}>MIZAN</div>
        {sent ? (
          <div style={styles.notice}>
            Check your email — link sent to <strong>{email}</strong>.
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <h1 style={styles.heading}>Sign in</h1>
            <p style={styles.sub}>
              Enter your email and we&rsquo;ll send a magic sign-in link.
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
              {submitting ? 'Sending…' : 'Send magic link'}
            </button>
            {!isSupabaseConfigured && (
              <div style={styles.error}>
                Supabase not configured — see supabase/README.md.
              </div>
            )}
            {error && <div style={styles.error}>{error}</div>}
          </form>
        )}
      </div>
    </div>
  );
}
