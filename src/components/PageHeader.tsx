import type { ReactNode } from 'react'
import { useRealtime } from '../realtime/context'
import { SoundToggle } from './SoundToggle'
import type { AuthUser } from '../types'

type PageHeaderProps = {
  eyebrow: string
  title: ReactNode
  user: AuthUser
  onLogout: () => void
  // Replaces the default ELO/XP meta shown next to the live dot.
  meta?: ReactNode
  // Shown under the title.
  subtitle?: ReactNode
}

export function PageHeader({ eyebrow, title, user, onLogout, meta, subtitle }: PageHeaderProps) {
  const { connected, onlineUsers } = useRealtime()
  const onlineNames = onlineUsers.map((onlineUser) => onlineUser.username).join(', ')
  return <header className="topbar library-topbar">
    <div className="brand-heading"><div className="brand-lockup"><span className="brand-mark" aria-hidden="true">♞</span><span>Replay Lab</span></div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{subtitle}</div>
    <div className="topbar-meta"><span className={`live-dot ${connected ? 'connected' : ''}`} title={connected ? 'Live' : 'Reconnecting...'} /> {meta ?? <>{user.elo} ELO <strong>{user.xp} XP</strong></>}<strong className="online-count" title={onlineNames}>{connected ? `${onlineUsers.length} ONLINE` : 'OFFLINE'}</strong><SoundToggle /><button className="header-link" onClick={onLogout}>{user.username} · Log out</button></div>
  </header>
}
