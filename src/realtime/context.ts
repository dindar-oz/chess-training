import { createContext, useContext, useEffect, useRef } from 'react'

export type OnlineUser = { id: string; username: string; elo: number }
export type RealtimeHandler = (data: unknown) => void

export type RealtimeState = {
  connected: boolean
  onlineUsers: OnlineUser[]
  subscribe: (type: string, handler: RealtimeHandler) => () => void
}

export const RealtimeContext = createContext<RealtimeState>({
  connected: false,
  onlineUsers: [],
  subscribe: () => () => undefined,
})

export function useRealtime() {
  return useContext(RealtimeContext)
}

// Calls `handler` for every server event of `type`. The latest handler is always
// used, so callers don't need to memoize it.
export function useRealtimeEvent(type: string, handler: RealtimeHandler) {
  const { subscribe } = useRealtime()
  const handlerRef = useRef(handler)
  useEffect(() => { handlerRef.current = handler })
  useEffect(() => subscribe(type, (data) => handlerRef.current(data)), [subscribe, type])
}
