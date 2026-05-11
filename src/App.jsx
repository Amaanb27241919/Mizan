import { useEffect, useState } from 'react'
import MizanApp from './components/MizanApp.jsx'
import Login from './components/Login.jsx'
import { AuthProvider, useAuth } from './lib/auth.jsx'
import { hydrateUserState } from './lib/userState.js'

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

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}
