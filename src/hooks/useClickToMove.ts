import { useState } from 'react'
import type { CSSProperties } from 'react'
import { Chess } from 'chess.js'
import type { Square } from 'chess.js'

const lastMoveStyle: CSSProperties = { background: 'rgba(205, 210, 106, .55)' }
const selectedStyle: CSSProperties = { background: 'rgba(212, 138, 54, .55)' }
const targetStyle: CSSProperties = { background: 'radial-gradient(circle, rgba(24, 36, 42, .32) 22%, transparent 24%)', cursor: 'pointer' }
const captureStyle: CSSProperties = { background: 'radial-gradient(circle, transparent 62%, rgba(24, 36, 42, .32) 64%)', cursor: 'pointer' }

// Click-to-move for a board that also allows drag and drop: click one of the
// side to move's pieces to select it (its legal targets are marked), then click
// a target to play the move through the same handler as a drop. Clicking the
// piece again, or an empty or illegal square, clears the selection; clicking
// another own piece selects that one instead. A selection belongs to the
// position it was made in, so it disappears once the position changes.
// The squares of `lastMove` are highlighted, under any selection.
export type LastMove = { from: string; to: string }

// Reads the from and to squares of a UCI move such as e2e4 or e7e8q.
export function lastMoveFromUci(uci: string | null | undefined): LastMove | null {
  return uci && uci.length >= 4 ? { from: uci.slice(0, 2), to: uci.slice(2, 4) } : null
}

export function useClickToMove(fen: string, canMove: boolean, onMove: (from: string, to: string) => void, lastMove: LastMove | null = null) {
  const [selection, setSelection] = useState<{ fen: string; square: Square } | null>(null)
  const selected = canMove && selection?.fen === fen ? selection.square : null

  function legalMoves(square: Square) {
    try {
      return new Chess(fen).moves({ square, verbose: true })
    } catch {
      return []
    }
  }

  const targets = selected ? legalMoves(selected) : []

  function onSquareClick({ square }: { square: string }) {
    if (!canMove) return
    const clicked = square as Square
    if (selected && clicked !== selected && targets.some((move) => move.to === clicked)) {
      setSelection(null)
      onMove(selected, clicked)
      return
    }
    // Only the side to move has legal moves, so this also ignores the other side's pieces.
    setSelection(clicked !== selected && legalMoves(clicked).length > 0 ? { fen, square: clicked } : null)
  }

  const squareStyles: Record<string, CSSProperties> = {}
  if (lastMove) {
    squareStyles[lastMove.from] = lastMoveStyle
    squareStyles[lastMove.to] = lastMoveStyle
  }
  if (selected) {
    squareStyles[selected] = selectedStyle
    for (const move of targets) squareStyles[move.to] = move.captured ? captureStyle : targetStyle
  }

  return { onSquareClick, squareStyles }
}
