import { useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import { Chessboard } from 'react-chessboard'
import { accuracyFromCpl } from './stockfish'
// Rollback: swap this import back to `import { StockfishEngine } from './stockfish'`
// to restore server-side analysis via /api/analyze (untouched in server.ts).
import { ClientStockfishEngine as StockfishEngine } from './clientStockfish'
import type { EnginePhase } from './clientStockfish'
import { MainNav } from './components/MainNav'
import { AdminView } from './views/AdminView'
import { AuthView } from './views/AuthView'
import { AwardsView } from './views/AwardsView'
import { LeaderboardView } from './views/LeaderboardView'
import { LibraryView } from './views/LibraryView'
import { StatsView } from './views/StatsView'
import { readApiResponse } from './types'
import type { AppView, AuthUser, GameFilter, GameRecord, SessionStat, Side } from './types'
import './App.css'

type SessionStatus = 'selecting' | 'playing' | 'correction' | 'complete'

type MoveRecord = {
  moveNumber: number
  fenBefore: string
  expected: string
  expectedUci: string
  attempted: string
  attemptedUci: string
  correct: boolean
}

type EngineResult = Awaited<ReturnType<StockfishEngine['compare']>> & {
  moveNumber: number
  attempted: string
  expected: string
}

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

function readStored<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return value ? JSON.parse(value) as T : fallback
  } catch {
    return fallback
  }
}

function getOpeningGame(pgn: string) {
  const parsed = new Chess()
  if (pgn) parsed.loadPgn(pgn)
  return parsed
}

function formatDuration(totalSeconds: number | null) {
  if (totalSeconds === null || !Number.isFinite(totalSeconds)) return '--:--'
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0')
  const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, '0')
  return `${minutes}:${seconds}`
}

