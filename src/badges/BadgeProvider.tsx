import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { isBadgeId } from '../../shared/badges.ts'
import type { BadgeId } from '../../shared/badges.ts'
import { useRealtimeEvent } from '../realtime/context'
import { BadgeCelebration } from './BadgeCelebration'
import { BadgeContext } from './context'
import type { EarnedBadge } from './context'

// Lets the screen that caused the badge (a results page, a move) settle first.
const celebrationDelayMs = 900

type BadgeProviderProps = {
  children: ReactNode
  onOpenAwards: () => void
}

// Knows which badges the player holds and celebrates each new one exactly once:
// live when the server announces it, or on the next visit if it was earned while
// no page was open (the server remembers which celebrations were seen).
export function BadgeProvider({ children, onOpenAwards }: BadgeProviderProps) {
  const [earned, setEarned] = useState<EarnedBadge[]>([])
  const [loaded, setLoaded] = useState(false)
  const [queue, setQueue] = useState<BadgeId[]>([])
  const [showing, setShowing] = useState<BadgeId | null>(null)
  // Celebrated (or queued) on this page, so a reload of the list can't repeat one.
  const celebrated = useRef(new Set<BadgeId>())

  const enqueue = useCallback((badges: EarnedBadge[]) => {
    const fresh = badges.filter((badge) => !badge.seen && !celebrated.current.has(badge.id)).map((badge) => badge.id)
    fresh.forEach((id) => celebrated.current.add(id))
    if (fresh.length) setQueue((previous) => [...previous, ...fresh])
  }, [])

  const load = useCallback(() => {
    void fetch('/api/badges')
      .then((response) => response.ok ? response.json() as Promise<EarnedBadge[]> : null)
      .then((badges) => {
        if (!badges) return
        const known = badges.filter((badge) => isBadgeId(badge.id))
        setEarned(known)
        setLoaded(true)
        enqueue(known)
      })
      .catch(() => undefined)
  }, [enqueue])

  useEffect(() => { load() }, [load])
  // Every (re)connection starts with "hello": catch up on anything missed while offline.
  useRealtimeEvent('hello', load)
  useRealtimeEvent('badge_earned', (data) => {
    const badge = data as EarnedBadge
    if (!isBadgeId(badge.id)) return
    setEarned((previous) => previous.some((item) => item.id === badge.id) ? previous : [...previous, badge])
    enqueue([badge])
  })

  const next = queue[0] ?? null
  useEffect(() => {
    if (next === null || showing !== null) return
    const timer = window.setTimeout(() => {
      setShowing(next)
      setQueue((previous) => previous.slice(1))
      void fetch('/api/badges/seen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [next] }) }).catch(() => undefined)
    }, celebrationDelayMs)
    return () => window.clearTimeout(timer)
  }, [next, showing])

  const dismiss = useCallback(() => setShowing(null), [])
  const value = useMemo(() => ({ earned, loaded }), [earned, loaded])
  return <BadgeContext.Provider value={value}>
    {children}
    {showing && <BadgeCelebration
      key={showing}
      badgeId={showing}
      remaining={queue.length}
      onDismiss={dismiss}
      onOpenAwards={() => { setShowing(null); onOpenAwards() }}
    />}
  </BadgeContext.Provider>
}
