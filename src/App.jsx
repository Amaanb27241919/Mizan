import { useEffect, useState } from 'react'
import * as Sentry from '@sentry/react'
import MizanApp from './components/MizanApp.jsx'
import Login from './components/Login.jsx'
import Privacy from './components/Privacy.jsx'
import Terms from './components/Terms.jsx'
import { AuthProvider, useAuth } from './lib/auth.jsx'
import { hydrateUserState } from './lib/userState.js'

// Dark-themed fallback shown when an unhandled error escapes a child
// component tree. Matches MIZAN's palette (no T-tokens — those live in
// MizanApp.jsx and we want this to render even when MizanApp crashed).
function SentryFallback({ resetError }) {
  return (
    <div style={{
      minHeight: '100vh', background: '#0B0F1E',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24, fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{
        maxWidth: 480, width: '100%', background: '#0E1216',
        border: '1px solid #1F2530', borderRadius: 14, padding: '28px 32px',
        textAlign: 'center', color: '#E7E9EC',
      }}>
        <div style={{ fontSize: 11, color: '#5C6478', letterSpacing: '0.18em', fontWeight: 600, marginBottom: 12 }}>MIZAN — SOMETHING WENT WRONG</div>
        <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>The page hit an unexpected error.</div>
        <div style={{ fontSize: 13, color: '#7C8597', lineHeight: 1.6, marginBottom: 20 }}>
          The error has been reported automatically. You can try again — most issues clear with a refresh.
        </div>
        <button onClick={() => { try { resetError() } catch {} window.location.reload() }} style={{
          padding: '10px 22px', borderRadius: 8, border: 'none',
          background: '#1E90FF', color: '#fff', cursor: 'pointer',
          fontFamily: 'inherit', fontSize: 13, fontWeight: 600, letterSpacing: '0.04em',
        }}>Refresh</button>
      </div>
    </div>
  )
}

function Gate() {
  const { user, loading, isSupabaseConfigured, recoveryMode } = useAuth()
  const [hydrated, setHydrated] = useState(false)

  // Clean up any stray auth hash from the URL once we have a session.
  // Supabase password-reset links land with #access_token=... — strip it so
  // the address bar stays clean.
  useEffect(() => {
    if (!user || user.id === 'single-user') return
    if (window.location.hash.includes('access_token=') || window.location.hash.includes('error=')) {
      window.history.replaceState({}, '', window.location.pathname + window.location.search)
    }
  }, [user?.id])

  // Pull per-user state from Postgres into localStorage BEFORE MizanApp mounts,
  // so its component state initializers (which read localStorage synchronously)
  // see the user's actual data instead of a blank slate from another device.
  useEffect(() => {
    if (loading) return
    if (!isSupabaseConfigured || !user || user.id === 'single-user') {
      setHydrated(true)
      return
    }
    let cancelled = false
    hydrateUserState(user.id).finally(() => { if (!cancelled) setHydrated(true) })
    return () => { cancelled = true }
  }, [loading, isSupabaseConfigured, user?.id])

  if (loading || !hydrated) {
    return (
      <div style={{
        minHeight: '100vh', background: '#0B0F1E',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#5C6478', fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.16em',
      }}>SYNCING…</div>
    )
  }
  if (isSupabaseConfigured && !user) return <Login />
  // Password-reset link from email lands here with a temporary session AND
  // a PASSWORD_RECOVERY auth event — show the reset-password UI before the
  // app, otherwise the user would silently land authenticated without ever
  // setting their new password.
  if (isSupabaseConfigured && recoveryMode) return <Login />
  // key={user.id} forces a full unmount/remount on user-change so every
  // useState initializer that reads localStorage re-runs against the
  // freshly-hydrated (or cleared) cache — prevents the previous user's
  // imports, holdings, watchlist, etc. from rendering for a new account.
  return <MizanApp key={user?.id || 'anonymous'} />
}

// Render public legal pages BEFORE any auth / app initialization so they
// are always reachable. Plaid's compliance review and search crawlers must
// be able to load these without a logged-in session.
function publicLegalRoute() {
  if (typeof window === 'undefined') return null
  const p = window.location.pathname.replace(/\/+$/, '').toLowerCase()
  if (p === '/privacy' || p === '/privacy-policy') return <Privacy />
  if (p === '/terms' || p === '/terms-of-service' || p === '/tos') return <Terms />
  return null
}

export default function App() {
  const legal = publicLegalRoute()
  if (legal) {
    return (
      <Sentry.ErrorBoundary fallback={({ resetError }) => <SentryFallback resetError={resetError} />}>
        {legal}
      </Sentry.ErrorBoundary>
    )
  }
  return (
    <Sentry.ErrorBoundary fallback={({ resetError }) => <SentryFallback resetError={resetError} />}>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </Sentry.ErrorBoundary>
  )
}
