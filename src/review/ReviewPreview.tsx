import { useMemo, useState } from 'react'
import { Chessboard } from 'react-chessboard'
import { lastMoveFromUci, lastMoveStyle } from '../hooks/useClickToMove'
import type { Side } from '../types'
import { StepCaption } from './StepCaption'
import { reviewSteps } from './steps'
import type { ReviewMove } from './steps'

// A small board on a results screen that steps through your moves one ply at a
// time with Prev and Next only; "Analyze this game" opens the full analysis page.
export function ReviewPreview({ moves, side, onAnalyze }: { moves: ReviewMove[]; side: Side; onAnalyze: () => void }) {
  const steps = useMemo(() => reviewSteps(moves), [moves])
  const [index, setIndex] = useState(0)
  const current = steps[index]
  const move = moves[current.moveIndex]
  const masterMove = current.kind === 'yours' && !move.correct ? lastMoveFromUci(move.expectedUci) : null
  const lastMove = current.lastMove

  return <section className="review-preview">
    <div className="review-preview-head">
      <p className="section-label">YOUR GAME</p>
      <button className="table-action" onClick={onAnalyze}><span className="button-icon" aria-hidden="true">⌕</span> Analyze this game</button>
    </div>
    <div className="board-wrap review-preview-board">
      <Chessboard options={{
        id: 'review-preview-board',
        position: current.fen,
        boardOrientation: side === 'b' ? 'black' : 'white',
        allowDragging: false,
        arrows: masterMove ? [{ startSquare: masterMove.from, endSquare: masterMove.to, color: 'rgba(44, 102, 93, .85)' }] : [],
        squareStyles: lastMove ? { [lastMove.from]: lastMoveStyle, [lastMove.to]: lastMoveStyle } : {},
        boardStyle: { borderRadius: '2px', boxShadow: '0 12px 30px rgba(18, 28, 35, .16)' },
      }} />
    </div>
    <div className="review-controls">
      <button className="table-action secondary" disabled={index === 0} onClick={() => setIndex(index - 1)} title="Previous move">◀ Prev</button>
      <button className="table-action secondary" disabled={index === steps.length - 1} onClick={() => setIndex(index + 1)} title="Next move">Next ▶</button>
    </div>
    <p className="review-preview-caption"><StepCaption step={current} move={move} /></p>
  </section>
}
