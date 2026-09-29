import { useCallback, useEffect, useState } from 'react'
import { AdminView } from './views/AdminView'
import { AuthView } from './views/AuthView'
import { AwardsView } from './views/AwardsView'
import { HomeView } from './views/HomeView'
import { LeaderboardView } from './views/LeaderboardView'
import { LibraryView } from './views/LibraryView'
import { StatsView } from './views/StatsView'
import { TrainingView } from './views/TrainingView'
import { RealtimeProvider } from './realtime/RealtimeProvider'
import { ChallengeProvider } from './challenges/ChallengeProvider'
import { InvitationToasts } from './challenges/InvitationToasts'
import { ChallengesView } from './views/ChallengesView'
import { ResetPasswordView } from './views/ResetPasswordView'
import { AdminNotices } from './components/AdminNotices'
import { BadgeProvider } from './badges/BadgeProvider'
import { UpdateBanner } from './components/UpdateBanner'
import { readStored, writeStored } from './storage'
import { readApiResponse } from './types'
import type { AppView, AuthUser, GameFilter, GameRecord, SessionStat } from './types'
import './App.css'

const samplePgn = `[Event "Training Game"]
[Site "London"]
[Date "1851.06.21"]
[White "Adolf Anderssen"]
[Black "Lionel Kieseritzky"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. b4 Bxb4 5. c3 Ba5 6. d4 exd4
7. O-O d3 8. Qb3 Qf6 9. e5 Qg6 10. Re1 Nge7 11. Ba3 b5 12. Qxb5 Rb8
13. Qa4 Bb6 14. Nbd2 Bb7 15. Ne4 Qf5 16. Bxd3 Qh5 17. Nf6+ gxf6
18. exf6 Rg8 19. Rad1 Qxf3 20. Rxe7+ Nxe7 21. Qxd7+ Kxd7 22. Bf5+ Ke8
23. Bd7+ Kf8 24. Bxe7# 1-0`

const sampleGame: GameRecord = {
  id: 'immortal-game',
  title: 'The Immortal Game',
  white: 'Adolf Anderssen',
  black: 'Lionel Kieseritzky',
  event: 'Training Game',
  date: '1851.06.21',
  result: '1-0',
  pgn: samplePgn,
  plyCount: 47,
}

