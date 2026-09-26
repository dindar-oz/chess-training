import { useState } from 'react'
import { useRealtimeEvent } from '../realtime/context'
import { play } from '../sounds'

// Tells online admins, on any screen, that someone asked for a password reset.
export function AdminNotices({ onOpenAdmin }: { onOpenAdmin: () => void }) {
  const [usernames, setUsernames] = useState<string[]>([])

  useRealtimeEvent('password_reset_request', (data) => {
    const { username } = data as { username: string }
    play('notify')
    setUsernames((previous) => previous.includes(username) ? previous : [...previous, username])
  })

  if (usernames.length === 0) return null
  return <div className="toast-stack admin-notices" aria-live="polite">
    <div className="toast notice-toast">
      <p className="section-label">PASSWORD RESET</p>
      <strong>{usernames.join(', ')} asked for a password reset</strong>
      <div className="toast-actions">
        <button className="primary-button" onClick={() => { setUsernames([]); onOpenAdmin() }}>Open Admin</button>
        <button className="table-action secondary" onClick={() => setUsernames([])}>Dismiss</button>
      </div>
    </div>
  </div>
}
