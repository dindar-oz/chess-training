import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { Chess } from 'chess.js'
import { Chessboard } from 'react-chessboard'
import { accuracyFromCpl } from './stockfish'
// Rollback: swap this import back to `import { StockfishEngine } from './stockfish'`
// to restore server-side analysis via /api/analyze (untouched in server.ts).
import { ClientStockfishEngine as StockfishEngine } from './clientStockfish'
import type { EnginePhase } from './clientStockfish'
import firstGameBadge from './assets/badge-first-game.svg'
import './App.css'

type Side = 'w' | 'b'
type SessionStatus = 'selecting' | 'playing' | 'correction' | 'complete'
type AppView = 'library' | 'training' | 'stats' | 'awards'
type ImportStatus = 'idle' | 'uploading' | 'processing' | 'complete' | 'error'
type AuthUser = { id: string; username: string; xp: number }

type GameRecord = {
  id: string
  title: string
  white: string
  black: string
  event: string
  date: string
  result: string
  pgn: string
  plyCount: number
}

type SessionStat = {
  id: string
  gameId: string
  gameTitle: string
  side: Side
  attemptedMoves: number
  correctMoves: number
  deviations: number
  learnerAccuracy: number | null
  originalAccuracy: number | null
  averageCpl: number | null
  completedAt: string
}

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

