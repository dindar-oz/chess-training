import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Chess } from 'chess.js'
import { Chessboard } from 'react-chessboard'
import { ClientStockfishEngine } from '../clientStockfish'
import type { EngineScore, LiveAnalysis } from '../clientStockfish'
import { lastMoveFromUci, useClickToMove } from '../hooks/useClickToMove'
import type { Side } from '../types'
import { StepCaption } from './StepCaption'
import { markClasses, markRowClasses, plyLabel, reviewSteps, samePosition, stepMove } from './steps'
import type { ReviewMove, ReviewStep } from './steps'

const engineLineCount = 3
const shownPlies = 8
// Finished searches by depth and position, so stepping back shows them at once.
const finishedAnalyses = new Map<string, LiveAnalysis>()

// Engine scores are for the side to move; the panel shows them for White.
function formatScore(score: EngineScore, whiteToMove: boolean) {
  const sign = whiteToMove ? 1 : -1
  if (score.mate !== null) {
    const mate = score.mate * sign
    return mate >= 0 ? `#${mate}` : `-#${-mate}`
  }
  const pawns = ((score.cp ?? 0) * sign) / 100
  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(2)}`
}

function lineToSan(fen: string, pv: string[]) {
  const chess = new Chess(fen)
  const parts: string[] = []
  for (const uci of pv.slice(0, shownPlies)) {
    const white = chess.turn() === 'w'
    const number = chess.moveNumber()
    try {
      const move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
      parts.push(white ? `${number}. ${move.san}` : parts.length === 0 ? `${number}... ${move.san}` : move.san)
    } catch {
      break
    }
  }
  return parts.join(' ')
}

// Live engine lines for the position on the board, deepening up to the
// game's review depth in this browser.
function EnginePanel({ fen, depth }: { fen: string; depth: number }) {
  const engine = useMemo(() => new ClientStockfishEngine(), [])
  const key = `${depth}|${fen}`
  const [live, setLive] = useState<{ key: string; analysis: LiveAnalysis } | null>(null)
  const chess = useMemo(() => new Chess(fen), [fen])
  const gameOver = chess.isGameOver()
  const finished = finishedAnalyses.get(key)

  useEffect(() => {
    if (gameOver || finishedAnalyses.has(key)) return
    return engine.analyzeLive(fen, depth, engineLineCount, (analysis) => {
      if (analysis.done) finishedAnalyses.set(key, analysis)
      setLive({ key, analysis })
    })
  }, [depth, engine, fen, gameOver, key])

  const analysis = finished ?? (live?.key === key ? live.analysis : null)
  const whiteToMove = chess.turn() === 'w'
  return <div className="review-panel engine-panel" aria-live="polite">
    <div className="engine-panel-head">
      <p className="section-label">ENGINE ANALYSIS</p>
      <span>{gameOver ? '' : analysis ? `DEPTH ${analysis.depth}/${depth}${analysis.done ? '' : '...'}` : 'STARTING...'}</span>
    </div>
    {gameOver ? <p className="empty-log">{chess.isCheckmate() ? 'Checkmate.' : 'The game is drawn.'}</p>
      : !analysis || analysis.lines.length === 0 ? <p className="empty-log">Analyzing this position in your browser...</p>
      : <div className="engine-lines">{analysis.lines.map((line, index) => <div className="engine-line" key={index}>
        <b>{formatScore(line.score, whiteToMove)}</b>
        <span>{lineToSan(fen, line.pv)}</span>
      </div>)}</div>}
  </div>
}

// A move played on the review board, away from the game line.
type AnalysisMove = { fen: string; san: string; number: number; white: boolean; from: string; to: string }

// What every side panel sees: the position on the board and where it is in the
// game. `analysis` is the number of moves played off the game line (0 on it).
export type ReviewPanelContext = { fen: string; depth: number; step: ReviewStep; move: ReviewMove; analysis: number }

const markNames = { '??': 'a blunder', '?': 'a mistake', '!': 'the only good move' } as const

// Explains the step on show: whose move it was, how it compared with the
// master's, and its mark.
function MoveInsightPanel({ step, move, analysis }: ReviewPanelContext) {
  const label = stepMove(step)
  let title: string
  let text: string
  if (analysis > 0) {
    title = 'Your own line'
    text = `You are ${analysis} ${analysis === 1 ? 'move' : 'moves'} into a line of your own from ${label ?? 'the start'}. The engine follows it; return to the game position when you're done.`
  } else if (step.kind === 'yours') {
    title = move.correct ? "You found the master's move" : "You left the master's line"
    text = move.correct ? `${label} is what the master played.` : `You played ${label}; the master played ${move.expected} (the green arrow).`
    if (move.mark) text += ` The engine rates your move ${markNames[move.mark]} (${move.mark}).`
  } else if (step.kind === 'master') {
    title = "The master's move"
    text = `${label} replaced your ${move.attempted}, and the game went on from here.`
  } else {
    title = label ? 'The game continued' : 'Before your first move'
    text = `${label ? `${label} was played. ` : ''}Your move ${plyLabel(move.ply)} comes next. Try to find it before you step on.`
  }
  return <div className="review-panel move-insight">
    <p className="section-label">THIS MOVE</p>
    <strong>{title}</strong>
    <p>{text}</p>
  </div>
}

