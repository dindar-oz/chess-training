import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { RealtimeContext } from './context'
import type { OnlineUser, RealtimeHandler } from './context'

const maxRetryDelayMs = 30_000

type RealtimeProviderProps = {
  children: ReactNode
  // Called when the stream is refused because the session is no longer valid.
  onSessionEnded: () => void
}

// Holds one EventSource to /api/events for the logged-in user. The browser retries
// dropped connections by itself; when it gives up (an HTTP error such as a 401 or
// a 503 during a deploy) we check the session and reconnect with backoff.
export function RealtimeProvider({ children, onSessionEnded }: RealtimeProviderProps) {
  const [connected, setConnected] = useState(false)
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([])
  const handlers = useRef(new Map<string, Set<RealtimeHandler>>())
  const onSessionEndedRef = useRef(onSessionEnded)

  useEffect(() => { onSessionEndedRef.current = onSessionEnded })

  useEffect(() => {
    let source: EventSource | null = null
    let retryTimer: number | undefined
    let attempt = 0
    let stopped = false

    const scheduleReconnect = () => {
      attempt += 1
      retryTimer = window.setTimeout(connect, Math.min(maxRetryDelayMs, 1000 * 2 ** attempt))
    }

    function connect() {
      if (stopped) return
      source = new EventSource('/api/events')
      source.onopen = () => {
        attempt = 0
        setConnected(true)
      }
      source.onmessage = (event: MessageEvent<string>) => {
        let message: { type: string; data: unknown }
        try {
          message = JSON.parse(event.data) as { type: string; data: unknown }
        } catch {
          return
        }
        if (message.type === 'presence') setOnlineUsers((message.data as { users: OnlineUser[] }).users)
        handlers.current.get(message.type)?.forEach((handler) => handler(message.data))
      }
      source.onerror = () => {
        setConnected(false)
        if (source?.readyState !== EventSource.CLOSED) return
        source.close()
        void fetch('/api/auth/me')
          .then((response) => response.json() as Promise<{ user: unknown }>)
          .then(({ user }) => {
            if (stopped) return
            if (user) scheduleReconnect()
            else onSessionEndedRef.current()
          })
          .catch(() => { if (!stopped) scheduleReconnect() })
      }
    }

    connect()
    return () => {
      stopped = true
      window.clearTimeout(retryTimer)
      source?.close()
    }
  }, [])

  const subscribe = useCallback((type: string, handler: RealtimeHandler) => {
    const typeHandlers = handlers.current.get(type) ?? new Set<RealtimeHandler>()
    typeHandlers.add(handler)
    handlers.current.set(type, typeHandlers)
    return () => { typeHandlers.delete(handler) }
  }, [])

  const value = useMemo(() => ({ connected, onlineUsers, subscribe }), [connected, onlineUsers, subscribe])
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>
}
