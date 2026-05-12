import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/react'
import App from './App.jsx'

// Initialize Sentry BEFORE rendering so any setup error gets captured.
// No-op when VITE_SENTRY_DSN is unset. PII is scrubbed via beforeSend.
const SENTRY_DSN = (import.meta.env.VITE_SENTRY_DSN || '').trim()
if (SENTRY_DSN) {
  const PII_KEYS = new Set([
    'email', 'password', 'usersecret', 'user_secret',
    'access_token', 'accesstoken', 'refresh_token', 'refreshtoken',
    'api_key', 'apikey',
    'authorization', 'cookie', 'set-cookie',
  ])
  const scrub = (obj, depth = 0) => {
    if (!obj || typeof obj !== 'object' || depth > 6) return obj
    for (const k of Object.keys(obj)) {
      if (PII_KEYS.has(k.toLowerCase())) { obj[k] = '[redacted]'; continue }
      if (obj[k] && typeof obj[k] === 'object') scrub(obj[k], depth + 1)
      else if (typeof obj[k] === 'string' &&
               /sk-[a-z0-9_-]{20,}|Bearer\s+[\w.-]{20,}|^eyJ[\w._-]{40,}/.test(obj[k])) {
        obj[k] = '[redacted]'
      }
    }
    return obj
  }
  Sentry.init({
    dsn:              SENTRY_DSN,
    environment:      import.meta.env.MODE,
    release:          import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA?.slice(0, 12),
    tracesSampleRate: 0.1,
    sendDefaultPii:   false,
    beforeSend(event) {
      if (event.request) {
        if (event.request.headers) scrub(event.request.headers)
        if (event.request.data)    scrub(event.request.data)
      }
      if (event.extra)    scrub(event.extra)
      if (event.contexts) scrub(event.contexts)
      if (event.tags)     scrub(event.tags)
      // Hash-only user identification — never upload raw email.
      if (event.user?.email) event.user = { id: event.user.id }
      return event
    },
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
