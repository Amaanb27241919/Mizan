import { useEffect, useState } from 'react'
import MizanApp from './components/MizanApp.jsx'
import Login from './components/Login.jsx'
import { AuthProvider, useAuth } from './lib/auth.jsx'
import { hydrateUserState } from './lib/userState.js'

function Gate() {
  const { user, loading, isSupabaseConfigured } = useAuth()
  const [hydrated, setHydrated] = useState(false)

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
        minHeight: '100vh', background: '#0A0B0F',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#5C6478', fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.16em',
      }}>SYNCING…</div>
    )
  }
  if (isSupabaseConfigured && !user) return <Login />
  return <MizanApp />
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}