function App() {
  const [view, setView] = useState<AppView>('library')
  const [games, setGames] = useState<GameRecord[]>(() => readStored('chess-training-games', [sampleGame]))
  const [sessionStats, setSessionStats] = useState<SessionStat[]>([])
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [selectedGameId, setSelectedGameId] = useState(sampleGame.id)
  const [searchQuery, setSearchQuery] = useState('')
  const [gameFilter, setGameFilter] = useState<GameFilter>('all')
  const [gamePage, setGamePage] = useState(1)
  const [gameLoading, setGameLoading] = useState(false)
  const selectedGame = games.find((game) => game.id === selectedGameId) ?? games[0] ?? sampleGame
  const openingGame = useMemo(() => getOpeningGame(selectedGame.pgn), [selectedGame])
  const originalMoves = useMemo(() => openingGame.history({ verbose: true }), [openingGame])
  const [side, setSide] = useState<Side>('w')
  const [game, setGame] = useState(() => new Chess())
  const [currentPly, setCurrentPly] = useState(0)
  const [status, setStatus] = useState<SessionStatus>('selecting')
  const [message, setMessage] = useState('Choose a side to begin this classic game.')
  const [records, setRecords] = useState<MoveRecord[]>([])
  const [analysisDepth, setAnalysisDepth] = useState(12)
  const [analysisStatus, setAnalysisStatus] = useState<'idle' | 'running' | 'ready' | 'failed'>('idle')
  const [analysisResults, setAnalysisResults] = useState<EngineResult[]>([])
  const [analysisCurrentMove, setAnalysisCurrentMove] = useState(0)
  const [analysisPhase, setAnalysisPhase] = useState<EnginePhase | null>(null)
  const [analysisStartedAt, setAnalysisStartedAt] = useState<number | null>(null)
  const [analysisElapsedSeconds, setAnalysisElapsedSeconds] = useState(0)
  const sessionStartedAt = useRef<string | null>(null)
  const savedStatKey = useRef<string | null>(null)
  const [lastXpGained, setLastXpGained] = useState<number | null>(null)
  const engine = useMemo(() => new StockfishEngine(), [])

  const expectedMove = originalMoves[currentPly]
  const isUsersTurn = expectedMove?.color === side
  const correctCount = records.filter((record) => record.correct).length
  const learnerAccuracy = analysisResults.length > 0
    ? Math.round(analysisResults.reduce((total, result) => total + accuracyFromCpl(result.attemptedCpl), 0) / analysisResults.length)
    : null
  const originalAccuracy = analysisResults.length > 0
    ? Math.round(analysisResults.reduce((total, result) => total + accuracyFromCpl(result.originalCpl), 0) / analysisResults.length)
    : null
  const learnerAverageCpl = analysisResults.length > 0
    ? Math.round(analysisResults.reduce((total, result) => total + result.attemptedCpl, 0) / analysisResults.length)
    : null
  const analysisProgress = records.length > 0 ? analysisResults.length / records.length : 0
  const analysisRemainingMoves = Math.max(0, records.length - analysisResults.length)
  const estimatedRemainingSeconds = analysisResults.length > 0
    ? Math.ceil((analysisElapsedSeconds / analysisResults.length) * analysisRemainingMoves)
    : null

  useEffect(() => () => engine.terminate(), [engine])

  useEffect(() => {
    localStorage.setItem('chess-training-games', JSON.stringify(games))
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

  useEffect(() => {
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

  useEffect(() => {
    if (analysisStatus !== 'running' || analysisStartedAt === null) return
    const timer = window.setInterval(() => {
      setAnalysisElapsedSeconds(Math.floor((Date.now() - analysisStartedAt) / 1000))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [analysisStartedAt, analysisStatus])

  useEffect(() => {
    if (status !== 'complete' || records.length === 0 || analysisStatus !== 'idle') return

    let cancelled = false
    setAnalysisStatus('running')
    setAnalysisCurrentMove(0)
    setAnalysisStartedAt(Date.now())
    setAnalysisElapsedSeconds(0)
    setMessage('Stockfish is comparing the two move lines.')

    async function runAnalysis() {
      try {
        const results: EngineResult[] = []
        for (const [index, record] of records.entries()) {
          if (!cancelled) setAnalysisCurrentMove(index + 1)
          const result = await engine.compare(record.fenBefore, record.expectedUci, record.attemptedUci, analysisDepth, (phase) => {
            if (!cancelled) setAnalysisPhase(phase)
          })
          results.push({ ...result, moveNumber: record.moveNumber, attempted: record.attempted, expected: record.expected })
          if (!cancelled) setAnalysisResults([...results])
        }
        if (!cancelled) {
          setAnalysisCurrentMove(records.length)
          setAnalysisPhase(null)
          setAnalysisStatus('ready')
          setMessage('Engine comparison is ready.')
        }
      } catch {
        if (!cancelled) {
          setAnalysisStatus('failed')
          setMessage('Stockfish could not complete this review. Your move record is still available.')
        }
      }
    }

    void runAnalysis()
    return () => { cancelled = true }
  }, [analysisDepth, engine, records, status])

  useEffect(() => {
    if (analysisStatus !== 'ready' || !sessionStartedAt.current || savedStatKey.current === sessionStartedAt.current) return
    const stat: SessionStat = {
      id: sessionStartedAt.current,
      gameId: selectedGame.id,
      gameTitle: selectedGame.title,
      side,
      attemptedMoves: records.length,
      correctMoves: correctCount,
      deviations: records.length - correctCount,
      learnerAccuracy,
      originalAccuracy,
      averageCpl: learnerAverageCpl,
      completedAt: new Date().toISOString(),
    }
    void fetch('/api/stats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(stat) })
      .then((response) => response.json() as Promise<{ xpGained?: number; totalXp?: number }>)
      .then((result) => {
        setSessionStats((previous) => [stat, ...previous.filter((item) => item.id !== stat.id)])
        if (typeof result.xpGained === 'number') setLastXpGained(result.xpGained)
        if (typeof result.totalXp === 'number') setAuthUser((previous) => previous ? { ...previous, xp: result.totalXp as number } : previous)
      })
    savedStatKey.current = sessionStartedAt.current
  }, [analysisStatus, correctCount, learnerAccuracy, learnerAverageCpl, originalAccuracy, records.length, selectedGame.id, selectedGame.title, side])

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    setAuthUser(null)
    setSessionStats([])
    setView('library')
  }

  function addImportedGames(importedGames: GameRecord[]) {
    setGames((previous) => [...importedGames.map((game) => ({ ...game, pgn: '' })), ...previous])
  }

  async function deleteGame(gameId: string) {
    const response = await fetch(`/api/games/${gameId}`, { method: 'DELETE' })
    const result = await readApiResponse<{ ok?: boolean }>(response)
    if (!response.ok) throw new Error(result.error ?? 'Could not delete the game.')
    setGames((previous) => previous.filter((game) => game.id !== gameId))
  }

  function openTraining(gameId: string) {
    setSelectedGameId(gameId)
    setView('training')
    setStatus('selecting')
  }

  function beginTraining(selectedSide: Side) {
    sessionStartedAt.current = `${Date.now()}-${selectedGame.id}`
    savedStatKey.current = null
    setLastXpGained(null)
    setView('training')
    startSession(selectedSide)
  }

  function startSession(selectedSide: Side) {
    setSide(selectedSide)
    setGame(new Chess())
    setCurrentPly(0)
    setRecords([])
    setStatus('playing')
    setMessage(selectedSide === 'w' ? 'Your move. Find 1. e4.' : 'White starts. Watch the original move.')
    setAnalysisStatus('idle')
    setAnalysisResults([])
    setAnalysisCurrentMove(0)
    setAnalysisPhase(null)
    setAnalysisStartedAt(null)
    setAnalysisElapsedSeconds(0)
    if (selectedSide === 'b') {
      replayUntilUserTurn(0, selectedSide)
    }
  }

  function replayUntilUserTurn(startPly: number, selectedSide: Side) {
    const replay = new Chess()
    for (let ply = 0; ply < startPly; ply += 1) {
      replay.move(originalMoves[ply].san)
    }
    let nextPly = startPly
    while (originalMoves[nextPly] && originalMoves[nextPly].color !== selectedSide) {
      replay.move(originalMoves[nextPly].san)
      nextPly += 1
    }
    setGame(replay)
    setCurrentPly(nextPly)
    const complete = nextPly >= originalMoves.length
    if (complete) {
      setStatus('complete')
      setMessage('Game complete. Starting engine analysis.')
    }
    return complete
  }

  function handleMove(sourceSquare: string, targetSquare: string | null, promotion?: string) {
    if (status !== 'playing' || !isUsersTurn || !expectedMove || !targetSquare) return false

    const nextGame = new Chess(game.fen())
    let attempted
    try {
      attempted = nextGame.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: promotion ?? 'q',
      })
    } catch {
      return false
    }
    if (!attempted) return false

    const record: MoveRecord = {
      moveNumber: Math.floor(currentPly / 2) + 1,
      fenBefore: game.fen(),
      expected: expectedMove.san,
      expectedUci: expectedMove.lan,
      attempted: attempted.san,
      attemptedUci: attempted.lan,
      correct: attempted.lan === expectedMove.lan,
    }
    const nextRecords = [...records, record]
    setRecords(nextRecords)

    if (!record.correct) {
      setGame(nextGame)
      setStatus('correction')
      setMessage(`Legal move, but the original game played ${expectedMove.san}.`)
      window.setTimeout(() => {
        const complete = replayUntilUserTurn(currentPly + 1, side)
        if (!complete) {
          setStatus('playing')
          setMessage('The historical line is restored. Keep going.')
        }
      }, 1100)
      return true
    }

    const complete = replayUntilUserTurn(currentPly + 1, side)
    if (!complete) setMessage('Matched the original game.')
    return true
  }

  function resetSession() {
    setStatus('selecting')
    setMessage('Choose a side to begin this classic game.')
    setGame(new Chess())
    setCurrentPly(0)
    setRecords([])
    setAnalysisStatus('idle')
    setAnalysisResults([])
    setAnalysisCurrentMove(0)
    setAnalysisPhase(null)
    setAnalysisStartedAt(null)
    setAnalysisElapsedSeconds(0)
    setLastXpGained(null)
  }

  if (!authChecked) return <main className="auth-screen"><p className="eyebrow">REPLAY LAB</p><h1>Loading your study space.</h1></main>
  if (!authUser) return <AuthView onAuthenticated={setAuthUser} />
  const viewProps = { user: authUser, onNavigate: setView, onLogout: () => void logout() }
  if (view === 'stats') return <StatsView {...viewProps} sessionStats={sessionStats} />
  if (view === 'awards') return <AwardsView {...viewProps} sessionStats={sessionStats} />
  if (view === 'leaderboard') return <LeaderboardView {...viewProps} />
  if (view === 'admin' && authUser.role === 'admin') return <AdminView {...viewProps} gameCount={games.length} onGamesImported={addImportedGames} />
  if (view !== 'training') {
    return <LibraryView
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

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">REPLAY LAB / TRAINING</p>
          <h1>Play the<br /><em>master line.</em></h1>
        </div>
        <div className="topbar-meta">
          <span className="live-dot" /> TRAINING MODE
          <button className="header-link" onClick={() => setView('library')}>← Library</button>
        </div>
      </header>
      <MainNav view="training" isAdmin={authUser.role === 'admin'} onNavigate={setView} className="training-nav" />

      <section className="game-layout">
        <div className="board-column">
          <div className="board-labels"><span>{selectedGame.white.toUpperCase()}</span><span className="score">{selectedGame.result}</span><span>{selectedGame.black.toUpperCase()}</span></div>
          <div className="board-wrap">
            <Chessboard
              options={{
                position: game.fen(),
                onPieceDrop: ({ sourceSquare, targetSquare }) => handleMove(sourceSquare, targetSquare),
                boardOrientation: side === 'w' ? 'white' : 'black',
                allowDragging: status === 'playing' && isUsersTurn,
                boardStyle: { borderRadius: '2px', boxShadow: '0 18px 50px rgba(18, 28, 35, .18)' },
              }}
            />
          </div>
          <div className="board-footer"><span>{selectedGame.date} / {selectedGame.event.toUpperCase()}</span><span>{selectedGame.plyCount} PLIES</span></div>
        </div>

        <aside className="side-panel">
          <div className="panel-heading"><span>SESSION</span><span className="session-code">A-001</span></div>
          <div className="game-title"><p>{selectedGame.event.toUpperCase()}</p><h2>{selectedGame.white} <span>vs</span> {selectedGame.black}</h2><small>{selectedGame.date} · {selectedGame.result}</small></div>

          {status === 'selecting' ? (
            <div className="choice-block">
              <p className="section-label">CHOOSE YOUR SIDE</p>
              <button className="side-choice" onClick={() => beginTraining('w')}><span>♔</span><strong>White</strong><small>{selectedGame.white}</small><b>→</b></button>
              <button className="side-choice" onClick={() => beginTraining('b')}><span>♚</span><strong>Black</strong><small>{selectedGame.black}</small><b>→</b></button>
            </div>
          ) : (
            <>
              <div className={`status-banner ${status}`}><span className="status-dot" /><div><strong>{status === 'complete' ? 'Session complete' : status === 'correction' ? 'Historical correction' : isUsersTurn ? 'Your move' : 'Replaying line'}</strong><p>{message}</p></div></div>
              <div className="progress-row"><span>PROGRESS</span><strong>{Math.min(currentPly, originalMoves.length)} / {originalMoves.length} PLY</strong></div>
              <div className="progress-track"><span style={{ width: `${(currentPly / originalMoves.length) * 100}%` }} /></div>
              <div className="score-grid"><div><strong>{correctCount}</strong><span>MATCHED</span></div><div><strong>{records.length - correctCount}</strong><span>DEVIATIONS</span></div></div>
              <div className="move-log"><p className="section-label">YOUR ATTEMPTS</p>{records.length === 0 ? <p className="empty-log">Your recorded moves will appear here.</p> : records.map((record, index) => <div className="move-row" key={`${record.moveNumber}-${index}`}><span>{record.moveNumber}{record.moveNumber % 2 === 0 ? '...' : '.'}</span><strong>{record.attempted}</strong><span className={record.correct ? 'match' : 'deviation'}>{record.correct ? 'MATCH' : `→ ${record.expected}`}</span></div>)}</div>
              {status === 'complete' && <section className="engine-review">
                <div className="review-heading"><p className="section-label">ENGINE REVIEW</p><span className={analysisStatus}>{analysisStatus === 'running' ? 'ANALYZING' : analysisStatus === 'ready' ? 'READY' : analysisStatus === 'failed' ? 'UNAVAILABLE' : 'WAITING'}</span></div>
                {lastXpGained !== null && lastXpGained > 0 && <p className="xp-earned">+{lastXpGained} XP earned</p>}
                <label className="depth-control">DEPTH <strong>{analysisDepth}</strong><input type="range" min="12" max="30" value={analysisDepth} disabled={analysisStatus === 'running'} onChange={(event) => { setAnalysisDepth(Number(event.target.value)); setAnalysisStatus('idle'); setAnalysisResults([]) }} /></label>
                {analysisStatus === 'running' && <div className="analysis-progress" aria-live="polite">
                  <div className="analysis-progress-label"><strong>Move {analysisCurrentMove} of {records.length} · {analysisPhase === 'best' ? 'best line' : analysisPhase === 'original' ? 'original move' : 'your move'}</strong><span>{Math.round(analysisProgress * 100)}%</span></div>
                  <div className="analysis-progress-track"><span style={{ width: `${analysisProgress * 100}%` }} /></div>
                  <div className="analysis-progress-meta"><span>Elapsed {formatDuration(analysisElapsedSeconds)}</span><span>{analysisResults.length > 0 ? `About ${formatDuration(estimatedRemainingSeconds)} remaining` : 'Estimating time remaining...'}</span></div>
                </div>}
                {analysisResults.length > 0 && <div className="engine-score-grid"><div><strong>{learnerAccuracy}%</strong><span>YOUR ACCURACY</span></div><div><strong>{originalAccuracy}%</strong><span>ORIGINAL ACCURACY</span></div><div><strong>{learnerAverageCpl}</strong><span>YOUR AVG CPL</span></div></div>}
                {analysisResults.length > 0 && <div className="engine-moves">{analysisResults.map((result) => <div className="engine-move" key={result.moveNumber}><span>{result.moveNumber}.</span><strong>{result.attempted}</strong><span>game {result.expected}</span><b>{accuracyFromCpl(result.attemptedCpl)}%</b></div>)}</div>}
              </section>}
              {status === 'complete' && <button className="reset-button" onClick={resetSession}>Choose another side</button>}
            </>
          )}
          <div className="panel-note"><span>♟</span><p>Historical match is based on the original move, not engine strength. Review analysis arrives after the full game.</p></div>
        </aside>
      </section>
    </main>
  )
}

export default App
