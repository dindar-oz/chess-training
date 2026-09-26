import { formatClock, formatTimeControl } from '../timeControl'
import type { TimeControl } from '../timeControl'

type ChessClockProps = {
  label: string
  timeControl: TimeControl
  displayMs: number
  running: boolean
}

const lowTimeMs = 20_000

export function ChessClock({ label, timeControl, displayMs, running }: ChessClockProps) {
  const state = displayMs <= 0 ? 'flagged' : displayMs < lowTimeMs ? 'low' : ''
  return <div className={`chess-clock ${running ? 'running' : ''} ${state}`} role="timer" aria-live="off">
    <span>{label} · {formatTimeControl(timeControl)}</span>
    <strong>{formatClock(displayMs)}</strong>
  </div>
}