const maxTextImportBytes = 20 * 1024 * 1024

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
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [authUsername, setAuthUsername] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authMessage, setAuthMessage] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [selectedGameId, setSelectedGameId] = useState(sampleGame.id)
  const [searchQuery, setSearchQuery] = useState('')
  const [gameFilter, setGameFilter] = useState<'all' | 'decisive' | 'draw'>('all')
  const [gamePage, setGamePage] = useState(1)
  const [importText, setImportText] = useState('')
  const [importMessage, setImportMessage] = useState('')
  const [selectedFileName, setSelectedFileName] = useState('')
  const [selectedFileSize, setSelectedFileSize] = useState(0)
  const [fileLoadVersion, setFileLoadVersion] = useState(0)
  const [importStatus, setImportStatus] = useState<ImportStatus>('idle')
  const [importProgress, setImportProgress] = useState(0)
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
  const filteredGames = games.filter((game) => {
    const haystack = `${game.title} ${game.white} ${game.black} ${game.event}`.toLocaleLowerCase()
    const matchesQuery = haystack.includes(searchQuery.toLocaleLowerCase())
    const matchesFilter = gameFilter === 'all' || (gameFilter === 'decisive' ? game.result !== '1/2-1/2' && game.result !== '*' : game.result === '1/2-1/2')
    return matchesQuery && matchesFilter
  })
  const gamesPerPage = 20
  const totalGamePages = Math.max(1, Math.ceil(filteredGames.length / gamesPerPage))
  const visibleGames = filteredGames.slice((gamePage - 1) * gamesPerPage, gamePage * gamesPerPage)
  const paginationItems: Array<number | 'ellipsis'> = totalGamePages <= 7
    ? Array.from({ length: totalGamePages }, (_, index) => index + 1)
    : [
      1,
      ...(gamePage > 4 ? ['ellipsis' as const] : []),
      ...Array.from({ length: 3 }, (_, index) => gamePage - 1 + index).filter((page) => page > 1 && page < totalGamePages),
      ...(gamePage < totalGamePages - 3 ? ['ellipsis' as const] : []),
      totalGamePages,
    ]

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
    setGamePage(1)
  }, [gameFilter, searchQuery])

  useEffect(() => {
    if (gamePage > totalGamePages) setGamePage(totalGamePages)
  }, [gamePage, totalGamePages])

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

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAuthBusy(true)
    setAuthMessage('')
    try {
      const response = await fetch(`/api/auth/${authMode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: authUsername, password: authPassword }) })
      let result: { user?: AuthUser; error?: string } = {}
      try {
        result = await response.json() as { user?: AuthUser; error?: string }
      } catch {
        // Server returned a non-JSON or empty body (e.g. cold start / outage).
      }
      if (!response.ok || !result.user) throw new Error(result.error ?? 'The server did not respond. Please try again in a moment.')
      setAuthUser(result.user)
      setAuthPassword('')
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : 'Authentication failed.')
    } finally {
      setAuthBusy(false)
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    setAuthUser(null)
    setSessionStats([])
  }

  function beginTraining(selectedSide: Side) {
    sessionStartedAt.current = `${Date.now()}-${selectedGame.id}`
    savedStatKey.current = null
    setLastXpGained(null)
    setView('training')
    startSession(selectedSide)
  }

  function uploadPgn(body: XMLHttpRequestBodyInit, onProgress?: (progress: number) => void) {
    return new Promise<{ imported?: GameRecord[]; duplicates?: number; error?: string }>((resolve, reject) => {
      const request = new XMLHttpRequest()
      request.open('POST', '/api/games/import')
      request.setRequestHeader('Content-Type', 'text/plain')
      request.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100))
      }
      request.onerror = () => reject(new Error('The PGN upload failed.'))
      request.onload = () => {
        try {
          const result = JSON.parse(request.responseText) as { imported?: GameRecord[]; duplicates?: number; error?: string }
          if (request.status < 200 || request.status >= 300) reject(new Error(result.error ?? 'PGN import failed.'))
          else resolve(result)
        } catch {
          reject(new Error('The server returned an invalid import response.'))
        }
      }
      request.send(body)
    })
  }

  async function importGame() {
    if (!importText.trim()) {
      setImportMessage('Paste a PGN before importing.')
      return
    }
    try {
      setImportStatus('processing')
      setImportProgress(100)
      const result = await uploadPgn(importText)
      const importedGames = result.imported ?? []
      setGames((previous) => [...importedGames.map((game) => ({ ...game, pgn: '' })), ...previous])
      if (importedGames[0]) setSelectedGameId(importedGames[0].id)
      setImportText('')
      const duplicateMessage = result.duplicates ? ` ${result.duplicates} duplicate${result.duplicates === 1 ? '' : 's'} skipped.` : ''
      setImportMessage(`${importedGames.length} ${importedGames.length === 1 ? 'game' : 'games'} added to your library.${duplicateMessage}`)
      setImportStatus('complete')
    } catch (error) {
      setImportStatus('error')
      setImportMessage(error instanceof Error ? error.message : 'That PGN could not be parsed.')
    }
  }

  function handlePgnFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setSelectedFileName(file.name)
    setSelectedFileSize(file.size)
    if (file.size > maxTextImportBytes) {
      setImportText('')
      setImportStatus('uploading')
      setImportProgress(0)
      setImportMessage(`${file.name} is ${Math.round(file.size / 1024 / 1024)} MB. Uploading to the game database...`)
      const input = event.currentTarget
      void uploadPgn(file, (progress) => {
        setImportProgress(progress)
        if (progress === 100) setImportStatus('processing')
      })
        .then((result) => {
          const importedGames = result.imported ?? []
          setGames((previous) => [...importedGames.map((game) => ({ ...game, pgn: '' })), ...previous])
          if (importedGames[0]) setSelectedGameId(importedGames[0].id)
          const duplicateMessage = result.duplicates ? ` ${result.duplicates} duplicate${result.duplicates === 1 ? '' : 's'} skipped.` : ''
          setImportMessage(`${importedGames.length} games imported directly into the database.${duplicateMessage}`)
          setImportStatus('complete')
        })
        .catch((error: unknown) => { setImportStatus('error'); setImportMessage(error instanceof Error ? error.message : 'PGN import failed.') })
        .finally(() => { input.value = '' })
      return
    }
    void file.text()
      .then((text) => {
        setImportText(text)
        setFileLoadVersion((version) => version + 1)
        setImportMessage(`${file.name} loaded. Review the PGN, then import it.`)
      })
      .catch(() => setImportMessage(`Could not read ${file.name}.`))
      .finally(() => { event.currentTarget.value = '' })
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

  function renderAuth() {
    return <main className="auth-screen"><div className="auth-mark" aria-hidden="true">♞</div><p className="eyebrow">REPLAY LAB / PRIVATE STUDY</p><h1>{authMode === 'login' ? 'Welcome back.' : 'Start your record.'}</h1><p className="auth-intro">Your game library is shared. Your training history belongs only to you.</p><form className="auth-form" onSubmit={submitAuth}><label>USERNAME<input autoComplete="username" value={authUsername} onChange={(event) => setAuthUsername(event.target.value)} required minLength={3} maxLength={32} /></label><label>PASSWORD<input autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} type="password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} required minLength={8} /></label><button className="primary-button auth-submit" disabled={authBusy}>{authBusy ? 'Please wait...' : authMode === 'login' ? 'Log in' : 'Create account'}</button>{authMessage && <p className="auth-message">{authMessage}</p>}</form><button className="text-button auth-switch" onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthMessage('') }}>{authMode === 'login' ? 'Create a new account →' : 'Already have an account? Log in →'}</button></main>
  }

  function renderLibrary() {
    return <main className="app-shell library-screen">
      <header className="topbar library-topbar">
        <div className="brand-heading"><div className="brand-lockup"><span className="brand-mark" aria-hidden="true">♞</span><span>Replay Lab</span></div><p className="eyebrow">REPLAY LAB / LIBRARY</p><h1>Study the<br /><em>great games.</em></h1></div>
        <div className="topbar-meta"><span className="live-dot" /> {games.length} GAMES <strong>{sessionStats.length} SESSIONS</strong><strong>{authUser?.xp ?? 0} XP</strong><button className="header-link" onClick={() => void logout()}>{authUser?.username} · Log out</button></div>
      </header>
      <nav className="main-nav"><button className="nav-active" onClick={() => setView('library')}><span aria-hidden="true">♜</span> Game library</button><button onClick={() => setView('stats')}><span aria-hidden="true">↗</span> My statistics</button><button onClick={() => setView('awards')}><span aria-hidden="true">🏅</span> Awards</button></nav>
      <section className="library-toolbar">
        <div><p className="section-label">GAME DATABASE</p><h2>{filteredGames.length} games ready to study</h2></div>
        <div className="library-controls"><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search players or events" aria-label="Search games" /><div className="filter-group"><button className={gameFilter === 'all' ? 'selected' : ''} onClick={() => setGameFilter('all')}>All</button><button className={gameFilter === 'decisive' ? 'selected' : ''} onClick={() => setGameFilter('decisive')}>Decisive</button><button className={gameFilter === 'draw' ? 'selected' : ''} onClick={() => setGameFilter('draw')}>Draws</button></div></div>
      </section>
      <div className="games-table-wrap"><table className="games-table"><thead><tr><th>Game</th><th>Event</th><th>Date</th><th>Result</th><th>Length</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{visibleGames.map((game) => <tr key={game.id}><td><strong>{game.title}</strong><span>{game.white} vs {game.black}</span></td><td>{game.event}</td><td>{game.date}</td><td><b className="result-badge">{game.result}</b></td><td>{game.plyCount} plies</td><td><button className="table-action" onClick={() => { setSelectedGameId(game.id); setView('training'); setStatus('selecting') }}><span className="button-icon" aria-hidden="true">↗</span> Train</button></td></tr>)}</tbody></table></div>
      {filteredGames.length === 0 && <div className="empty-library">No games match this search.</div>}
      {filteredGames.length > 0 && <nav className="pagination" aria-label="Game library pages"><button className="page-button" disabled={gamePage === 1} onClick={() => setGamePage((page) => page - 1)}>← Previous</button><div className="page-numbers">{paginationItems.map((item, index) => item === 'ellipsis' ? <span className="page-ellipsis" key={`ellipsis-${index}`}>...</span> : <button key={item} className={`page-button ${item === gamePage ? 'current' : ''}`} aria-current={item === gamePage ? 'page' : undefined} onClick={() => setGamePage(item)}>{item}</button>)}</div><button className="page-button" disabled={gamePage === totalGamePages} onClick={() => setGamePage((page) => page + 1)}>Next →</button></nav>}
      <section className="import-panel"><div><p className="section-label">EXPAND THE LIBRARY</p><h2>Import PGN games</h2><p>Paste one or more complete PGN games, or load a PGN collection from your computer.</p></div><div className="import-form"><textarea key={fileLoadVersion} value={importText} onChange={(event) => setImportText(event.target.value)} placeholder="[Event &quot;Game one&quot;]&#10;1. e4 e5 ...&#10;&#10;[Event &quot;Game two&quot;]&#10;1. d4 d5 ..." aria-label="PGN text" /><div className="import-actions"><label className="file-button"><span className="button-icon" aria-hidden="true">↑</span> Choose PGN<input type="file" accept=".pgn,.txt,text/plain" onChange={handlePgnFile} /></label><button className="primary-button" disabled={importStatus === 'uploading' || importStatus === 'processing'} onClick={() => void importGame()}><span className="button-icon" aria-hidden="true">＋</span> Import games</button></div>{(importStatus === 'uploading' || importStatus === 'processing') && <div className="import-progress" aria-live="polite"><div className="import-progress-label"><strong>{importStatus === 'uploading' ? `Uploading ${importProgress}%` : 'Processing games into the database'}</strong><span>{importStatus === 'uploading' ? `${importProgress}%` : 'Please wait'}</span></div><div className="import-progress-track"><span style={{ width: `${importStatus === 'uploading' ? importProgress : 100}%` }} /></div></div>}{selectedFileName && <p className="selected-file">Selected: {selectedFileName} · {selectedFileSize > maxTextImportBytes ? `${Math.round(selectedFileSize / 1024 / 1024)} MB file` : `${importText.length.toLocaleString()} characters loaded`}</p>}{importMessage && <p className="import-message">{importMessage}</p>}</div></section>
    </main>
  }

  function renderStats() {
    const completed = sessionStats.filter((stat) => stat.learnerAccuracy !== null)
    const averageAccuracy = completed.length ? Math.round(completed.reduce((sum, stat) => sum + (stat.learnerAccuracy ?? 0), 0) / completed.length) : 0
    const totalMoves = completed.reduce((sum, stat) => sum + stat.attemptedMoves, 0)
    const totalMatches = completed.reduce((sum, stat) => sum + stat.correctMoves, 0)
    return <main className="app-shell stats-screen">
      <header className="topbar library-topbar"><div><p className="eyebrow">REPLAY LAB / PROGRESS</p><h1>Your study<br /><em>record.</em></h1></div><div className="topbar-meta"><span className="live-dot" /> {authUser?.xp ?? 0} XP<button className="header-link" onClick={() => void logout()}>{authUser?.username} · Log out</button></div></header>
      <nav className="main-nav"><button onClick={() => setView('library')}>Game library</button><button className="nav-active" onClick={() => setView('stats')}>My statistics</button><button onClick={() => setView('awards')}>Awards</button></nav>
      <section className="stats-summary"><div><span>TOTAL XP</span><strong>{authUser?.xp ?? 0}</strong></div><div><span>SESSIONS</span><strong>{completed.length}</strong></div><div><span>AVG ACCURACY</span><strong>{averageAccuracy}%</strong></div><div><span>MOVES ATTEMPTED</span><strong>{totalMoves}</strong></div><div><span>HISTORICAL MATCHES</span><strong>{totalMatches}</strong></div></section>
      <section className="history-section"><div className="section-heading"><div><p className="section-label">SESSION HISTORY</p><h2>Every game is part of the record.</h2></div><button className="text-button" onClick={() => setView('library')}>Find another game →</button></div>{completed.length === 0 ? <div className="empty-library">Complete a training session to start building your statistics.</div> : <div className="history-list">{completed.map((stat) => <div className="history-row" key={stat.id}><div><strong>{stat.gameTitle}</strong><span>{new Date(stat.completedAt).toLocaleDateString()} · {stat.side === 'w' ? 'White' : 'Black'}</span></div><div><strong>{stat.learnerAccuracy}%</strong><span>YOUR ACCURACY</span></div><div><strong>{stat.originalAccuracy}%</strong><span>ORIGINAL</span></div><div><strong>{stat.deviations}</strong><span>DEVIATIONS</span></div></div>)}</div>}</section>
    </main>
  }

  function renderAwards() {
    const firstGameEarned = sessionStats.length > 0
    const earnedAt = firstGameEarned
      ? [...sessionStats].sort((a, b) => a.completedAt.localeCompare(b.completedAt))[0].completedAt
      : null
    return <main className="app-shell awards-screen">
      <header className="topbar library-topbar"><div><p className="eyebrow">REPLAY LAB / AWARDS</p><h1>Badges<br /><em>you've earned.</em></h1></div><div className="topbar-meta"><span className="live-dot" /> {authUser?.xp ?? 0} XP<button className="header-link" onClick={() => void logout()}>{authUser?.username} · Log out</button></div></header>
      <nav className="main-nav"><button onClick={() => setView('library')}>Game library</button><button onClick={() => setView('stats')}>My statistics</button><button className="nav-active" onClick={() => setView('awards')}>Awards</button></nav>
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

  if (!authChecked) return <main className="auth-screen"><p className="eyebrow">REPLAY LAB</p><h1>Loading your study space.</h1></main>
  if (!authUser) return renderAuth()
  if (view === 'library') return renderLibrary()
  if (view === 'stats') return renderStats()
  if (view === 'awards') return renderAwards()

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
      <nav className="main-nav training-nav"><button onClick={() => setView('library')}>Game library</button><button onClick={() => setView('stats')}>My statistics</button><button onClick={() => setView('awards')}>Awards</button></nav>

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
