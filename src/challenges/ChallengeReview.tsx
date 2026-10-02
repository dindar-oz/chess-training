import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Chess } from 'chess.js'
import { Chessboard } from 'react-chessboard'
import type { MoveMark } from '../../shared/badges.ts'
import { ClientStockfishEngine } from '../clientStockfish'
import type { EngineScore, LiveAnalysis } from '../clientStockfish'
import { lastMoveFromUci, useClickToMove } from '../hooks/useClickToMove'
import type { LastMove } from '../hooks/useClickToMove'
import type { Side } from '../types'
import type { ChallengeSnapshot } from './types'

type ReviewMove = NonNullable<ChallengeSnapshot['me']>['moves'][number]

const markClasses: Record<MoveMark, string> = { '?': 'mark-mistake', '??': 'mark-blunder', '!': 'mark-only' }
// Tints for the move-list rows of marked moves.
const markRowClasses: Record<MoveMark, string> = { '?': 'row-mistake', '??': 'row-blunder', '!': 'row-only' }
const engineLineCount = 3
const shownPlies = 8
// Finished searches by depth and position, so stepping back shows them at once.
const finishedAnalyses = new Map<string, LiveAnalysis>()

// One ply of the review: the position on the board and the move that led
// there. `kind` says whose move it was: the historical opponent's reply, your
// move, or the master's move that replaced a deviation of yours; `moveIndex`
// is the row of your move it belongs to (the move about to come, for a reply).
type ReviewStep = { kind: 'start' | 'reply' | 'yours' | 'master'; fen: string; moveIndex: number; ply: number; san: string | null; lastMove: LastMove | null }

function plyLabel(ply: number) {
  return `${Math.floor(ply / 2) + 1}${ply % 2 === 1 ? '...' : '.'}`
}

function moveLabel(move: ReviewMove) {
  return plyLabel(move.ply)
}

// Fens of the same position can differ in their counters and en passant field.
function samePosition(a: string, b: string) {
  return a.split(' ').slice(0, 3).join(' ') === b.split(' ').slice(0, 3).join(' ')
}

function playUci(fen: string, uci: string) {
  const chess = new Chess(fen)
  const move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
  return { fen: chess.fen(), san: move.san, lastMove: { from: move.from, to: move.to } }
}

// The legal move from `fen` that reaches `target`, if any.
function findMove(fen: string, target: string) {
  const chess = new Chess(fen)
  for (const move of chess.moves({ verbose: true })) {
    if (samePosition(move.after, target)) return { san: move.san, lastMove: { from: move.from, to: move.to } }
  }
  return null
}

// The challenge one ply at a time: before each of your moves the opponent's
// reply, then your move, then (where you deviated) the master's move instead.
function reviewSteps(moves: ReviewMove[]) {
  const steps: ReviewStep[] = []
  let previous: string | null = null
  moves.forEach((move, moveIndex) => {
    const reply = previous ? findMove(previous, move.fen) : null
    steps.push({ kind: moveIndex === 0 ? 'start' : 'reply', fen: move.fen, moveIndex, ply: move.ply - 1, san: reply?.san ?? null, lastMove: reply?.lastMove ?? null })
    const yours = playUci(move.fen, move.attemptedUci)
    steps.push({ kind: 'yours', fen: yours.fen, moveIndex, ply: move.ply, san: yours.san, lastMove: yours.lastMove })
    previous = yours.fen
    if (!move.correct) {
      const master = playUci(move.fen, move.expectedUci)
      steps.push({ kind: 'master', fen: master.fen, moveIndex, ply: move.ply, san: master.san, lastMove: master.lastMove })
      previous = master.fen
    }
  })
  return steps
}

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
// challenge's review depth in this browser.
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
  return <div className="engine-panel" aria-live="polite">
    <div className="engine-panel-head">
      <p className="section-label">ENGINE ANALYSIS</p>
      <span>{gameOver ? '' : analysis ? `DEPTH ${analysis.depth}/${depth}${analysis.done ? '' : '...'}` : 'STARTING...'}</span>
    </div>
    {gameOver ? <p className="empty-log">{chess.isCheckmate() ? 'Checkmate.' : 'The game is drawn.'}</p>
      : !analysis || analysis.lines.length === 0 ? <p className="empty-log">Analyzing this position in your browser...</p>
      : <>
        <div className="engine-lines">{analysis.lines.map((line, index) => <div className="engine-line" key={index}>
          <b>{formatScore(line.score, whiteToMove)}</b>
          <span>{lineToSan(fen, line.pv)}</span>
        </div>)}</div>
      </>}
  </div>
}

