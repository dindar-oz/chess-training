import { useCallback, useEffect, useState } from 'react'
import { badgeDefinitions } from '../../shared/badges.ts'
import { levelProgress } from '../../shared/levels.ts'
import { useBadges } from '../badges/context'
import { useChallenges } from '../challenges/context'
import { PageHeader } from '../components/PageHeader'
import { useRealtime, useRealtimeEvent } from '../realtime/context'
import adminImage from '../assets/dashboard/admin.svg'
import awardsImage from '../assets/dashboard/awards.svg'
import challengesImage from '../assets/dashboard/challenges.svg'
import leaderboardImage from '../assets/dashboard/leaderboard.svg'
import libraryImage from '../assets/dashboard/library.svg'
import statsImage from '../assets/dashboard/stats.svg'
import type { AppView, AuthUser, GameRecord, LeaderboardEntry, SessionStat } from '../types'

type Tile = { view: AppView; title: string; description: string; image: string; tone: string; adminOnly?: boolean }

const tiles: Tile[] = [
  { view: 'library', title: 'Game Library', description: 'Browse the master games and train by replaying them move by move.', image: libraryImage, tone: 'green' },
  { view: 'challenges', title: 'Challenges', description: 'Invite online players to replay the same mystery game against the clock.', image: challengesImage, tone: 'red' },
  { view: 'stats', title: 'My Statistics', description: 'Your sessions, accuracy and progress over time.', image: statsImage, tone: 'blue' },
  { view: 'awards', title: 'Awards', description: "The badges you've earned and the ones still to unlock.", image: awardsImage, tone: 'amber' },
  { view: 'leaderboard', title: 'Leaderboard', description: 'See where you rank by ELO and XP.', image: leaderboardImage, tone: 'violet' },
  { view: 'admin', title: 'Admin Panel', description: 'Manage users, password resets and the game library.', image: adminImage, tone: 'ink', adminOnly: true },
]

type HomeViewProps = {
  user: AuthUser
  games: GameRecord[]
  // Newest first.
  sessionStats: SessionStat[]
  onNavigate: (view: AppView) => void
  onTrain: (gameId: string) => void
  onLogout: () => void
}

function plural(count: number, word: string) {
  return `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`
}

// The main page: one large button per section of the app, each with a live figure.
export function HomeView({ user, games, sessionStats, onNavigate, onTrain, onLogout }: HomeViewProps) {
  const isAdmin = user.role === 'admin'
  const { connected, onlineUsers } = useRealtime()
  const { invitations } = useChallenges()
  const { earned, loaded: badgesLoaded } = useBadges()
  const [eloRank, setEloRank] = useState<number | null>(null)
  const [resetRequestCount, setResetRequestCount] = useState<number | null>(null)

  useEffect(() => {
    void fetch('/api/leaderboard')
      .then((response) => response.ok ? response.json() as Promise<LeaderboardEntry[]> : [])
      .then((entries) => {
        // Same order as the leaderboard's ELO ranking.
        const sorted = [...entries].sort((a, b) => b.elo - a.elo || a.username.localeCompare(b.username, undefined, { sensitivity: 'base' }))
        const index = sorted.findIndex((entry) => entry.username === user.username)
        setEloRank(index === -1 ? null : index + 1)
      })
      .catch(() => undefined)
  }, [user.username])

  const loadResetRequests = useCallback(() => {
    if (!isAdmin) return
    void fetch('/api/admin/password-resets')
      .then((response) => response.ok ? response.json() as Promise<unknown[]> : null)
      .then((requests) => { if (requests) setResetRequestCount(requests.length) })
      .catch(() => undefined)
  }, [isAdmin])

  useEffect(() => { loadResetRequests() }, [loadResetRequests])
  useRealtimeEvent('password_reset_request', loadResetRequests)

  const figures: Partial<Record<AppView, string>> = {
    library: plural(games.length, 'game'),
    challenges: invitations.length > 0 ? plural(invitations.length, 'invitation') : connected ? `${onlineUsers.length} online` : undefined,
    stats: plural(sessionStats.length, 'session'),
    awards: badgesLoaded ? `${earned.length} of ${badgeDefinitions.length} badges` : undefined,
    leaderboard: eloRank === null ? undefined : `#${eloRank} by ELO`,
    admin: resetRequestCount === null ? undefined : resetRequestCount === 0 ? 'No reset requests' : `${plural(resetRequestCount, 'reset request')} waiting`,
  }

  const lastSession = sessionStats[0]
  const lastGame = lastSession && games.find((game) => game.id === lastSession.gameId)
  const level = levelProgress(user.xp)

  function trainRandomGame() {
    const game = games[Math.floor(Math.random() * games.length)]
    if (game) onTrain(game.id)
  }

  return <main className="app-shell home-screen">
    <PageHeader
      eyebrow="REPLAY LAB / HOME"
      title={<>{sessionStats.length > 0 ? 'Welcome back, ' : 'Welcome, '}<em>{user.username}.</em></>}
      subtitle={<div className="level-progress">
        <strong>LEVEL {level.level}</strong>
        <span className="level-bar" role="progressbar" aria-label={`Progress to level ${level.level + 1}`} aria-valuemin={0} aria-valuemax={level.xpForNext} aria-valuenow={level.xpIntoLevel}><span style={{ width: `${(100 * level.xpIntoLevel) / level.xpForNext}%` }} /></span>
        <span>{level.xpToNext} XP TO LEVEL {level.level + 1}</span>
      </div>}
      user={user}
      onLogout={onLogout}
      meta={<>{sessionStats.length} SESSIONS <strong>{user.elo} ELO</strong><strong>{user.xp} XP</strong></>}
    />
    <section className="home-quickstart" aria-label="Quick start">
      {lastSession && lastGame && <button className="continue-strip" onClick={() => onTrain(lastGame.id)}>
        <span className="section-label">CONTINUE</span>
        <span className="continue-text"><strong>{lastGame.title}</strong><span>as {lastSession.side === 'w' ? 'White' : 'Black'} · {lastSession.correctMoves} of {lastSession.attemptedMoves} moves matched</span></span>
        <span className="continue-action">Train again →</span>
      </button>}
      <button className="random-game-button" disabled={games.length === 0} onClick={trainRandomGame}><span aria-hidden="true">⚄</span> Train a random game</button>
    </section>
    <nav className="dashboard-grid" aria-label="Sections">
      {tiles.filter((tile) => isAdmin || !tile.adminOnly).map((tile) => {
        const alert = tile.view === 'challenges' && invitations.length > 0
        return <button key={tile.view} className={`dashboard-tile tone-${tile.tone}${alert ? ' has-alert' : ''}`} onClick={() => onNavigate(tile.view)}>
          {alert && <span className="dashboard-alert" aria-hidden="true" />}
          <span className="dashboard-art"><img src={tile.image} alt="" /></span>
          <span className="dashboard-text">
            <strong>{tile.title}</strong>
            {figures[tile.view] && <small className="dashboard-figure">{figures[tile.view]}</small>}
            <span className="dashboard-description">{tile.description}</span>
          </span>
          <span className="dashboard-arrow" aria-hidden="true">→</span>
        </button>
      })}
    </nav>
  </main>
}
