// Auth context for MIZAN.
// - When Supabase is configured: email + password auth via Supabase.
//   Sign-in / sign-up / password-reset all complete in the original tab
//   (mirrors ARIA's auth UX — no magic-link click-through that opens a
//   new tab post-confirmation).
// - When not configured: single-user pass-through mode with a fake user
//   so the rest of the app keeps working without credentials.

import { createContext, useContext, useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from './supabase';
import { clearTrackedLocalState } from './userState';
import { recordAudit } from './apiFetch';

const SINGLE_USER = { id: 'single-user', email: 'local@mizan' };

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(isSupabaseConfigured ? null : SINGLE_USER);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  // True when Supabase emits PASSWORD_RECOVERY — the user clicked a reset
  // link and we should show the "set new password" UI instead of the app.
  const [recoveryMode, setRecoveryMode] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      // Pass-through mode — already initialized with fake user.
      return;
    }

    let mounted = true;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted) return;
        setSession(data.session ?? null);
        setUser(data.session?.user ?? null);
        setLoading(false);
      })
      .catch(() => {
        if (!mounted) return;
        setLoading(false);
      });

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (event, nextSession) => {
        // Wipe local cache on sign-out events. The user.id-change check in
        // hydrateUserState covers the sign-in side (clears if previous user
        // was different) — but an explicit SIGNED_OUT event has no following
        // hydrate call to do it, so we clear here.
        if (event === 'SIGNED_OUT') clearTrackedLocalState();
        if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true);
        // Audit trail — server reads user_id from JWT so we can call this
        // before the React state updates settle.
        if (event === 'SIGNED_IN') recordAudit('auth.sign_in');
        if (event === 'PASSWORD_RECOVERY') recordAudit('auth.password_changed');
        // SIGNED_OUT has no JWT to attach, so it's logged from signOut() below.
        setSession(nextSession ?? null);
        setUser(nextSession?.user ?? null);
        setLoading(false);
      }
    );

    return () => {
      mounted = false;
      subscription?.subscription?.unsubscribe?.();
    };
  }, []);

  // Password auth — same-tab UX, no email click-through on the hot path.
  // Inspired by ARIA's flow: sign-in and sign-up both return a session
  // immediately and the user lands authenticated in the same tab.
  const signInWithPassword = async (email, password) => {
    if (!isSupabaseConfigured || !supabase) {
      return { data: null, error: new Error('Supabase not configured') };
    }
    return supabase.auth.signInWithPassword({ email, password });
  };

  const signUpWithPassword = async (email, password) => {
    if (!isSupabaseConfigured || !supabase) {
      return { data: null, error: new Error('Supabase not configured') };
    }
    return supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    });
  };

  // Password reset: send email with a recovery link. The user clicks it,
  // Supabase routes back here with a PASSWORD_RECOVERY auth event, and the
  // Login screen renders its reset-password mode.
  const sendPasswordReset = async (email) => {
    if (!isSupabaseConfigured || !supabase) {
      return { data: null, error: new Error('Supabase not configured') };
    }
    return supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
  };

  const updatePassword = async (password) => {
    if (!isSupabaseConfigured || !supabase) {
      return { data: null, error: new Error('Supabase not configured') };
    }
    return supabase.auth.updateUser({ password });
  };

  // ── 2FA / TOTP ────────────────────────────────────────────
  // Thin wrappers around Supabase Auth MFA. Enabling MFA in the Supabase
  // dashboard (Authentication → Multi-Factor) is a one-time prerequisite.
  const mfaListFactors = async () => {
    if (!supabase) return { data: { totp: [], all: [] }, error: null };
    return supabase.auth.mfa.listFactors();
  };
  const mfaEnroll = async (friendlyName = 'Authenticator') => {
    if (!supabase) return { data: null, error: new Error('Supabase not configured') };
    // Clean up stale unverified factors before enrolling. Supabase rejects
    // a new factor if one with the same friendlyName already exists in *any*
    // status (including 'unverified' from an aborted enroll). Without this,
    // a user who closes the QR modal can never re-enroll until manual cleanup.
    try {
      const list = await supabase.auth.mfa.listFactors();
      const stale = (list?.data?.all || []).filter(
        (f) => f.status !== 'verified' && (f.friendly_name === friendlyName || !f.friendly_name),
      );
      for (const f of stale) {
        await supabase.auth.mfa.unenroll({ factorId: f.id }).catch(() => {});
      }
    } catch { /* best-effort cleanup */ }
    // CRITICAL: pass `issuer` explicitly. Without it, Supabase derives the
    // issuer from the project's Site URL (Auth → URL Configuration). If
    // that Site URL is missing or malformed, the enroll call fails with
    // "Site URL is improperly formatted" before a factor is ever created.
    // Hard-coding the issuer here means MFA works regardless of dashboard
    // config drift, and the authenticator app shows "MIZAN: user@example.com"
    // which is what we want anyway.
    return supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName,
      issuer: 'MIZAN',
    });
  };
  const mfaVerify = async (factorId, code) => {
    if (!supabase) return { data: null, error: new Error('Supabase not configured') };
    const ch = await supabase.auth.mfa.challenge({ factorId });
    if (ch.error) return ch;
    const out = await supabase.auth.mfa.verify({
      factorId,
      challengeId: ch.data.id,
      code,
    });
    if (!out.error) recordAudit('auth.mfa_enrolled', { target: factorId });
    return out;
  };
  const mfaUnenroll = async (factorId) => {
    if (!supabase) return { data: null, error: new Error('Supabase not configured') };
    const out = await supabase.auth.mfa.unenroll({ factorId });
    if (!out.error) recordAudit('auth.mfa_unenrolled', { target: factorId });
    return out;
  };
  const mfaChallengeAndVerify = async (factorId, code) => {
    // Used during sign-in to step from AAL1 → AAL2.
    if (!supabase) return { data: null, error: new Error('Supabase not configured') };
    const ch = await supabase.auth.mfa.challenge({ factorId });
    if (ch.error) return ch;
    return supabase.auth.mfa.verify({
      factorId,
      challengeId: ch.data.id,
      code,
    });
  };
  const mfaAssuranceLevel = async () => {
    if (!supabase) return { data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null };
    return supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  };

  // Legacy alias — old call sites can still call signInWithEmail but it
  // now requires a password. Removed magic-link path entirely.
  const signInWithEmail = signInWithPassword;

  const signOut = async () => {
    // Audit BEFORE killing the session so the JWT is still attached.
    recordAudit('auth.sign_out');
    // Wipe per-user localStorage BEFORE killing the Supabase session.
    // If we let Supabase fire onAuthStateChange first, a fast-mounting
    // Login screen could briefly read the previous user's data.
    clearTrackedLocalState();
    if (!isSupabaseConfigured || !supabase) {
      return { error: null };
    }
    return supabase.auth.signOut();
  };

  const exitRecovery = () => setRecoveryMode(false);

  // Role detection. A user is "root" (glass-break / global admin) if EITHER
  // their email matches the VITE_OWNER_EMAIL build-time constant, OR Supabase
  // has stamped them with `app_metadata.role === 'root'` (server-side, can
  // only be set via service-role key — users can't promote themselves).
  // `user_metadata` is intentionally NOT consulted: that's user-writable.
  const ownerEmail = (import.meta.env.VITE_OWNER_EMAIL || '').trim().toLowerCase();
  const userEmail  = (user?.email || '').toLowerCase();
  const metadataRole = user?.app_metadata?.role || null;
  const isRoot = (
    user?.id === 'single-user'                          // local pass-through mode
    || (ownerEmail && userEmail === ownerEmail)         // configured owner email
    || metadataRole === 'root'                          // Supabase-stamped role
    || metadataRole === 'admin'
  );

  const value = {
    user,
    session,
    loading,
    isRoot,
    recoveryMode,
    exitRecovery,
    signInWithEmail,        // legacy alias for signInWithPassword
    signInWithPassword,
    signUpWithPassword,
    sendPasswordReset,
    updatePassword,
    mfaListFactors,
    mfaEnroll,
    mfaVerify,
    mfaUnenroll,
    mfaChallengeAndVerify,
    mfaAssuranceLevel,
    signOut,
    isSupabaseConfigured,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}
