import { useState } from 'react'
import type { FormEvent } from 'react'
import { readApiResponse } from '../types'
import type { AuthUser } from '../types'

export function AuthView({ onAuthenticated }: { onAuthenticated: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
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

  return <main className="auth-screen"><div className="auth-mark" aria-hidden="true">♞</div><p className="eyebrow">REPLAY LAB / PRIVATE STUDY</p><h1>{mode === 'login' ? 'Welcome back.' : 'Start your record.'}</h1><p className="auth-intro">Your game library is shared. Your training history belongs only to you.</p><form className="auth-form" onSubmit={submit}><label>USERNAME<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required minLength={3} maxLength={32} /></label><label>PASSWORD<input autoComplete={mode === 'login' ? 'current-password' : 'new-password'} type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} /></label><button className="primary-button auth-submit" disabled={busy}>{busy ? 'Please wait...' : mode === 'login' ? 'Log in' : 'Create account'}</button>{message && <p className="auth-message">{message}</p>}</form><button className="text-button auth-switch" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setMessage('') }}>{mode === 'login' ? 'Create a new account →' : 'Already have an account? Log in →'}</button></main>
}
