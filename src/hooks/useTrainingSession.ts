import { useEffect, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import type { Move } from 'chess.js'
import { useClock } from './useClock'
import { moveSound, play } from '../sounds'
import type { TimeControl } from '../timeControl'
import type { Side } from '../types'

export type SessionStatus = 'selecting' | 'playing' | 'correction' | 'complete'
export type EndReason = 'completed' | 'timeout'

export type MoveRecord = {
  moveNumber: number
  fenBefore: string
  expected: string
  expectedUci: string
  attempted: string
  attemptedUci: string
  correct: boolean
}

const correctionDelayMs = 1100
const selectingMessage = 'Choose a side to begin this classic game.'

// Replays a historical game where the learner plays one side and the other side's
// moves are replayed instantly. Deviations are recorded, then the historical line is
// restored. With a time control, only the learner's clock runs: it pauses while
// the historical line is restored and gains the increment after each learner move.
export function useTrainingSession(originalMoves: Move[]) {
  const [side, setSide] = useState<Side>('w')
  const [game, setGame] = useState(() => new Chess())
  const [currentPly, setCurrentPly] = useState(0)
  const [status, setStatus] = useState<SessionStatus>('selecting')
  const [endReason, setEndReason] = useState<EndReason | null>(null)
  const [message, setMessage] = useState(selectingMessage)
  const [records, setRecords] = useState<MoveRecord[]>([])
  const [timeControl, setTimeControl] = useState<TimeControl | null>(null)
  const correctionTimer = useRef<number | null>(null)
  const clock = useClock(() => {
    play('timeout')
    setStatus('complete')
    setEndReason('timeout')
    setMessage("Time's up. The moves you played will be analyzed.")
  })

  const expectedMove = originalMoves[currentPly]
  const isUsersTurn = expectedMove?.color === side

  function clearCorrectionTimer() {
    if (correctionTimer.current !== null) window.clearTimeout(correctionTimer.current)
    correctionTimer.current = null
  }

  useEffect(() => clearCorrectionTimer, [])

  // Replays the historical opponent's moves up to your next turn, with a softer
  // "reply" sound for the last one (or the end-of-session sound when done).
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
    if (nextPly > startPly) play(moveSound(originalMoves[nextPly - 1].san, true), 0.3)
    if (complete) {
      play('sessionEnd', 0.6)
      clock.stop()
      setStatus('complete')
      setEndReason('completed')
      setMessage('Game complete. Starting engine analysis.')
    }
    return complete
  }

  function start(selectedSide: Side, selectedTimeControl: TimeControl | null) {
    clearCorrectionTimer()
    setSide(selectedSide)
    setTimeControl(selectedTimeControl)
    clock.reset(selectedTimeControl)
    setGame(new Chess())
    setCurrentPly(0)
    setRecords([])
    setEndReason(null)
    setStatus('playing')
    setMessage(selectedSide === 'w' ? 'Your move. Play the move from the original game.' : 'White starts. Watch the original move.')
    play('sessionStart')
    const complete = selectedSide === 'b' && replayUntilUserTurn(0, selectedSide)
    if (!complete) clock.start()
  }

  function handleMove(sourceSquare: string, targetSquare: string | null, promotion?: string) {
    if (status !== 'playing' || !isUsersTurn || !expectedMove || !targetSquare) return false
    // The display tick may not have flagged yet; a move after the flag doesn't count.
    if (clock.enabled && clock.remainingMs() <= 0) return false

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

    clock.stop()
    clock.addIncrement()
    play(moveSound(attempted.san))
    const record: MoveRecord = {
      moveNumber: Math.floor(currentPly / 2) + 1,
      fenBefore: game.fen(),
      expected: expectedMove.san,
      expectedUci: expectedMove.lan,
      attempted: attempted.san,
      attemptedUci: attempted.lan,
      correct: attempted.lan === expectedMove.lan,
    }
    setRecords([...records, record])

    if (!record.correct) {
      play('deviation', 0.12)
      setGame(nextGame)
      setStatus('correction')
      setMessage(`Legal move, but the original game played ${expectedMove.san}.`)
      correctionTimer.current = window.setTimeout(() => {
        correctionTimer.current = null
        const complete = replayUntilUserTurn(currentPly + 1, side)
        if (!complete) {
          setStatus('playing')
          setMessage('The historical line is restored. Keep going.')
          clock.start()
        }
      }, correctionDelayMs)
      return true
    }

    const complete = replayUntilUserTurn(currentPly + 1, side)
    if (!complete) {
      setMessage('Matched the original game.')
      clock.start()
    }
    return true
  }

  function reset() {
    clearCorrectionTimer()
    clock.reset(null)
    setStatus('selecting')
    setEndReason(null)
    setMessage(selectingMessage)
    setGame(new Chess())
    setCurrentPly(0)
    setRecords([])
  }

  return { side, game, currentPly, status, endReason, message, setMessage, records, timeControl, clock, expectedMove, isUsersTurn, start, handleMove, reset }
}
