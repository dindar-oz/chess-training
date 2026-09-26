import { useCallback, useEffect, useState } from 'react'
import { MainNav } from '../components/MainNav'
import { PageHeader } from '../components/PageHeader'
import { PgnImportPanel } from '../components/PgnImportPanel'
import { useRealtimeEvent } from '../realtime/context'
import { readApiResponse } from '../types'
import type { AdminUser, AppView, AuthUser } from '../types'

type AdminViewProps = {
  user: AuthUser
  gameCount: number
  onImportFinished: () => void
  onNavigate: (view: AppView) => void
  onLogout: () => void
}

type UserAction = 'disable' | 'enable' | 'promote' | 'demote' | 'delete'
type ResetRequest = { id: string; userId: string; username: string; requestedAt: string }
type ResetLink = { username: string; url: string; expiresAt: string }

export function AdminView({ user, gameCount, onImportFinished, onNavigate, onLogout }: AdminViewProps) {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [busyUserId, setBusyUserId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [resetRequests, setResetRequests] = useState<ResetRequest[]>([])
  const [resetLink, setResetLink] = useState<ResetLink | null>(null)
  const [copied, setCopied] = useState(false)

  const loadUsers = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/users')
      const result = await readApiResponse<AdminUser[]>(response)
      if (!response.ok) throw new Error(result.error ?? 'Could not load users.')
      setUsers(result)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load users.')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadResetRequests = useCallback(async () => {
    const response = await fetch('/api/admin/password-resets')
    if (response.ok) setResetRequests(await response.json() as ResetRequest[])
  }, [])

  useEffect(() => { void loadUsers() }, [loadUsers])
  useEffect(() => { void loadResetRequests() }, [loadResetRequests])
  useRealtimeEvent('password_reset_request', () => { void loadResetRequests() })

  // The link is shown once: the server keeps only a hash of its token.
  async function createResetLink(userId: string, username: string) {
    if (!window.confirm(`Create a one-time password reset link for ${username}? Any earlier unused link for them stops working.`)) return
    setBusyUserId(userId)
    setError('')
    setCopied(false)
    try {
      const response = await fetch(`/api/admin/users/${userId}/reset-link`, { method: 'POST' })
      const result = await readApiResponse<{ token?: string; expiresAt?: string }>(response)
      if (!response.ok || !result.token || !result.expiresAt) throw new Error(result.error ?? 'Could not create the reset link.')
      setResetLink({ username, url: `${window.location.origin}/?reset=${result.token}`, expiresAt: result.expiresAt })
      await loadResetRequests()
    } catch (linkError) {
      setError(linkError instanceof Error ? linkError.message : 'Could not create the reset link.')
    } finally {
      setBusyUserId(null)
    }
  }

  async function dismissResetRequest(requestId: string) {
    await fetch(`/api/admin/password-resets/${requestId}/dismiss`, { method: 'POST' })
    await loadResetRequests()
  }

  async function copyResetLink() {
    if (!resetLink) return
    try {
      await navigator.clipboard.writeText(resetLink.url)
      setCopied(true)
    } catch {
      setError('Copying failed. Select the link and copy it manually.')
    }
  }

  async function runAction(target: AdminUser, action: UserAction) {
    if (action === 'delete' && !window.confirm(`Permanently delete ${target.username}? Their training history and XP will be removed. This cannot be undone.`)) return
    if (action === 'disable' && !window.confirm(`Disable ${target.username}? They will be logged out and unable to log in.`)) return
    setBusyUserId(target.id)
    setError('')
    try {
      const url = `/api/admin/users/${target.id}${action === 'delete' ? '' : action === 'promote' || action === 'demote' ? '/role' : `/${action}`}`
      const response = await fetch(url, {
        method: action === 'delete' ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: action === 'promote' || action === 'demote' ? JSON.stringify({ role: action === 'promote' ? 'admin' : 'user' }) : undefined,
      })
      const result = await readApiResponse<{ ok?: boolean }>(response)
      if (!response.ok) throw new Error(result.error ?? 'The action failed.')
      await loadUsers()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The action failed.')
    } finally {
      setBusyUserId(null)
    }
  }

  const activeCount = users.filter((entry) => !entry.disabledAt).length
  const adminCount = users.filter((entry) => entry.role === 'admin').length

  return <main className="app-shell admin-screen">
    <PageHeader eyebrow="REPLAY LAB / ADMIN" title={<>Run the<br /><em>club.</em></>} user={user} onLogout={onLogout} meta={<>{gameCount} GAMES <strong>{users.length} USERS</strong></>} />
    <MainNav view="admin" isAdmin onNavigate={onNavigate} />
    <section className="stats-summary admin-summary"><div><span>USERS</span><strong>{users.length}</strong></div><div><span>ACTIVE</span><strong>{activeCount}</strong></div><div><span>DISABLED</span><strong>{users.length - activeCount}</strong></div><div><span>ADMINS</span><strong>{adminCount}</strong></div><div><span>GAMES</span><strong>{gameCount}</strong></div></section>
    {(resetRequests.length > 0 || resetLink) && <section className="history-section reset-section">
      <div className="section-heading"><div><p className="section-label">PASSWORD RESETS</p><h2>Members locked out.</h2></div></div>
      {resetLink && <div className="reset-link-box">
        <p>Send this link to <strong>{resetLink.username}</strong>. It works once and expires {new Date(resetLink.expiresAt).toLocaleString()}. It won't be shown again.</p>
        <div className="reset-link-row"><input readOnly value={resetLink.url} onFocus={(event) => event.target.select()} aria-label="Reset link" /><button className="primary-button" onClick={() => void copyResetLink()}>{copied ? 'Copied' : 'Copy link'}</button><button className="text-button" onClick={() => setResetLink(null)}>Done</button></div>
      </div>}
      {resetRequests.length > 0 && <div className="history-list">{resetRequests.map((request) => <div className="reset-request" key={request.id}>
        <div><strong>{request.username}</strong><span>Asked {new Date(request.requestedAt).toLocaleString()}</span></div>
        <div className="row-actions"><button className="table-action" disabled={busyUserId === request.userId} onClick={() => void createResetLink(request.userId, request.username)}>Create reset link</button><button className="table-action secondary" onClick={() => void dismissResetRequest(request.id)}>Dismiss</button></div>
      </div>)}</div>}
    </section>}
    <section className="history-section">
      <div className="section-heading"><div><p className="section-label">USER MANAGEMENT</p><h2>Members of the club.</h2></div></div>
      {error && <p className="admin-error">{error}</p>}
      {loading ? <div className="empty-library">Loading users...</div> : <div className="games-table-wrap"><table className="games-table admin-table"><thead><tr><th>User</th><th>Role</th><th>Status</th><th>ELO</th><th>XP</th><th>Sessions</th><th>Joined</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{users.map((entry) => {
        const isSelf = entry.id === user.id
        const busy = busyUserId === entry.id
        return <tr key={entry.id} className={entry.disabledAt ? 'admin-row-disabled' : ''}>
          <td><strong>{entry.username}</strong><span>{entry.lastTrainedAt ? `Last trained ${new Date(entry.lastTrainedAt).toLocaleDateString()}` : 'No sessions yet'}</span></td>
          <td><b className={`role-badge ${entry.role}`}>{entry.role}</b></td>
          <td>{entry.disabledAt ? <span className="status-disabled">Disabled {new Date(entry.disabledAt).toLocaleDateString()}</span> : 'Active'}</td>
          <td>{entry.elo}</td>
          <td>{entry.xp}</td>
          <td>{entry.sessions}</td>
          <td>{new Date(entry.createdAt).toLocaleDateString()}</td>
          <td>{isSelf ? <span className="admin-note">You</span> : entry.locked ? <span className="admin-note" title="Set by the ADMIN_USERNAMES environment variable">Locked admin</span> : <div className="row-actions">
            <button className="table-action secondary" disabled={busy} onClick={() => void runAction(entry, entry.role === 'admin' ? 'demote' : 'promote')}>{entry.role === 'admin' ? 'Make user' : 'Make admin'}</button>
            <button className="table-action secondary" disabled={busy} onClick={() => void runAction(entry, entry.disabledAt ? 'enable' : 'disable')}>{entry.disabledAt ? 'Enable' : 'Disable'}</button>
            {!entry.disabledAt && <button className="table-action secondary" disabled={busy} onClick={() => void createResetLink(entry.id, entry.username)}>Reset password</button>}
            <button className="table-action danger" disabled={busy} onClick={() => void runAction(entry, 'delete')}>Delete</button>
          </div>}</td>
        </tr>
      })}</tbody></table></div>}
    </section>
    <PgnImportPanel onImportFinished={onImportFinished} />
  </main>
}
