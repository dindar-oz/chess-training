import { MainNav } from '../components/MainNav'
import { PageHeader } from '../components/PageHeader'
import type { AppView, AuthUser, SessionStat } from '../types'

type StatsViewProps = {
  user: AuthUser
  sessionStats: SessionStat[]
  onNavigate: (view: AppView) => void
  onLogout: () => void
}

export function StatsView({ user, sessionStats, onNavigate, onLogout }: StatsViewProps) {
  const completed = sessionStats.filter((stat) => stat.learnerAccuracy !== null)
  const averageAccuracy = completed.length ? Math.round(completed.reduce((sum, stat) => sum + (stat.learnerAccuracy ?? 0), 0) / completed.length) : 0
  const totalMoves = completed.reduce((sum, stat) => sum + stat.attemptedMoves, 0)
  const totalMatches = completed.reduce((sum, stat) => sum + stat.correctMoves, 0)
  return <main className="app-shell stats-screen">
    <PageHeader eyebrow="REPLAY LAB / PROGRESS" title={<>Your study<br /><em>record.</em></>} user={user} onLogout={onLogout} />
    <MainNav view="stats" isAdmin={user.role === 'admin'} onNavigate={onNavigate} />
    <section className="stats-summary"><div><span>TOTAL XP</span><strong>{user.xp}</strong></div><div><span>SESSIONS</span><strong>{completed.length}</strong></div><div><span>AVG ACCURACY</span><strong>{averageAccuracy}%</strong></div><div><span>MOVES ATTEMPTED</span><strong>{totalMoves}</strong></div><div><span>HISTORICAL MATCHES</span><strong>{totalMatches}</strong></div></section>
    <section className="history-section"><div className="section-heading"><div><p className="section-label">SESSION HISTORY</p><h2>Every game is part of the record.</h2></div><button className="text-button" onClick={() => onNavigate('library')}>Find another game →</button></div>{completed.length === 0 ? <div className="empty-library">Complete a training session to start building your statistics.</div> : <div className="history-list">{completed.map((stat) => <div className="history-row" key={stat.id}><div><strong>{stat.gameTitle}</strong><span>{new Date(stat.completedAt).toLocaleDateString()} · {stat.side === 'w' ? 'White' : 'Black'}</span></div><div><strong>{stat.learnerAccuracy}%</strong><span>YOUR ACCURACY</span></div><div><strong>{stat.originalAccuracy}%</strong><span>ORIGINAL</span></div><div><strong>{stat.deviations}</strong><span>DEVIATIONS</span></div></div>)}</div>}</section>
  </main>
}