function App() {
  const [view, setView] = useState<AppView>('home')
  const [games, setGames] = useState<GameRecord[]>(() => readStored('chess-training-games', [sampleGame]))
  const [sessionStats, setSessionStats] = useState<SessionStat[]>([])
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [authChecked, setAuthChecked] = useState(false)
  // Set when the page was opened from an admin-issued password reset link.
  const [resetToken] = useState(() => new URLSearchParams(window.location.search).get('reset'))
  const [selectedGameId, setSelectedGameId] = useState(sampleGame.id)
  const [searchQuery, setSearchQuery] = useState('')
  const [gameFilter, setGameFilter] = useState<GameFilter>('all')
  const [gamePage, setGamePage] = useState(1)
  const [gameLoading, setGameLoading] = useState(false)
  // Bumped on every "Train" click so the training view remounts with a fresh session.
  const [trainingKey, setTrainingKey] = useState(0)
  const selectedGame = games.find((game) => game.id === selectedGameId) ?? games[0] ?? sampleGame

  useEffect(() => {
    writeStored('chess-training-games', games)
  }, [games])

  useEffect(() => {
    void fetch('/api/auth/me')
      .then((response) => response.ok ? response.json() as Promise<{ user: AuthUser | null }> : { user: null })
      .then(({ user }) => setAuthUser(user))
      .catch(() => setAuthUser(null))
      .finally(() => setAuthChecked(true))
  }, [])

  useEffect(() => {
    if (!authUser) {
      setSessionStats([])
      return
    }
    void fetch('/api/stats')
      .then((response) => response.ok ? response.json() as Promise<SessionStat[]> : [])
      .then((stats) => setSessionStats(stats))
  }, [authUser])

  // Game metadata only; each PGN is fetched when the game is opened for training.
  const loadGames = useCallback(() => {
    void fetch('/api/games')
      .then((response) => response.ok ? response.json() as Promise<Array<Omit<GameRecord, 'pgn'> & { pgn?: string }>> : [])
      .then((storedGames) => {
        if (storedGames.length > 0) {
          setGames((previous) => {
            const localById = new Map(previous.map((game) => [game.id, game]))
            return storedGames.map((game) => ({ ...game, pgn: localById.get(game.id)?.pgn ?? '' }))
          })
        }
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => { loadGames() }, [loadGames])

  useEffect(() => {
    if (view !== 'training' || selectedGame.pgn || gameLoading) return
    setGameLoading(true)
    void fetch(`/api/games/${selectedGame.id}`)
      .then((response) => response.ok ? response.json() as Promise<GameRecord> : null)
      .then((gameWithPgn) => {
        if (!gameWithPgn) return
        setGames((previous) => previous.map((game) => game.id === gameWithPgn.id ? gameWithPgn : game))
      })
      .catch(() => undefined)
      .finally(() => setGameLoading(false))
  }, [gameLoading, selectedGame, view])

  const handleStatSaved = useCallback((stat: SessionStat, totalXp: number | null) => {
    setSessionStats((previous) => [stat, ...previous.filter((item) => item.id !== stat.id)])
    if (totalXp !== null) setAuthUser((previous) => previous ? { ...previous, xp: totalXp } : previous)
  }, [])

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    endSession()
  }

  function endSession() {
    setAuthUser(null)
    setSessionStats([])
    setTrainingKey(0)
    setView('home')
  }

  async function deleteGame(gameId: string) {
    const response = await fetch(`/api/games/${gameId}`, { method: 'DELETE' })
    const result = await readApiResponse<{ ok?: boolean }>(response)
    if (!response.ok) throw new Error(result.error ?? 'Could not delete the game.')
    setGames((previous) => previous.filter((game) => game.id !== gameId))
  }

  // A finished challenge changed ELO, XP and stats on the server. Replacing the user
  // object also re-runs the stats effect above.
  function refreshAccount() {
    void fetch('/api/auth/me')
      .then((response) => response.ok ? response.json() as Promise<{ user: AuthUser | null }> : null)
      .then((result) => { if (result?.user) setAuthUser(result.user) })
      .catch(() => undefined)
  }

  function trainChallengeGame(gameId: string) {
    if (games.some((game) => game.id === gameId)) openTraining(gameId)
    else window.alert('That game has since been removed from the library.')
  }

  function openTraining(gameId: string) {
    setSelectedGameId(gameId)
    setTrainingKey((key) => key + 1)
    setView('training')
  }

  if (resetToken) return <ResetPasswordView token={resetToken} onDone={() => window.location.replace('/')} />
  if (!authChecked) return <main className="auth-screen"><p className="eyebrow">REPLAY LAB</p><h1>Loading your study space.</h1></main>
  if (!authUser) return <AuthView onAuthenticated={setAuthUser} />
  const viewProps = { user: authUser, onNavigate: setView, onLogout: () => void logout() }
  let page = null
  if (view === 'stats') page = <StatsView {...viewProps} sessionStats={sessionStats} />
  else if (view === 'awards') page = <AwardsView {...viewProps} />
  else if (view === 'leaderboard') page = <LeaderboardView {...viewProps} />
  else if (view === 'challenges') page = <ChallengesView {...viewProps} onTrainGame={trainChallengeGame} />
  else if (view === 'home') page = <HomeView {...viewProps} games={games} sessionStats={sessionStats} onTrain={openTraining} />
  else if (view === 'admin' && authUser.role === 'admin') page = <AdminView {...viewProps} gameCount={games.length} onImportFinished={loadGames} />
  else if (view !== 'training') {
    page = <LibraryView
      {...viewProps}
      games={games}
      sessionCount={sessionStats.length}
      searchQuery={searchQuery}
      gameFilter={gameFilter}
      gamePage={gamePage}
      onSearchChange={(query) => { setSearchQuery(query); setGamePage(1) }}
      onFilterChange={(filter) => { setGameFilter(filter); setGamePage(1) }}
      onPageChange={setGamePage}
      onTrain={openTraining}
      onDeleteGame={deleteGame}
    />
  }

  // The training view stays mounted while hidden so a running clock or engine
  // review continues (and its result is saved) while the user browses other tabs.
  return <RealtimeProvider key={authUser.id} onSessionEnded={endSession}>
    <ChallengeProvider userId={authUser.id} onChallengeStarted={() => setView('challenges')} onChallengeCompleted={refreshAccount}>
      <BadgeProvider onOpenAwards={() => setView('awards')}>
        {page}
        {trainingKey > 0 && <div hidden={view !== 'training'}><TrainingView key={trainingKey} user={authUser} selectedGame={selectedGame} onNavigate={setView} onStatSaved={handleStatSaved} /></div>}
        <UpdateBanner view={view} trainingOpened={trainingKey > 0} />
        <InvitationToasts onAccepted={() => setView('challenges')} />
        {authUser.role === 'admin' && <AdminNotices onOpenAdmin={() => setView('admin')} />}
      </BadgeProvider>
    </ChallengeProvider>
  </RealtimeProvider>
}

export default App
