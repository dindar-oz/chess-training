import { MainNav } from '../components/MainNav'
import { PageHeader } from '../components/PageHeader'
import firstGameBadge from '../assets/badge-first-game.svg'
import type { AppView, AuthUser, SessionStat } from '../types'

type AwardsViewProps = {
  user: AuthUser
  sessionStats: SessionStat[]
  onNavigate: (view: AppView) => void
  onLogout: () => void
}

export function AwardsView({ user, sessionStats, onNavigate, onLogout }: AwardsViewProps) {
  const firstGameEarned = sessionStats.length > 0
  const earnedAt = firstGameEarned
    ? [...sessionStats].sort((a, b) => a.completedAt.localeCompare(b.completedAt))[0].completedAt
    : null
  return <main className="app-shell awards-screen">
    <PageHeader eyebrow="REPLAY LAB / AWARDS" title={<>Badges<br /><em>you've earned.</em></>} user={user} onLogout={onLogout} />
    <MainNav view="awards" isAdmin={user.role === 'admin'} onNavigate={onNavigate} />
    <section className="badge-grid">
      <div className={`badge-card ${firstGameEarned ? 'earned' : 'locked'}`}>
        <img src={firstGameBadge} alt="1st Game Completed badge" className="badge-image" />
        <h3>1st Game Completed</h3>
        <p>{firstGameEarned ? 'Earned for finishing your first training session.' : 'Complete a training session to unlock this badge.'}</p>
        {firstGameEarned && earnedAt && <span className="badge-earned-date">Earned {new Date(earnedAt).toLocaleDateString()}</span>}
      </div>
    </section>
  </main>
}
