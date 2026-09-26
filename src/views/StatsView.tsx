import { useEffect, useState } from 'react'
import { MainNav } from '../components/MainNav'
import { PageHeader } from '../components/PageHeader'
import type { AppView, AuthUser, RatingEvent, SessionStat } from '../types'

type StatsViewProps = {
  user: AuthUser
  sessionStats: SessionStat[]
  onNavigate: (view: AppView) => void
  onLogout: () => void
}

function ordinal(value: number) {
  const suffix = value % 100 >= 11 && value % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][value % 10] ?? 'th'
  return `${value}${suffix}`
}

export function StatsView({ user, sessionStats, onNavigate, onLogout }: StatsViewProps) {
  const [ratingEvents, setRatingEvents] = useState<RatingEvent[]>([])
  const completed = sessionStats.filter((stat) => stat.learnerAccuracy !== null)
  const averageAccuracy = completed.length ? Math.round(completed.reduce((sum, stat) => sum + (stat.learnerAccuracy ?? 0), 0) / completed.length) : 0
  const totalMoves = completed.reduce((sum, stat) => sum + stat.attemptedMoves, 0)
  const totalMatches = completed.reduce((sum, stat) => sum + stat.correctMoves, 0)
  const peakRating = ratingEvents.reduce((peak, event) => Math.max(peak, event.ratingAfter), user.elo)

  useEffect(() => {
    void fetch('/api/ratings')
      .then((response) => response.ok ? response.json() as Promise<RatingEvent[]> : [])
      .then((events) => setRatingEvents(events))
  }, [])

  return <main className="app-shell stats-screen">
    <PageHeader eyebrow="REPLAY LAB / PROGRESS" title={<>Your study<br /><em>record.</em></>} user={user} onLogout={onLogout} />
    <MainNav view="stats" isAdmin={user.role === 'admin'} onNavigate={onNavigate} />
    <section className="stats-summary"><div><span>ELO RATING</span><strong>{user.elo}</strong></div><div><span>TOTAL XP</span><strong>{user.xp}</strong></div><div><span>SESSIONS</span><strong>{completed.length}</strong></div><div><span>AVG ACCURACY</span><strong>{averageAccuracy}%</strong></div><div><span>MOVES ATTEMPTED</span><strong>{totalMoves}</strong></div><div><span>HISTORICAL MATCHES</span><strong>{totalMatches}</strong></div></section>
    <section className="history-section rating-section"><div className="section-heading"><div><p className="section-label">RATING HISTORY</p><h2>Challenges move your rating.</h2></div>{ratingEvents.length > 0 && <span className="rating-peak">PEAK {peakRating}</span>}</div>{ratingEvents.length === 0 ? <div className="empty-library">Your rating starts at {user.elo}. Play a challenge against other members to change it.</div> : <div className="history-list">{ratingEvents.map((event) => <div className="history-row" key={event.id}><div><strong>Challenge</strong><span>{new Date(event.createdAt).toLocaleDateString()} · {event.players} players</span></div><div><strong>{ordinal(event.rank)}</strong><span>PLACE</span></div><div><strong>{event.ratingAfter}</strong><span>RATING</span></div><div><strong className={event.delta >= 0 ? 'rating-gain' : 'rating-loss'}>{event.delta >= 0 ? `+${event.delta}` : event.delta}</strong><span>CHANGE</span></div></div>)}</div>}</section>
    <section className="history-section"><div className="section-heading"><div><p className="section-label">SESSION HISTORY</p><h2>Every game is part of the record.</h2></div><button className="text-button" onClick={() => onNavigate('library')}>Find another game →</button></div>{completed.length === 0 ? <div className="empty-library">Complete a training session to start building your statistics.</div> : <div className="history-list">{completed.map((stat) => <div className="history-row" key={stat.id}><div><strong>{stat.gameTitle}</strong><span>{new Date(stat.completedAt).toLocaleDateString()} · {stat.side === 'w' ? 'White' : 'Black'}{stat.timeControl && ` · ${stat.timeControl}`}{stat.endReason !== 'completed' && <b className="history-timeout"> · {stat.endReason === 'timeout' ? 'Time out' : 'Resigned'}</b>}{stat.id.startsWith('challenge-') && ' · Challenge'}</span></div><div><strong>{stat.learnerAccuracy}%</strong><span>YOUR ACCURACY</span></div><div><strong>{stat.originalAccuracy}%</strong><span>ORIGINAL</span></div><div><strong>{stat.deviations}</strong><span>DEVIATIONS</span></div></div>)}</div>}</section>
  </main>
}
