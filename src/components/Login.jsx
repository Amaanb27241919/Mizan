// Sign-in / Sign-up / Forgot-password / Reset-password screen for MIZAN.
// Mirrors ARIA's mode-based auth UX: everything happens in the *same* tab.
// Magic-link auth was replaced because the click-through opened a new tab,
// which was confusing post-confirmation.

import { useEffect, useState } from 'react';
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
    marginBottom: 14,
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
  error: { fontSize: 12, color: '#F47373', marginTop: 8, marginBottom: 4 },
  linkBtn: {
    background: 'none',
    border: 'none',
    color: '#4F76FB',
    cursor: 'pointer',
    fontSize: 12,
    padding: 0,
    textDecoration: 'underline',
    fontFamily: 'inherit',
  },
  footer: {
    fontSize: 11,
    color: '#5C6478',
    textAlign: 'center',
    marginTop: 18,
    lineHeight: 1.6,
  },
};

export default function Login() {
  const {
    signInWithPassword,
    signUpWithPassword,
    sendPasswordReset,
    updatePassword,
    isSupabaseConfigured,
    recoveryMode,
    exitRecovery,
  } = useAuth();

  // 'signin' | 'signup' | 'forgot' | 'reset' | 'verify-sent'
  // 'reset' shows when Supabase emits PASSWORD_RECOVERY (user clicked reset link).
  // 'verify-sent' shows after sign-up if Supabase has email confirmation enabled.
  const [mode, setMode] = useState(recoveryMode ? 'reset' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);

  useEffect(() => {
    if (recoveryMode) setMode('reset');
  }, [recoveryMode]);

  const reset = (next) => {
    setMode(next);
    setError(null);
    setInfo(null);
    setPassword('');
    setPassword2('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setInfo(null);

    if (mode === 'signin') {
      if (!email || !password) return setError('Email and password required');
      setSubmitting(true);
      const { error: err } = await signInWithPassword(email, password);
      setSubmitting(false);
      if (err) return setError(err.message || 'Sign-in failed');
      // Success — AuthProvider will flip user and unmount this screen.
    } else if (mode === 'signup') {
      if (!email || !password) return setError('Email and password required');
      if (password.length < 8) return setError('Password must be at least 8 characters');
      if (password !== password2) return setError('Passwords do not match');
      setSubmitting(true);
      const { data, error: err } = await signUpWithPassword(email, password);
      setSubmitting(false);
      if (err) return setError(err.message || 'Sign-up failed');
      // If Supabase requires email confirmation, data.session is null.
      // If not, session is set and AuthProvider will unmount this screen.
      if (!data?.session) setMode('verify-sent');
    } else if (mode === 'forgot') {
      if (!email) return setError('Email required');
      setSubmitting(true);
      const { error: err } = await sendPasswordReset(email);
      setSubmitting(false);
      if (err) return setError(err.message || 'Could not send reset email');
      // Always show success — don't leak whether the email is registered.
      setInfo(`If an account exists for ${email}, a reset link has been sent.`);
    } else if (mode === 'reset') {
      if (!password) return setError('New password required');
      if (password.length < 8) return setError('Password must be at least 8 characters');
      if (password !== password2) return setError('Passwords do not match');
      setSubmitting(true);
      const { error: err } = await updatePassword(password);
      setSubmitting(false);
      if (err) return setError(err.message || 'Password update failed');
      // Clear recovery flag and route back to sign-in.
      exitRecovery();
      setInfo('Password updated. You can sign in with your new password.');
      setMode('signin');
    }
  };

  const showTabs = mode === 'signin' || mode === 'signup';
  const isSignUp = mode === 'signup';

  let title = 'Sign in';
  let subtitle = 'Enter your email and password.';
  let button = 'Sign in';
  if (mode === 'signup') {
    title = 'Create your account';
    subtitle = 'Pick a password — at least 8 characters.';
    button = 'Create account';
  } else if (mode === 'forgot') {
    title = 'Reset password';
    subtitle = "Enter your email and we'll send a reset link.";
    button = 'Send reset link';
  } else if (mode === 'reset') {
    title = 'Set a new password';
    subtitle = 'Enter and confirm your new password.';
    button = 'Update password';
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.wordmark}>MĪZAN</div>

        {showTabs && (
          <div style={styles.tabs}>
            <button
              type="button"
              onClick={() => reset('signin')}
              style={{ ...styles.tab, ...(mode === 'signin' ? styles.tabActive : {}) }}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => reset('signup')}
              style={{ ...styles.tab, ...(mode === 'signup' ? styles.tabActive : {}) }}
            >
              Sign up
            </button>
          </div>
        )}

        {mode === 'verify-sent' ? (
          <div style={styles.notice}>
            <div style={{ fontWeight: 600, color: '#E6E8EE', marginBottom: 6 }}>
              Confirm your email
            </div>
            We sent a confirmation link to <strong>{email}</strong>. Click it to
            activate your account, then come back here to sign in.
            <div style={{ marginTop: 12 }}>
              <button type="button" onClick={() => reset('signin')} style={styles.linkBtn}>
                ← Back to sign in
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <h1 style={styles.heading}>{title}</h1>
            <p style={styles.sub}>{subtitle}</p>

            {(mode === 'signin' || mode === 'signup' || mode === 'forgot') && (
              <>
                <label style={styles.label} htmlFor="mizan-email">Email</label>
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
              </>
            )}

            {(mode === 'signin' || mode === 'signup' || mode === 'reset') && (
              <>
                <label style={styles.label} htmlFor="mizan-password">
                  {mode === 'reset' ? 'New password' : 'Password'}
                </label>
                <input
                  id="mizan-password"
                  type="password"
                  required
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  placeholder={mode === 'signin' ? '' : 'At least 8 characters'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={styles.input}
                />
              </>
            )}

            {(mode === 'signup' || mode === 'reset') && (
              <>
                <label style={styles.label} htmlFor="mizan-password2">Confirm password</label>
                <input
                  id="mizan-password2"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={password2}
                  onChange={(e) => setPassword2(e.target.value)}
                  style={styles.input}
                />
              </>
            )}

            {mode === 'signin' && (
              <div style={{ textAlign: 'right', marginBottom: 10, marginTop: -4 }}>
                <button type="button" onClick={() => reset('forgot')} style={styles.linkBtn}>
                  Forgot password?
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !isSupabaseConfigured}
              style={{
                ...styles.button,
                ...(submitting || !isSupabaseConfigured ? styles.buttonDisabled : {}),
              }}
            >
              {submitting ? 'Working…' : button}
            </button>

            {!isSupabaseConfigured && (
              <div style={styles.error}>
                Supabase not configured — see supabase/README.md.
              </div>
            )}
            {error && <div style={styles.error}>{error}</div>}
            {info && (
              <div style={{ ...styles.notice, marginTop: 12 }}>{info}</div>
            )}

            {mode === 'forgot' && (
              <div style={{ textAlign: 'center', marginTop: 14 }}>
                <button type="button" onClick={() => reset('signin')} style={styles.linkBtn}>
                  ← Back to sign in
                </button>
              </div>
            )}
          </form>
        )}

        <div style={styles.footer}>
          {mode === 'signup' && (
            <>Already have an account?{' '}
              <button type="button" onClick={() => reset('signin')} style={styles.linkBtn}>
                Sign in instead
              </button>
            </>
          )}
          {mode === 'signin' && (
            <>New to MIZAN?{' '}
              <button type="button" onClick={() => reset('signup')} style={styles.linkBtn}>
                Create an account
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
