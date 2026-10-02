import { Chess } from 'chess.js'
import type { MoveMark } from '../../shared/badges.ts'
import type { LastMove } from '../hooks/useClickToMove'
import type { Side } from '../types'

// One of your moves in a finished training session or challenge: the position
// before it, your move and the master's, its ?/??/! mark once analyzed, the
// centipawn loss of your move and the master's (for the accuracy plot), and the
// saved scores of the best move and yours, in centipawns for the mover (mates
// as +-100000). The analysis fields are missing for games saved before they
// existed and null for moves never analyzed.
export type ReviewMove = {
  ply: number
  fen: string
  attempted: string
  expected: string
  attemptedUci: string
  expectedUci: string
  correct: boolean
  mark: MoveMark | null
  cpl?: number | null
  originalCpl?: number | null
  bestScore?: number | null
  attemptedScore?: number | null
}

// Another challenger's centipawn loss at each ply they played, for the accuracy plot.
export type OtherPlayerProgress = { username: string; moves: Array<{ ply: number; cpl: number | null }> }

// What the analysis page opens: a training session (by its stats id) or a challenge.
export type ReviewSource = { kind: 'training'; sessionId: string } | { kind: 'challenge'; challengeId: string }

// The analysis page's game: a title and detail line, your side, the engine
// depth, your accuracy once analyzed, and your moves.
export type ReviewGame = { title: string; details: string; side: Side; depth: number; accuracy: number | null; moves: ReviewMove[]; others: OtherPlayerProgress[] }

// One ply of the review: the position on the board and the move that led
// there. `kind` says whose move it was: the historical opponent's reply, your
// move, or the master's move that replaced a deviation of yours; `moveIndex`
// is the row of your move it belongs to (the move about to come, for a reply).
export type ReviewStep = { kind: 'start' | 'reply' | 'yours' | 'master'; fen: string; moveIndex: number; ply: number; san: string | null; lastMove: LastMove | null }

export const markClasses: Record<MoveMark, string> = { '?!': 'mark-inaccuracy', '?': 'mark-mistake', '??': 'mark-blunder', '!': 'mark-only' }
// Tints for the move-list rows of marked moves.
export const markRowClasses: Record<MoveMark, string> = { '?!': 'row-inaccuracy', '?': 'row-mistake', '??': 'row-blunder', '!': 'row-only' }

export function plyLabel(ply: number) {
  return `${Math.floor(ply / 2) + 1}${ply % 2 === 1 ? '...' : '.'}`
}

// The ply a position is at, from its move number and side to move.
export function plyOf(fen: string) {
  const [, turn, , , , moveNumber] = fen.split(' ')
  return (Number(moveNumber) - 1) * 2 + (turn === 'b' ? 1 : 0)
}

// Fens of the same position can differ in their counters and en passant field.
export function samePosition(a: string, b: string) {
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

// The game one ply at a time: before each of your moves the opponent's reply,
// then your move, then (where you deviated) the master's move instead.
export function reviewSteps(moves: ReviewMove[]) {
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

// A saved score (centipawns for the side that moved at `ply`) from White's
// point of view, as the engine panel shows scores: "+0.85", "-5.14", or
// "White mates" for a mate.
export function savedScoreForWhite(score: number, ply: number) {
  const value = ply % 2 === 0 ? score : -score
  if (Math.abs(value) >= 100000) return value > 0 ? 'White mates' : 'Black mates'
  const pawns = value / 100
  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(2)}`
}

// Whether the moves carry the centipawn losses the accuracy plot needs.
export function hasAccuracyData(moves: ReviewMove[]) {
  return moves.some((move) => move.cpl !== null && move.cpl !== undefined)
}

// The step's move, such as "13... Nf6"; null before your first move.
export function stepMove(step: ReviewStep) {
  return step.san ? `${plyLabel(step.ply)} ${step.san}` : null
}
