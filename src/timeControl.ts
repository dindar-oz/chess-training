export type TimeControl = { baseSeconds: number; incrementSeconds: number }

export const maxBaseMinutes = 180
export const maxIncrementSeconds = 60

export const timeControlPresets: TimeControl[] = [[1, 0], [3, 0], [3, 2], [5, 0], [5, 3], [10, 0], [10, 5], [15, 10], [30, 0]]
  .map(([minutes, increment]) => ({ baseSeconds: minutes * 60, incrementSeconds: increment }))

// "10+5" = 10 minutes base, 5 seconds added per move. Stored in training stats in this form.
export function formatTimeControl(timeControl: TimeControl | null) {
  return timeControl ? `${timeControl.baseSeconds / 60}+${timeControl.incrementSeconds}` : 'Untimed'
}

export function sameTimeControl(a: TimeControl | null, b: TimeControl | null) {
  return a?.baseSeconds === b?.baseSeconds && a?.incrementSeconds === b?.incrementSeconds
}

export function isValidTimeControl(value: unknown): value is TimeControl {
  if (typeof value !== 'object' || value === null) return false
  const { baseSeconds, incrementSeconds } = value as Record<string, unknown>
  return Number.isInteger(baseSeconds) && Number.isInteger(incrementSeconds)
    && (baseSeconds as number) >= 60 && (baseSeconds as number) <= maxBaseMinutes * 60 && (baseSeconds as number) % 60 === 0
    && (incrementSeconds as number) >= 0 && (incrementSeconds as number) <= maxIncrementSeconds
}

// m:ss normally, and tenths of a second once under 10 seconds, like tournament clocks.
export function formatClock(ms: number) {
  const clamped = Math.max(0, ms)
  if (clamped < 10_000) return `0:0${(Math.floor(clamped / 100) / 10).toFixed(1)}`
  const totalSeconds = Math.floor(clamped / 1000)
  return `${Math.floor(totalSeconds / 60)}:${(totalSeconds % 60).toString().padStart(2, '0')}`
}
