import { PageHeader } from '../components/PageHeader'
import adminImage from '../assets/dashboard/admin.svg'
import awardsImage from '../assets/dashboard/awards.svg'
import challengesImage from '../assets/dashboard/challenges.svg'
import leaderboardImage from '../assets/dashboard/leaderboard.svg'
import libraryImage from '../assets/dashboard/library.svg'
import statsImage from '../assets/dashboard/stats.svg'
import type { AppView, AuthUser } from '../types'

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
  sessionCount: number
  onNavigate: (view: AppView) => void
  onLogout: () => void
}

// The main page: one large button per section of the app.
export function HomeView({ user, sessionCount, onNavigate, onLogout }: HomeViewProps) {
  const isAdmin = user.role === 'admin'
  return <main className="app-shell home-screen">
    <PageHeader eyebrow="REPLAY LAB / HOME" title={<>Study the<br /><em>great games.</em></>} user={user} onLogout={onLogout} meta={<>{sessionCount} SESSIONS <strong>{user.elo} ELO</strong><strong>{user.xp} XP</strong></>} />
    <nav className="dashboard-grid" aria-label="Sections">
      {tiles.filter((tile) => isAdmin || !tile.adminOnly).map((tile) => <button key={tile.view} className={`dashboard-tile tone-${tile.tone}`} onClick={() => onNavigate(tile.view)}>
        <span className="dashboard-art"><img src={tile.image} alt="" /></span>
        <span className="dashboard-text">
          <strong>{tile.title}</strong>
          <span>{tile.description}</span>
        </span>
        <span className="dashboard-arrow" aria-hidden="true">→</span>
      </button>)}
    </nav>
  </main>
}