// The side panels, top to bottom. A new panel is a component taking the
// panel context, added here.
const reviewPanels: Array<{ id: string; Panel: (context: ReviewPanelContext) => ReactNode }> = [
  { id: 'move', Panel: MoveInsightPanel },
  { id: 'engine', Panel: ({ fen, depth }) => <EnginePanel fen={fen} depth={depth} /> },
]

// What the space below the board sees: where the board is in your moves (n
// while your move n or the master's replacing it is on show, n - 0.5 before
// it, null before your first move), and a way to jump the board to a move.
export type BelowBoardContext = { position: number | null; goToMove: (moveIndex: number) => void }

// Steps through a played game one ply at a time on a board: the opponent's
// replies, your own moves, with an arrow for the master's move where you
// deviated, and then that master's move. The engine gives its view of each
// position. Moves played on the board branch into an analysis line from the
// step on show; the game position it left comes back with "Return to game
// position" (or a row click). The arrow keys step anywhere on the page.
export function ReviewBoard({ moves, side, depth, belowBoard }: { moves: ReviewMove[]; side: Side; depth: number; belowBoard?: (context: BelowBoardContext) => ReactNode }) {
  const steps = useMemo(() => reviewSteps(moves), [moves])
  const [index, setIndex] = useState(0)
  // The analysis line from the step on show and how many of its moves are on
  // the board (at least one); null while the board follows the game.
  const [analysis, setAnalysis] = useState<{ moves: AnalysisMove[]; shown: number } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const current = steps[index]
  const move = moves[current.moveIndex]
  // The row of your move is selected while its move or the master's is on show.
  const selectedRow = current.kind === 'yours' || current.kind === 'master' ? current.moveIndex : null
  const analysisMove = analysis ? analysis.moves[analysis.shown - 1] : null
  const fen = analysisMove?.fen ?? current.fen
  const lastMove = analysisMove ?? current.lastMove
  const masterMove = !analysis && current.kind === 'yours' && !move.correct ? lastMoveFromUci(move.expectedUci) : null
  const clickToMove = useClickToMove(fen, true, (from, to) => { playMove(from, to) }, lastMove)

  // Keeps the current move visible inside the list without scrolling the page.
  useEffect(() => {
    const list = listRef.current
    const row = list?.querySelector<HTMLElement>(`[data-index="${current.moveIndex}"]`)
    if (!list || !row) return
    if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop
    else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight
  }, [current.moveIndex])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select')) return
      if (event.key === 'ArrowLeft') step(-1)
      else if (event.key === 'ArrowRight') step(1)
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  function goTo(target: number) {
    setAnalysis(null)
    setIndex(target)
  }

  function goToMove(moveIndex: number) {
    goTo(steps.findIndex((candidate) => candidate.kind === 'yours' && candidate.moveIndex === moveIndex))
  }

  const position = current.kind === 'start' ? null : current.kind === 'reply' ? current.moveIndex - 0.5 : current.moveIndex

  // In analysis, steps along the analysis line; stepping back past its first
  // move returns to the game position.
  function step(delta: number) {
    if (analysis) {
      const shown = Math.min(analysis.moves.length, analysis.shown + delta)
      setAnalysis(shown > 0 ? { ...analysis, shown } : null)
      return
    }
    setIndex((previous) => Math.max(0, Math.min(steps.length - 1, previous + delta)))
  }

  function playMove(from: string, to: string | null) {
    if (!to) return false
    const chess = new Chess(fen)
    const white = chess.turn() === 'w'
    const number = chess.moveNumber()
    let played
    try {
      played = chess.move({ from, to, promotion: 'q' })
    } catch {
      return false
    }
    // A move of the game just steps along it: the next ply, or the master's
    // move when the next ply is a deviation of yours.
    if (!analysis) {
      const target = [index + 1, index + 2].find((candidate) => steps[candidate] && samePosition(steps[candidate].fen, chess.fen())
        && (candidate === index + 1 || steps[candidate].kind === 'master'))
      if (target !== undefined) {
        setIndex(target)
        return true
      }
    }
    const next = { fen: chess.fen(), san: played.san, number, white, from: played.from, to: played.to }
    const line = analysis ? analysis.moves.slice(0, analysis.shown) : []
    setAnalysis({ moves: [...line, next], shown: line.length + 1 })
    return true
  }

  return <div className="review-layout">
    <div className="move-log review-moves" ref={listRef}>
      <p className="section-label">YOUR MOVES</p>
      {moves.map((record, recordIndex) => <button key={record.ply} data-index={recordIndex} className={`move-row ${record.mark ? `marked ${markRowClasses[record.mark]}` : ''} ${recordIndex === selectedRow ? (analysis ? 'selected branched' : 'selected') : ''}`} onClick={() => goToMove(recordIndex)}>
        <span>{plyLabel(record.ply)}</span>
        <strong>{record.attempted}{record.mark && <span className={`move-mark ${markClasses[record.mark]}`}>{record.mark}</span>}</strong>
        <span className={record.correct ? 'match' : 'deviation'}>{record.correct ? 'MATCH' : `→ ${record.expected}`}</span>
      </button>)}
    </div>
    <div className="review-board-column">
      <div className={`board-wrap review-board ${analysis ? 'analyzing' : ''}`}>
        <Chessboard options={{
          position: fen,
          boardOrientation: side === 'b' ? 'black' : 'white',
          onPieceDrop: ({ sourceSquare, targetSquare }) => playMove(sourceSquare, targetSquare),
          onSquareClick: clickToMove.onSquareClick,
          arrows: masterMove ? [{ startSquare: masterMove.from, endSquare: masterMove.to, color: 'rgba(44, 102, 93, .85)' }] : [],
          squareStyles: clickToMove.squareStyles,
          boardStyle: { borderRadius: '2px', boxShadow: '0 18px 50px rgba(18, 28, 35, .18)' },
        }} />
        {analysis && <span className="analysis-tag">ANALYSIS · OFF THE GAME LINE</span>}
      </div>
      <div className="review-controls">
        <button className="table-action secondary" disabled={index === 0 && !analysis} onClick={() => goTo(0)} title="Back to the start">⏮ Start</button>
        <button className="table-action secondary" disabled={index === 0 && !analysis} onClick={() => step(-1)} title="Previous move (←)">◀ Prev</button>
        <button className="table-action secondary" disabled={analysis ? analysis.shown === analysis.moves.length : index === steps.length - 1} onClick={() => step(1)} title="Next move (→)">Next ▶</button>
        {analysis && <button className="table-action" onClick={() => setAnalysis(null)} title="Back to the position you started analyzing from">↩ Return to game position</button>}
        <span>{analysis
          ? <>From {stepMove(current) ?? 'the start'}: {analysis.moves.map((line, lineIndex) => {
            const text = line.white ? `${line.number}. ${line.san}` : lineIndex === 0 ? `${line.number}... ${line.san}` : line.san
            return <span key={lineIndex} className={lineIndex === analysis.shown - 1 ? 'analysis-current' : lineIndex >= analysis.shown ? 'analysis-ahead' : ''}>{lineIndex > 0 && ' '}{text}</span>
          })}</>
          : <StepCaption step={current} move={move} />}</span>
      </div>
      {belowBoard?.({ position, goToMove })}
    </div>
    <aside className="review-panels">
      {reviewPanels.map(({ id, Panel }) => <Panel key={id} fen={fen} depth={depth} step={current} move={move} analysis={analysis?.shown ?? 0} />)}
    </aside>
  </div>
}
