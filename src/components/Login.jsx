// Sign-in / Sign-up / Forgot-password / Reset-password screen for MIZAN.
// Mirrors ARIA's mode-based auth UX: everything happens in the *same* tab.
// Magic-link auth was replaced because the click-through opened a new tab,
// which was confusing post-confirmation.

import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';

const SF =
  "'SF Pro Display','SF Pro Text',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
const MONO =
  "'SF Mono',ui-monospace,'JetBrains Mono','Menlo','Monaco',monospace";

const styles = {
  page: {
    minHeight: '100vh',
    width: '100%',
    background: 'radial-gradient(circle at 30% 20%, rgba(123,97,255,0.10), transparent 50%), radial-gradient(circle at 80% 90%, rgba(255,159,106,0.08), transparent 45%), #0B0F1E',
    color: '#ECEFF7',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: SF,
    padding: 24,
    WebkitFontSmoothing: 'antialiased',
  },
  card: {
    width: '100%',
    maxWidth: 430,
    background: 'rgba(26,31,53,0.85)',
    backdropFilter: 'blur(20px) saturate(160%)',
    WebkitBackdropFilter: 'blur(20px) saturate(160%)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 18,
    padding: '36px 30px',
    boxShadow: '0 24px 80px rgba(0,0,0,0.55)',
  },
  wordmark: {
    fontSize: 13,
    letterSpacing: '0.34em',
    fontWeight: 700,
    color: '#7B61FF',
    textAlign: 'center',
    marginBottom: 24,
    fontFamily: MONO,
  },
  tabs: {
    display: 'flex',
    background: 'rgba(11,15,30,0.6)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 12,
    padding: 4,
    marginBottom: 22,
    gap: 4,
  },
  tab: {
    flex: 1,
    padding: '9px 12px',
    background: 'transparent',
    border: 'none',
    borderRadius: 9,
    color: '#6F7997',
    fontSize: 13,
    fontWeight: 500,
    letterSpacing: '-0.005em',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    fontFamily: SF,
  },
  tabActive: {
    background: '#1A1F35',
    color: '#ECEFF7',
    boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
  },
  heading: {
    fontSize: 26,
    fontWeight: 700,
    letterSpacing: '-0.02em',
    margin: '0 0 8px 0',
    color: '#ECEFF7',
  },
  sub: { fontSize: 14, color: '#6F7997', margin: '0 0 24px 0', lineHeight: 1.55 },
  label: {
    display: 'block',
    fontSize: 11,
    fontWeight: 500,
    color: '#6F7997',
    marginBottom: 7,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    fontFamily: MONO,
  },
  input: {
    width: '100%',
    padding: '12px 14px',
    background: 'rgba(11,15,30,0.6)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 10,
    color: '#ECEFF7',
    fontSize: 15,
    outline: 'none',
    boxSizing: 'border-box',
    marginBottom: 14,
    fontFamily: SF,
    transition: 'border-color 0.15s, box-shadow 0.15s',
  },
  button: {
    width: '100%',
    padding: '13px 14px',
    background: 'linear-gradient(135deg, #7B61FF, #5A3FE0)',
    border: 'none',
    borderRadius: 10,
    color: '#fff',
    fontSize: 14,
    fontWeight: 600,
    letterSpacing: '-0.005em',
    cursor: 'pointer',
    boxShadow: '0 4px 20px rgba(123,97,255,0.45)',
    fontFamily: SF,
    transition: 'transform 0.15s, box-shadow 0.2s',
  },
  buttonDisabled: { opacity: 0.55, cursor: 'not-allowed', boxShadow: 'none' },
  notice: {
    fontSize: 13,
    color: '#9CDCA0',
    background: 'rgba(123,97,255,0.10)',
    border: '1px solid rgba(123,97,255,0.28)',
    padding: 14,
    borderRadius: 10,
    lineHeight: 1.55,
  },
  error: { fontSize: 12, color: '#F47373', marginTop: 8, marginBottom: 4 },
  linkBtn: {
    background: 'none',
    border: 'none',
    color: '#7B61FF',
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
    mfaListFactors,
    mfaChallengeAndVerify,
    mfaAssuranceLevel,
    mfaRequired,
    isSupabaseConfigured,
    recoveryMode,
    exitRecovery,
  } = useAuth();

  // 'signin' | 'signup' | 'forgot' | 'reset' | 'verify-sent' | 'mfa'
  // 'reset' shows when Supabase emits PASSWORD_RECOVERY (user clicked reset link).
  // 'verify-sent' shows after sign-up if Supabase has email confirmation enabled.
  // 'mfa' shows after password sign-in when the account has a verified TOTP factor.
  const [mode, setMode] = useState(recoveryMode ? 'reset' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaFactor, setMfaFactor] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);

  useEffect(() => {
    if (recoveryMode) setMode('reset');
  }, [recoveryMode]);

  // When AuthProvider tells us the active session is AAL1 and the account
  // has a verified TOTP factor, render the MFA challenge step instead of
  // the password form. This is what makes the prompt appear when Login is
  // mounted because of mfaRequired (page refresh mid-MFA, or the post-
  // sign-in transition that previously raced against MizanApp mounting).
  useEffect(() => {
    if (!mfaRequired || mode === 'mfa') return;
    let cancelled = false;
    (async () => {
      const factors = await mfaListFactors();
      if (cancelled) return;
      const verified = (factors?.data?.totp || []).find((f) => f.status === 'verified');
      if (verified) {
        setMfaFactor(verified);
        setMode('mfa');
      }
    })();
    return () => { cancelled = true; };
  }, [mfaRequired]);

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
      if (err) {
        setSubmitting(false);
        return setError(err.message || 'Sign-in failed');
      }
      // Password OK. Check if MFA is required to step up to AAL2.
      const aal = await mfaAssuranceLevel();
      if (aal?.data?.currentLevel === 'aal1' && aal?.data?.nextLevel === 'aal2') {
        const factors = await mfaListFactors();
        const verified = (factors?.data?.totp || []).find(f => f.status === 'verified');
        if (verified) {
          setMfaFactor(verified);
          setMode('mfa');
          setSubmitting(false);
          return;
        }
      }
      setSubmitting(false);
      // Success — AuthProvider will flip user and unmount this screen.
    } else if (mode === 'mfa') {
      if (!mfaCode || mfaCode.length < 6) return setError('Enter the 6-digit code');
      if (!mfaFactor) return setError('Session expired — sign in again');
      setSubmitting(true);
      const { error: err } = await mfaChallengeAndVerify(mfaFactor.id, mfaCode);
      setSubmitting(false);
      if (err) return setError(err.message || 'Invalid code');
      // Success — session promotes to AAL2; AuthProvider unmounts this screen.
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
  } else if (mode === 'mfa') {
    title = 'Two-factor verification';
    subtitle = 'Enter the 6-digit code from your authenticator app.';
    button = 'Verify';
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

            {mode === 'mfa' && (
              <>
                <label style={styles.label} htmlFor="mizan-mfa">6-digit code</label>
                <input
                  id="mizan-mfa"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="123456"
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                  style={{ ...styles.input, letterSpacing: '0.3em', fontSize: 18, textAlign: 'center' }}
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

            {mode === 'signup' && (
              <div style={{
                marginTop: 14,
                fontSize: 11,
                lineHeight: 1.55,
                color: '#7C8597',
                fontFamily: SF,
                textAlign: 'center',
              }}>
                By creating an account, you agree to MĪZAN's{' '}
                <a href="/terms" target="_blank" rel="noreferrer" style={{ color: '#7B61FF', textDecoration: 'none' }}>
                  Terms of Service
                </a>{' '}and{' '}
                <a href="/privacy" target="_blank" rel="noreferrer" style={{ color: '#7B61FF', textDecoration: 'none' }}>
                  Privacy Policy
                </a>,
                and consent to the collection, processing, and storage of your data as described in our Privacy Policy.
              </div>
            )}

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

        <div style={{
          marginTop: 18,
          paddingTop: 14,
          borderTop: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '10px 14px',
          justifyContent: 'center',
          fontSize: 11,
          color: '#5C6478',
          fontFamily: SF,
        }}>
          <a href="/privacy" target="_blank" rel="noreferrer" style={{ color: '#7C8597', textDecoration: 'none' }}>Privacy</a>
          <a href="/terms" target="_blank" rel="noreferrer" style={{ color: '#7C8597', textDecoration: 'none' }}>Terms</a>
          <a href="/contact" target="_blank" rel="noreferrer" style={{ color: '#7C8597', textDecoration: 'none' }}>Contact</a>
          <a href="/legal/SECURITY_POLICY.pdf" target="_blank" rel="noreferrer" style={{ color: '#7C8597', textDecoration: 'none' }}>Security</a>
          <a href="/legal/DATA_RETENTION_POLICY.pdf" target="_blank" rel="noreferrer" style={{ color: '#7C8597', textDecoration: 'none' }}>Data Retention</a>
        </div>
      </div>
    </div>
  );
}
