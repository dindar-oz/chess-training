import { useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import { Chessboard } from 'react-chessboard'
import { accuracyFromCpl } from '../../shared/accuracy.ts'
// Rollback: swap this import back to `import { StockfishEngine } from '../stockfish'`
// to restore server-side analysis via /api/analyze (untouched in server.ts).
import { ClientStockfishEngine as StockfishEngine } from '../clientStockfish'
import type { EnginePhase } from '../clientStockfish'
import { ChessClock } from '../components/ChessClock'
import { MainNav } from '../components/MainNav'
import { TimeControlPicker } from '../components/TimeControlPicker'
import { useTrainingSession } from '../hooks/useTrainingSession'
import { readStored, writeStored } from '../storage'
import { formatTimeControl, isValidTimeControl } from '../timeControl'
import type { TimeControl } from '../timeControl'
import type { AppView, AuthUser, GameRecord, SessionStat, Side } from '../types'

type EngineResult = Awaited<ReturnType<StockfishEngine['compare']>> & {
  moveNumber: number
  attempted: string
  expected: string
}

type TrainingViewProps = {
  user: AuthUser
  selectedGame: GameRecord
  onNavigate: (view: AppView) => void
  onStatSaved: (stat: SessionStat, totalXp: number | null) => void
}

const timeControlStorageKey = 'chess-training-time-control'

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

function storedTimeControl() {
  const stored = readStored<unknown>(timeControlStorageKey, null)
  return isValidTimeControl(stored) ? stored : null
}

export function TrainingView({ user, selectedGame, onNavigate, onStatSaved }: TrainingViewProps) {
  const openingGame = useMemo(() => getOpeningGame(selectedGame.pgn), [selectedGame])
  const originalMoves = useMemo(() => openingGame.history({ verbose: true }), [openingGame])
  const session = useTrainingSession(originalMoves)
  const { side, status, records, setMessage } = session
  const [selectedTimeControl, setSelectedTimeControl] = useState<TimeControl | null>(storedTimeControl)
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
  }, [analysisDepth, engine, records, setMessage, status])

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
      timeControl: session.timeControl ? formatTimeControl(session.timeControl) : null,
      endReason: session.endReason ?? 'completed',
      completedAt: new Date().toISOString(),
    }
    void fetch('/api/stats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(stat) })
      .then((response) => response.json() as Promise<{ xpGained?: number; totalXp?: number }>)
      .then((result) => {
        if (typeof result.xpGained === 'number') setLastXpGained(result.xpGained)
        onStatSaved(stat, typeof result.totalXp === 'number' ? result.totalXp : null)
      })
    savedStatKey.current = sessionStartedAt.current
  }, [analysisStatus, correctCount, learnerAccuracy, learnerAverageCpl, onStatSaved, originalAccuracy, records.length, selectedGame.id, selectedGame.title, session.endReason, session.timeControl, side])

  function resetAnalysis() {
    setAnalysisStatus('idle')
    setAnalysisResults([])
    setAnalysisCurrentMove(0)
    setAnalysisPhase(null)
    setAnalysisStartedAt(null)
    setAnalysisElapsedSeconds(0)
  }

  function chooseTimeControl(timeControl: TimeControl | null) {
    setSelectedTimeControl(timeControl)
    writeStored(timeControlStorageKey, timeControl)
  }

  function beginTraining(selectedSide: Side) {
    sessionStartedAt.current = `${Date.now()}-${selectedGame.id}`
    savedStatKey.current = null
    setLastXpGained(null)
    resetAnalysis()
    session.start(selectedSide, selectedTimeControl)
  }

  function resetSession() {
    session.reset()
    resetAnalysis()
    setLastXpGained(null)
  }

  const statusTitle = status === 'complete'
    ? session.endReason === 'timeout' ? 'Time is up' : 'Session complete'
    : status === 'correction' ? 'Historical correction' : session.isUsersTurn ? 'Your move' : 'Replaying line'

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">REPLAY LAB / TRAINING</p>
          <h1>Play the<br /><em>master line.</em></h1>
        </div>
        <div className="topbar-meta">
          <span className="live-dot" /> TRAINING MODE
          <button className="header-link" onClick={() => onNavigate('library')}>← Library</button>
        </div>
      </header>
      <MainNav view="training" isAdmin={user.role === 'admin'} onNavigate={onNavigate} className="training-nav" />

      <section className="game-layout">
        <div className="board-column">
          <div className="board-labels"><span>{selectedGame.white.toUpperCase()}</span><span className="score">{selectedGame.result}</span><span>{selectedGame.black.toUpperCase()}</span></div>
          <div className="board-wrap">
            <Chessboard
              options={{
                position: session.game.fen(),
                onPieceDrop: ({ sourceSquare, targetSquare }) => session.handleMove(sourceSquare, targetSquare),
                boardOrientation: side === 'w' ? 'white' : 'black',
                allowDragging: status === 'playing' && session.isUsersTurn,
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
              <TimeControlPicker value={selectedTimeControl} onChange={chooseTimeControl} />
              <p className="section-label">CHOOSE YOUR SIDE</p>
              <button className="side-choice" onClick={() => beginTraining('w')}><span>♔</span><strong>White</strong><small>{selectedGame.white}</small><b>→</b></button>
              <button className="side-choice" onClick={() => beginTraining('b')}><span>♚</span><strong>Black</strong><small>{selectedGame.black}</small><b>→</b></button>
            </div>
          ) : (
            <>
              {session.timeControl && <ChessClock label="YOUR CLOCK" timeControl={session.timeControl} displayMs={session.clock.displayMs} running={session.clock.running} />}
              <div className={`status-banner ${status} ${session.endReason === 'timeout' ? 'timeout' : ''}`}><span className="status-dot" /><div><strong>{statusTitle}</strong><p>{session.message}</p></div></div>
              <div className="progress-row"><span>PROGRESS</span><strong>{Math.min(session.currentPly, originalMoves.length)} / {originalMoves.length} PLY</strong></div>
              <div className="progress-track"><span style={{ width: `${(session.currentPly / originalMoves.length) * 100}%` }} /></div>
              <div className="score-grid"><div><strong>{correctCount}</strong><span>MATCHED</span></div><div><strong>{records.length - correctCount}</strong><span>DEVIATIONS</span></div></div>
              <div className="move-log"><p className="section-label">YOUR ATTEMPTS</p>{records.length === 0 ? <p className="empty-log">Your recorded moves will appear here.</p> : records.map((record, index) => <div className="move-row" key={`${record.moveNumber}-${index}`}><span>{record.moveNumber}{side === 'b' ? '...' : '.'}</span><strong>{record.attempted}</strong><span className={record.correct ? 'match' : 'deviation'}>{record.correct ? 'MATCH' : `→ ${record.expected}`}</span></div>)}</div>
              {status === 'complete' && records.length > 0 && <section className="engine-review">
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
              {status === 'complete' && <button className="reset-button" onClick={resetSession}>Start another session</button>}
            </>
          )}
          <div className="panel-note"><span>♟</span><p>Historical match is based on the original move, not engine strength. Review analysis arrives after the full game.</p></div>
        </aside>
      </section>
    </main>
  )
}
