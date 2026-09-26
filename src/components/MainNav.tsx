import type { AppView } from '../types'

const navItems: Array<{ view: AppView; icon: string; label: string; adminOnly?: boolean }> = [
  { view: 'library', icon: '♜', label: 'Game library' },
  { view: 'stats', icon: '↗', label: 'My statistics' },
  { view: 'awards', icon: '🏅', label: 'Awards' },
  { view: 'leaderboard', icon: '☰', label: 'Leaderboard' },
  { view: 'admin', icon: '⚙', label: 'Admin', adminOnly: true },
]

type MainNavProps = {
  view: AppView
  isAdmin: boolean
  onNavigate: (view: AppView) => void
  className?: string
}

export function MainNav({ view, isAdmin, onNavigate, className }: MainNavProps) {
  return <nav className={`main-nav ${className ?? ''}`}>
    {navItems.filter((item) => isAdmin || !item.adminOnly).map((item) => <button key={item.view} className={item.view === view ? 'nav-active' : ''} onClick={() => onNavigate(item.view)}><span aria-hidden="true">{item.icon}</span> {item.label}</button>)}
  </nav>
}
