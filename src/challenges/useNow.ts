import { useEffect, useState } from 'react'

// performance.now(), refreshed every `intervalMs` while `active`, for ticking clocks.
export function useNow(active: boolean, intervalMs = 100) {
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setNow(performance.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [active, intervalMs])
  return now
}
