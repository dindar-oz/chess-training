import { useState } from 'react'
import type { FormEvent } from 'react'
import { readApiResponse } from '../types'
import type { AuthUser } from '../types'

type AuthMode = 'login' | 'register' | 'forgot'

const headings: Record<AuthMode, string> = {
  login: 'Welcome back.',
  register: 'Start your record.',
  forgot: 'Forgot your password?',
}

export function AuthView({ onAuthenticated }: { onAuthenticated: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<AuthMode>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  function switchMode(next: AuthMode) {
    setMode(next)
    setMessage('')
    setNotice('')
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    setNotice('')
    try {
      if (mode === 'forgot') {
        const response = await fetch('/api/auth/forgot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username }) })
        const result = await readApiResponse<{ ok?: boolean }>(response)
        if (!response.ok) throw new Error(result.error ?? 'The request failed. Please try again in a moment.')
        setNotice('Request sent. If that account exists, an admin has been asked to reset it and will send you a reset link.')
        return
      }
      const response = await fetch(`/api/auth/${mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })
      const result = await readApiResponse<{ user?: AuthUser }>(response)
      if (!response.ok || !result.user) throw new Error(result.error ?? 'The server did not respond. Please try again in a moment.')
      setPassword('')
      onAuthenticated(result.user)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Authentication failed.')
    } finally {
      setBusy(false)
    }
  }

  const submitLabel = mode === 'login' ? 'Log in' : mode === 'register' ? 'Create account' : 'Ask an admin to reset it'
  return <main className="auth-screen"><div className="auth-mark" aria-hidden="true">♞</div><p className="eyebrow">REPLAY LAB / PRIVATE STUDY</p><h1>{headings[mode]}</h1>
    <p className="auth-intro">{mode === 'forgot' ? "Enter your username. An admin will get your request and send you a one-time link to set a new password." : 'Your game library is shared. Your training history belongs only to you.'}</p>
    <form className="auth-form" onSubmit={submit}>
      <label>USERNAME<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required minLength={3} maxLength={32} /></label>
      {mode !== 'forgot' && <label>PASSWORD<input autoComplete={mode === 'login' ? 'current-password' : 'new-password'} type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} /></label>}
      <button className="primary-button auth-submit" disabled={busy || (mode === 'forgot' && notice !== '')}>{busy ? 'Please wait...' : submitLabel}</button>
      {message && <p className="auth-message">{message}</p>}
      {notice && <p className="auth-notice">{notice}</p>}
    </form>
    {mode === 'login' && <button className="text-button auth-switch" onClick={() => switchMode('forgot')}>Forgot my password</button>}
    <button className="text-button auth-switch" onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'Create a new account →' : mode === 'register' ? 'Already have an account? Log in →' : '← Back to log in'}</button>
  </main>
}
