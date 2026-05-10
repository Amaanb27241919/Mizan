import MizanApp from './components/MizanApp.jsx'
import Login from './components/Login.jsx'
import { AuthProvider, useAuth } from './lib/auth.jsx'

function Gate() {
  const { user, loading, isSupabaseConfigured } = useAuth()
  // In pass-through mode (no Supabase env), useAuth returns the synthetic
  // single-user object immediately and we render the app as before.
  if (loading) {
    return <div style={{minHeight:'100vh',background:'#0A0B0F',display:'flex',alignItems:'center',justifyContent:'center',color:'#5C6478',fontFamily:'monospace',fontSize:11}}>Loading…</div>
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
