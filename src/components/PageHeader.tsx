import type { ReactNode } from 'react'
import type { AuthUser } from '../types'

type PageHeaderProps = {
  eyebrow: string
  title: ReactNode
  user: AuthUser
  onLogout: () => void
  // Replaces the default "N XP" meta shown next to the live dot.
  meta?: ReactNode
}

export function PageHeader({ eyebrow, title, user, onLogout, meta }: PageHeaderProps) {
  return <header className="topbar library-topbar">
    <div className="brand-heading"><div className="brand-lockup"><span className="brand-mark" aria-hidden="true">♞</span><span>Replay Lab</span></div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1></div>
    <div className="topbar-meta"><span className="live-dot" /> {meta ?? `${user.xp} XP`}<button className="header-link" onClick={onLogout}>{user.username} · Log out</button></div>
  </header>
}
