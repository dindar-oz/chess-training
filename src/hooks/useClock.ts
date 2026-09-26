import { useEffect, useMemo, useRef, useState } from 'react'
import type { TimeControl } from '../timeControl'

const tickMs = 100

// A single Fischer clock. The authoritative time lives in a ref and is measured
// with performance.now(), so display ticks can be late without losing time;
// `displayMs` is only for rendering.
export function useClock(onFlag: () => void) {
  const clockState = useRef({ enabled: false, remainingMs: 0, incrementMs: 0, runningSince: null as number | null })
  const [enabled, setEnabled] = useState(false)
  const [running, setRunning] = useState(false)
  const [displayMs, setDisplayMs] = useState(0)
  const onFlagRef = useRef(onFlag)

  useEffect(() => { onFlagRef.current = onFlag })

  const controls = useMemo(() => {
    const remainingMs = () => {
      const clock = clockState.current
      return clock.runningSince === null ? clock.remainingMs : clock.remainingMs - (performance.now() - clock.runningSince)
    }
    return {
      remainingMs,
      reset(timeControl: TimeControl | null) {
        clockState.current = {
          enabled: timeControl !== null,
          remainingMs: (timeControl?.baseSeconds ?? 0) * 1000,
          incrementMs: (timeControl?.incrementSeconds ?? 0) * 1000,
          runningSince: null,
        }
        setEnabled(timeControl !== null)
        setRunning(false)
        setDisplayMs(clockState.current.remainingMs)
      },
      start() {
        const clock = clockState.current
        if (!clock.enabled || clock.runningSince !== null || clock.remainingMs <= 0) return
        clock.runningSince = performance.now()
        setRunning(true)
      },
      stop() {
        const clock = clockState.current
        if (clock.runningSince === null) return
        clock.remainingMs = Math.max(0, remainingMs())
        clock.runningSince = null
        setRunning(false)
        setDisplayMs(clock.remainingMs)
      },
      addIncrement() {
        const clock = clockState.current
        if (!clock.enabled) return
        clock.remainingMs += clock.incrementMs
        setDisplayMs(remainingMs())
      },
    }
  }, [])

  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => {
      const remaining = controls.remainingMs()
      if (remaining > 0) {
        setDisplayMs(remaining)
        return
      }
      controls.stop()
      onFlagRef.current()
    }, tickMs)
    return () => window.clearInterval(timer)
  }, [controls, running])

  return { ...controls, enabled, running, displayMs }
}
