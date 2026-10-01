import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Chess } from 'chess.js'
import { Chessboard } from 'react-chessboard'
import type { MoveMark } from '../../shared/badges.ts'
import { ClientStockfishEngine } from '../clientStockfish'
import type { EngineScore, LiveAnalysis } from '../clientStockfish'
import { lastMoveFromUci, lastMoveStyle } from '../hooks/useClickToMove'
import type { Side } from '../types'
import type { ChallengeSnapshot } from './types'

type ReviewMove = NonNullable<ChallengeSnapshot['me']>['moves'][number]

const markClasses: Record<MoveMark, string> = { '?': 'mark-mistake', '??': 'mark-blunder', '!': 'mark-only' }
const engineLineCount = 3
const shownPlies = 8
// Finished searches by depth and position, so stepping back shows them at once.
const finishedAnalyses = new Map<string, LiveAnalysis>()

function positionAfter(move: ReviewMove) {
  const chess = new Chess(move.fen)
  chess.move({ from: move.attemptedUci.slice(0, 2), to: move.attemptedUci.slice(2, 4), promotion: move.attemptedUci[4] })
  return chess.fen()
}

function moveLabel(move: ReviewMove) {
  return `${Math.floor(move.ply / 2) + 1}${move.ply % 2 === 1 ? '...' : '.'}`
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
        <strong className="engine-eval">{formatScore(analysis.lines[0].score, whiteToMove)}</strong>
        <div className="engine-lines">{analysis.lines.map((line, index) => <div className="engine-line" key={index}>
          <b>{formatScore(line.score, whiteToMove)}</b>
          <span>{lineToSan(fen, line.pv)}</span>
        </div>)}</div>
      </>}
  </div>
}

// Steps through a player's own challenge moves on a board: each step shows the
// position after their move, with an arrow for the master's move where they
// deviated, and the engine's view of that position.
export function ChallengeReview({ moves, side, depth }: { moves: ReviewMove[]; side: Side; depth: number }) {
  // -1 is the position before the player's first move.
  const [index, setIndex] = useState(-1)
  const listRef = useRef<HTMLDivElement>(null)
  const positions = useMemo(() => moves.map(positionAfter), [moves])
  const move = index >= 0 ? moves[index] : null
  const fen = move ? positions[index] : moves[0].fen
  const lastMove = lastMoveFromUci(move?.attemptedUci)
  const masterMove = move && !move.correct ? lastMoveFromUci(move.expectedUci) : null

  // Keeps the selected move visible inside the list without scrolling the page.
  useEffect(() => {
    const list = listRef.current
    const row = list?.querySelector<HTMLElement>(`[data-index="${index}"]`)
    if (!list || !row) return
    if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop
    else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight
  }, [index])

  function step(delta: number) {
    setIndex((previous) => Math.max(-1, Math.min(moves.length - 1, previous + delta)))
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'ArrowLeft') step(-1)
    else if (event.key === 'ArrowRight') step(1)
    else return
    event.preventDefault()
  }

  return <div className="challenge-review" tabIndex={-1} onKeyDown={onKeyDown}>
    <div className="move-log review-moves" ref={listRef}>
      <p className="section-label">YOUR MOVES</p>
      {moves.map((record, recordIndex) => <button key={record.ply} data-index={recordIndex} className={`move-row ${recordIndex === index ? 'selected' : ''}`} onClick={() => setIndex(recordIndex)}>
        <span>{moveLabel(record)}</span>
        <strong>{record.attempted}{record.mark && <span className={`move-mark ${markClasses[record.mark]}`}>{record.mark}</span>}</strong>
        <span className={record.correct ? 'match' : 'deviation'}>{record.correct ? 'MATCH' : `→ ${record.expected}`}</span>
      </button>)}
    </div>
    <div className="review-board-column">
      <div className="board-wrap review-board">
        <Chessboard options={{
          position: fen,
          boardOrientation: side === 'b' ? 'black' : 'white',
          allowDragging: false,
          arrows: masterMove ? [{ startSquare: masterMove.from, endSquare: masterMove.to, color: 'rgba(44, 102, 93, .85)' }] : [],
          squareStyles: lastMove ? { [lastMove.from]: lastMoveStyle, [lastMove.to]: lastMoveStyle } : {},
          boardStyle: { borderRadius: '2px', boxShadow: '0 18px 50px rgba(18, 28, 35, .18)' },
        }} />
      </div>
      <div className="review-controls">
        <button className="table-action secondary" disabled={index === -1} onClick={() => setIndex(-1)} title="Back to the start">⏮ Start</button>
        <button className="table-action secondary" disabled={index === -1} onClick={() => step(-1)} title="Previous move (←)">◀ Prev</button>
        <button className="table-action secondary" disabled={index === moves.length - 1} onClick={() => step(1)} title="Next move (→)">Next ▶</button>
        <span>{move
          ? <>{moveLabel(move)} {move.attempted}{move.mark}{!move.correct && <> · the master played <b>{move.expected}</b></>}</>
          : 'Before your first move'}</span>
      </div>
      <EnginePanel fen={fen} depth={depth} />
    </div>
  </div>
}