// A move played on the review board, away from the challenge line.
type AnalysisMove = { fen: string; san: string; number: number; white: boolean; from: string; to: string }

// Steps through a player's challenge one ply at a time on a board: the
// opponent's replies, their own moves, with an arrow for the master's move
// where they deviated, and then that master's move. The engine gives its view
// of each position. Moves played on the board branch into an analysis line
// from the step on show; the challenge position it left comes back with
// "Return to challenge position" (or a row click).
export function ChallengeReview({ moves, side, depth }: { moves: ReviewMove[]; side: Side; depth: number }) {
  const steps = useMemo(() => reviewSteps(moves), [moves])
  const [index, setIndex] = useState(0)
  // The analysis line from the step on show and how many of its moves are on
  // the board (at least one); null while the board follows the challenge.
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

  function goTo(target: number) {
    setAnalysis(null)
    setIndex(target)
  }

  // In analysis, steps along the analysis line; stepping back past its first
  // move returns to the challenge position.
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
    // A move of the challenge just steps along it: the next ply, or the
    // master's move when the next ply is a deviation of yours.
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

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'ArrowLeft') step(-1)
    else if (event.key === 'ArrowRight') step(1)
    else return
    event.preventDefault()
  }

  const stepMove = current.san ? `${plyLabel(current.ply)} ${current.san}` : null
  return <div className="challenge-review" tabIndex={-1} onKeyDown={onKeyDown}>
    <div className="move-log review-moves" ref={listRef}>
      <p className="section-label">YOUR MOVES</p>
      {moves.map((record, recordIndex) => <button key={record.ply} data-index={recordIndex} className={`move-row ${record.mark ? `marked ${markRowClasses[record.mark]}` : ''} ${recordIndex === selectedRow ? (analysis ? 'selected branched' : 'selected') : ''}`} onClick={() => goTo(steps.findIndex((candidate) => candidate.kind === 'yours' && candidate.moveIndex === recordIndex))}>
        <span>{moveLabel(record)}</span>
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
        {analysis && <span className="analysis-tag">ANALYSIS · OFF THE CHALLENGE LINE</span>}
      </div>
      <div className="review-controls">
        <button className="table-action secondary" disabled={index === 0 && !analysis} onClick={() => goTo(0)} title="Back to the start">⏮ Start</button>
        <button className="table-action secondary" disabled={index === 0 && !analysis} onClick={() => step(-1)} title="Previous move (←)">◀ Prev</button>
        <button className="table-action secondary" disabled={analysis ? analysis.shown === analysis.moves.length : index === steps.length - 1} onClick={() => step(1)} title="Next move (→)">Next ▶</button>
        {analysis && <button className="table-action" onClick={() => setAnalysis(null)} title="Back to the position you started analyzing from">↩ Return to challenge position</button>}
        <span>{analysis
          ? <>From {stepMove ?? 'the start'}: {analysis.moves.map((line, lineIndex) => {
            const text = line.white ? `${line.number}. ${line.san}` : lineIndex === 0 ? `${line.number}... ${line.san}` : line.san
            return <span key={lineIndex} className={lineIndex === analysis.shown - 1 ? 'analysis-current' : lineIndex >= analysis.shown ? 'analysis-ahead' : ''}>{lineIndex > 0 && ' '}{text}</span>
          })}</>
          : current.kind === 'yours'
          ? <>Your move {stepMove}{move.mark}{!move.correct && <> · the master played <b>{move.expected}</b></>}</>
          : current.kind === 'master' ? <>The master's move <b>{stepMove}</b></>
          : stepMove ? <>The game continued {stepMove}</>
          : 'Before your first move'}</span>
      </div>
      <EnginePanel fen={fen} depth={depth} />
    </div>
  </div>
}
