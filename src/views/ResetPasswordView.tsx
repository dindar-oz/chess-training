import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { readApiResponse } from '../types'

// Opened from an admin-issued link (/?reset=<token>) to set a new password.
export function ResetPasswordView({ token, onDone }: { token: string; onDone: () => void }) {
  const [username, setUsername] = useState<string | null>(null)
  const [linkError, setLinkError] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    void fetch('/api/auth/reset/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
      .then(async (response) => {
        const result = await readApiResponse<{ username?: string }>(response)
        if (response.ok && result.username) setUsername(result.username)
        else setLinkError(result.error ?? 'This reset link is not valid.')
      })
      .catch(() => setLinkError('The server did not respond. Please try again in a moment.'))
  }, [token])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (password !== confirmation) {
      setMessage('The two passwords do not match.')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch('/api/auth/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password }) })
      const result = await readApiResponse<{ ok?: boolean }>(response)
      if (!response.ok) throw new Error(result.error ?? 'The password reset failed.')
      setDone(true)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The password reset failed.')
    } finally {
      setBusy(false)
    }
  }

  return <main className="auth-screen"><div className="auth-mark" aria-hidden="true">♞</div><p className="eyebrow">REPLAY LAB / PASSWORD RESET</p>
    <h1>{done ? 'Password updated.' : 'Choose a new password.'}</h1>
    {linkError ? <p className="auth-message">{linkError}</p>
      : username === null ? <p className="auth-intro">Checking your reset link...</p>
      : done ? <p className="auth-intro">The password for <strong>{username}</strong> has been changed, and any other sign-ins were logged out. Log in with your new password.</p>
      : <>
        <p className="auth-intro">Setting a new password for <strong>{username}</strong>. This link works once.</p>
        <form className="auth-form" onSubmit={submit}>
          <input type="text" autoComplete="username" value={username} readOnly hidden />
          <label>NEW PASSWORD<input autoComplete="new-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} /></label>
          <label>REPEAT NEW PASSWORD<input autoComplete="new-password" type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required minLength={8} /></label>
          <button className="primary-button auth-submit" disabled={busy}>{busy ? 'Please wait...' : 'Set new password'}</button>
          {message && <p className="auth-message">{message}</p>}
        </form>
      </>}
    <button className="text-button auth-switch" onClick={onDone}>{done ? 'Go to log in →' : '← Back to log in'}</button>
  </main>
}
