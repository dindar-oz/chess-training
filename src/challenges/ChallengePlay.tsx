import { useEffect, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import { Chessboard } from 'react-chessboard'
import { correctionDelayMs } from '../../shared/challengeRules.ts'
import { ChessClock } from '../components/ChessClock'
import { moveSound, play } from '../sounds'
import { formatClock } from '../timeControl'
import { ChallengeChat } from './ChallengeChat'
import { lastMoveFromUci, useClickToMove } from '../hooks/useClickToMove'
import type { LastMove } from '../hooks/useClickToMove'
import { useChallenges } from './context'
import { liveRemainingMs } from './types'
import type { PlayStatus, ReceivedSnapshot } from './types'
import { useNow } from './useNow'

const playStatusLabels: Record<PlayStatus, string> = {
  playing: 'Playing',
  finished: 'Finished',
  timed_out: 'Time out',
  resigned: 'Resigned',
}

// The board for a running challenge. The server sends only the position to move
// in; this component validates locally for instant feedback, shows the move
// optimistically, and on a deviation leaves it on the board for the same pause
// the server gives the clock before showing the restored historical position.
export function ChallengePlay({ received, userId }: { received: ReceivedSnapshot; userId: string }) {
  const { snapshot, receivedAt } = received
  const { move, resign } = useChallenges()
  const [pendingFen, setPendingFen] = useState<string | null>(null)
  const [correction, setCorrection] = useState<{ fen: string; expected: string } | null>(null)
  const [lastFen, setLastFen] = useState<string | null>(null)
  // Your own last move, shown while it is pending or being corrected.
  const [myLastMove, setMyLastMove] = useState<LastMove | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const correctionTimer = useRef<number | undefined>(undefined)
  const me = snapshot.me
  const position = me?.position ?? null
  const iAmPlaying = me?.playStatus === 'playing'
  const now = useNow(true)
  const startsInMs = snapshot.startsInMs === null ? 0 : Math.max(0, snapshot.startsInMs - (now - receivedAt))
  const started = startsInMs <= 0
  const myRemaining = me ? liveRemainingMs(me.clock, receivedAt, now) : null
  const canMove = started && iAmPlaying && position !== null && pendingFen === null && correction === null && (myRemaining ?? 0) > 0
  const boardFen = correction?.fen ?? pendingFen ?? position?.fen ?? lastFen ?? new Chess().fen()
  const opponents = snapshot.players.filter((player) => player.userId !== userId)
  const totalMoves = snapshot.totalMoves ?? 0
  const matched = me?.moves.filter((record) => record.correct).length ?? 0

  // Remember the last real position so the board doesn't reset once you finish.
  if (position && position.fen !== lastFen) setLastFen(position.fen)

  useEffect(() => () => window.clearTimeout(correctionTimer.current), [])

  // Countdown ticks, then the start fanfare. Only a lower number ticks: each new
  // snapshot re-estimates the countdown, and network delay can round it back up.
  const countdownSecond = started ? 0 : Math.ceil(startsInMs / 1000)
  const lastCountdownSecond = useRef<number | null>(null)
  useEffect(() => {
    const last = lastCountdownSecond.current
    if (last !== null && countdownSecond >= last) return
    lastCountdownSecond.current = countdownSecond
    if (countdownSecond > 0) play('countdown')
    else if (last !== null) play('challengeStart')
  }, [countdownSecond])

  // The historical opponent's reply, once your move is confirmed and any
  // correction pause is over (a live update can show the new position earlier).
  const lastAnnouncedPly = useRef<number | null>(null)
  const replyPly = started && pendingFen === null && correction === null && position?.previousSan ? position.ply : null
  useEffect(() => {
    if (replyPly === null || lastAnnouncedPly.current === replyPly) return
    lastAnnouncedPly.current = replyPly
    play(moveSound(position!.previousSan!, true), 0.25)
  }, [position, replyPly])

  // Your own finish or flag, and a single low-time warning.
  const myStatus = me?.playStatus ?? null
  const previousStatus = useRef(myStatus)
  useEffect(() => {
    if (previousStatus.current === 'playing' && myStatus === 'finished') play('sessionEnd', 0.5)
    if (previousStatus.current === 'playing' && myStatus === 'timed_out') play('timeout')
    previousStatus.current = myStatus
  }, [myStatus])
  const lowTime = started && iAmPlaying && myRemaining !== null && myRemaining > 0 && myRemaining < 20_000
  const lowTimeWarned = useRef(false)
  useEffect(() => {
    if (!lowTime || lowTimeWarned.current) return
    lowTimeWarned.current = true
    play('lowTime')
  }, [lowTime])

  // Once you finish, the board shows the position before your last move, so nothing is highlighted.
  const lastMove = pendingFen !== null || correction !== null ? myLastMove : lastMoveFromUci(position?.previousUci)
  const clickToMove = useClickToMove(boardFen, canMove, (from, to) => { handleDrop(from, to) }, lastMove)

  function handleDrop(sourceSquare: string, targetSquare: string | null) {
    if (!canMove || !position || !targetSquare) return false
    const board = new Chess(position.fen)
    let attempted
    try {
      attempted = board.move({ from: sourceSquare, to: targetSquare, promotion: 'q' })
    } catch {
      return false
    }
    setPendingFen(board.fen())
    setMyLastMove({ from: attempted.from, to: attempted.to })
    setError('')
    play(moveSound(attempted.san))
    void move(position.ply, attempted.lan)
      .then((result) => {
        if (result.correct) {
          setMessage('Matched the original game.')
          return
        }
        play('deviation')
        setMessage(`Legal move, but the original game played ${result.expectedSan}.`)
        setCorrection({ fen: board.fen(), expected: result.expectedSan })
        correctionTimer.current = window.setTimeout(() => {
          setCorrection(null)
          setMessage('The historical line is restored. Keep going.')
        }, correctionDelayMs)
      })
      .catch((moveError: unknown) => setError(moveError instanceof Error ? moveError.message : 'The move was not accepted.'))
      .finally(() => setPendingFen(null))
    return true
  }

  async function confirmResign() {
    if (!window.confirm('Resign? You will rank below everyone who finishes, and the moves you played so far are still analyzed.')) return
    try {
      await resign()
    } catch (resignError) {
      setError(resignError instanceof Error ? resignError.message : 'Could not resign.')
    }
  }

  const statusTitle = !started ? 'Get ready' : !iAmPlaying ? (me?.playStatus === 'finished' ? 'You finished' : me?.playStatus === 'timed_out' ? 'Time is up' : 'You resigned')
    : correction ? 'Historical correction' : 'Your move'
  const statusText = !started ? `The clocks start in ${Math.ceil(startsInMs / 1000)}...`
    : !iAmPlaying ? 'Waiting for the other players. The game is revealed once everyone is done.'
    : message || (position?.previousSan ? `The game continued ${position.previousSan}. Find the master's reply.` : 'Play the opening move from the original game.')

  return <section className="game-layout challenge-play">
    <div className="board-column">
      <div className="board-labels"><span>{snapshot.side === 'w' ? 'YOU (WHITE)' : 'WHITE'}</span><span className="score">MYSTERY GAME</span><span>{snapshot.side === 'b' ? 'YOU (BLACK)' : 'BLACK'}</span></div>
      <div className="board-wrap challenge-board">
        <Chessboard options={{
          id: 'challenge-board',
          position: boardFen,
          onPieceDrop: ({ sourceSquare, targetSquare }) => handleDrop(sourceSquare, targetSquare),
          boardOrientation: snapshot.side === 'b' ? 'black' : 'white',
          allowDragging: canMove,
          onSquareClick: clickToMove.onSquareClick,
          squareStyles: clickToMove.squareStyles,
          boardStyle: { borderRadius: '2px', boxShadow: '0 18px 50px rgba(18, 28, 35, .18)' },
        }} />
        {!started && <div className="countdown-overlay"><span>{Math.ceil(startsInMs / 1000)}</span></div>}
      </div>
      <div className="board-footer"><span>{position ? `MOVE ${position.moveNumber}` : 'CHALLENGE'}</span><span>{snapshot.game?.plyCount ?? '?'} PLIES</span></div>
    </div>

    <aside className="side-panel">
      <div className="panel-heading"><span>CHALLENGE</span><span className="session-code">{snapshot.players.length} PLAYERS</span></div>
      {me && <ChessClock label="YOUR CLOCK" timeControl={snapshot.timeControl} displayMs={myRemaining ?? 0} running={started && iAmPlaying && correction === null && me.clock.running} />}
      <div className={`status-banner ${correction ? 'correction' : !iAmPlaying && started ? 'complete' : 'playing'} ${me?.playStatus === 'timed_out' ? 'timeout' : ''}`}><span className="status-dot" /><div><strong>{statusTitle}</strong><p>{statusText}</p></div></div>
      {error && <p className="admin-error">{error}</p>}
      <div className="progress-row"><span>YOUR PROGRESS</span><strong>{me?.moves.length ?? 0} / {totalMoves} MOVES</strong></div>
      <div className="progress-track"><span style={{ width: `${totalMoves ? ((me?.moves.length ?? 0) / totalMoves) * 100 : 0}%` }} /></div>
      <div className="score-grid"><div><strong>{matched}</strong><span>MATCHED</span></div><div><strong>{(me?.moves.length ?? 0) - matched}</strong><span>DEVIATIONS</span></div></div>

      <p className="section-label">OPPONENTS</p>
      <div className="opponent-list">{opponents.map((player) => {
        const remaining = liveRemainingMs(player.clock, receivedAt, now)
        return <div className="opponent-row" key={player.playerId}>
          <div><strong>{player.username}</strong><span>{player.playStatus ? playStatusLabels[player.playStatus] : '—'}</span></div>
          <div className="opponent-progress"><span style={{ width: `${totalMoves ? (player.movesPlayed / totalMoves) * 100 : 0}%` }} /></div>
          <b className={player.clock.running && started ? 'running' : ''}>{remaining === null ? '--:--' : formatClock(remaining)}</b>
        </div>
      })}</div>

      <ChallengeChat userId={userId} />

      <div className="move-log"><p className="section-label">YOUR MOVES</p>{!me || me.moves.length === 0 ? <p className="empty-log">Your moves will appear here.</p> : me.moves.map((record) => <div className="move-row" key={record.ply}><span>{Math.floor(record.ply / 2) + 1}{record.ply % 2 === 1 ? '...' : '.'}</span><strong>{record.attempted}</strong><span className={record.correct ? 'match' : 'deviation'}>{record.correct ? 'MATCH' : `→ ${record.expected}`}</span></div>)}</div>
      {iAmPlaying && started && <button className="text-button resign-button" onClick={() => void confirmResign()}>Resign</button>}
      <div className="panel-note"><span>♟</span><p>Only your clock matters: the opponent side's historical moves are instant, and a deviation pauses your clock while the line is restored. Nobody sees anyone else's moves.</p></div>
    </aside>
  </section>
}
