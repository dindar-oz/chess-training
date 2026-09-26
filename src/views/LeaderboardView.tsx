import { useEffect, useState } from 'react'
import { MainNav } from '../components/MainNav'
import { PageHeader } from '../components/PageHeader'
import type { AppView, AuthUser, LeaderboardEntry } from '../types'

type LeaderboardViewProps = {
  user: AuthUser
  onNavigate: (view: AppView) => void
  onLogout: () => void
}

export function LeaderboardView({ user, onNavigate, onLogout }: LeaderboardViewProps) {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])

  useEffect(() => {
    void fetch('/api/leaderboard')
      .then((response) => response.ok ? response.json() as Promise<LeaderboardEntry[]> : [])
      .then((entries) => setLeaderboard(entries))
  }, [])

  return <main className="app-shell leaderboard-screen">
    <PageHeader eyebrow="REPLAY LAB / LEADERBOARD" title={<>Top<br /><em>learners.</em></>} user={user} onLogout={onLogout} />
    <MainNav view="leaderboard" isAdmin={user.role === 'admin'} onNavigate={onNavigate} />
    <div className="games-table-wrap leaderboard-table-wrap"><table className="games-table"><thead><tr><th>Rank</th><th>User</th><th>XP</th><th>Avg accuracy</th></tr></thead><tbody>{leaderboard.map((entry, index) => <tr key={entry.username} className={entry.username === user.username ? 'leaderboard-self' : ''}><td>{index + 1}</td><td>{entry.username}</td><td>{entry.xp}</td><td>{entry.averageAccuracy === null ? '—' : `${Math.round(entry.averageAccuracy)}%`}</td></tr>)}</tbody></table></div>
    {leaderboard.length === 0 && <div className="empty-library">No users yet.</div>}
  </main>
}
