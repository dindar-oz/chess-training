import { useEffect, useState } from 'react'
import { MainNav } from '../components/MainNav'
import { PageHeader } from '../components/PageHeader'
import { useRealtime } from '../realtime/context'
import type { AppView, AuthUser, LeaderboardEntry } from '../types'

type LeaderboardViewProps = {
  user: AuthUser
  onNavigate: (view: AppView) => void
  onLogout: () => void
}

type SortKey = 'elo' | 'xp'

export function LeaderboardView({ user, onNavigate, onLogout }: LeaderboardViewProps) {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [sortKey, setSortKey] = useState<SortKey>('elo')
  const { onlineUsers } = useRealtime()
  const onlineNames = new Set(onlineUsers.map((onlineUser) => onlineUser.username))
  const sorted = [...leaderboard].sort((a, b) => b[sortKey] - a[sortKey] || a.username.localeCompare(b.username, undefined, { sensitivity: 'base' }))

  useEffect(() => {
    void fetch('/api/leaderboard')
      .then((response) => response.ok ? response.json() as Promise<LeaderboardEntry[]> : [])
      .then((entries) => setLeaderboard(entries))
  }, [])

  return <main className="app-shell leaderboard-screen">
    <PageHeader eyebrow="REPLAY LAB / LEADERBOARD" user={user} onLogout={onLogout} />
    <MainNav view="leaderboard" isAdmin={user.role === 'admin'} onNavigate={onNavigate} />
    <section className="library-toolbar leaderboard-toolbar">
      <div><p className="section-label">RANKING</p><h2>{sortKey === 'elo' ? 'By challenge rating' : 'By training XP'}</h2></div>
      <div className="filter-group"><button className={sortKey === 'elo' ? 'selected' : ''} onClick={() => setSortKey('elo')}>ELO</button><button className={sortKey === 'xp' ? 'selected' : ''} onClick={() => setSortKey('xp')}>XP</button></div>
    </section>
    <div className="games-table-wrap"><table className="games-table"><thead><tr><th>Rank</th><th>User</th><th>ELO</th><th>Rated games</th><th>XP</th><th>Avg accuracy</th></tr></thead><tbody>{sorted.map((entry, index) => <tr key={entry.username} className={entry.username === user.username ? 'leaderboard-self' : ''}><td>{index + 1}</td><td>{onlineNames.has(entry.username) && <span className="online-dot" title="Online" />}{entry.username}</td><td>{entry.elo}{entry.ratedGames === 0 && <span className="provisional" title="No rated challenges yet"> ?</span>}</td><td>{entry.ratedGames}</td><td>{entry.xp}</td><td>{entry.averageAccuracy === null ? '—' : `${Math.round(entry.averageAccuracy)}%`}</td></tr>)}</tbody></table></div>
    {leaderboard.length === 0 && <div className="empty-library">No users yet.</div>}
  </main>
}
