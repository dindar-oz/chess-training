import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { scoreValue } from '../../shared/accuracy.ts'
import { ClientStockfishEngine } from '../clientStockfish'
import { useRealtime, useRealtimeEvent } from '../realtime/context'
import { readApiResponse } from '../types'
import { ChallengeContext } from './context'
import type { AnalysisRun, ChallengeState } from './context'
import { isParticipant } from './types'
import type { ChallengeSnapshot, ChatMessage, CreateChallengeInput, ReceivedSnapshot } from './types'

type AnalysisInput = { depth: number; positions: Array<{ fen: string; expectedUci: string; attemptedUcis: string[] }> }

const progressReportIntervalMs = 2000
const activeStatuses = ['lobby', 'playing', 'analyzing']

async function request<T>(path: string, body?: unknown) {
  const response = await fetch(path, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const result = await readApiResponse<T>(response)
  if (!response.ok) throw new Error(result.error ?? 'The request failed.')
  return result as T
}

type ChallengeProviderProps = {
  userId: string
  children: ReactNode
  onChallengeStarted: () => void
  // Ratings, XP and stats changed on the server.
  onChallengeCompleted: () => void
}

export function ChallengeProvider({ userId, children, onChallengeStarted, onChallengeCompleted }: ChallengeProviderProps) {
  const [current, setCurrent] = useState<ReceivedSnapshot | null>(null)
  const [invitations, setInvitations] = useState<ChallengeSnapshot[]>([])
  const [analysisRun, setAnalysisRun] = useState<AnalysisRun | null>(null)
  const [analysisAttempt, setAnalysisAttempt] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [mutedChats, setMutedChats] = useState<string[]>([])
  const mutedChatsRef = useRef<string[]>([])
  const currentRef = useRef<ReceivedSnapshot | null>(null)
  const analysisKey = useRef<string | null>(null)
  const callbacks = useRef({ onChallengeStarted, onChallengeCompleted })
  const engine = useMemo(() => new ClientStockfishEngine(), [])
  const { connected } = useRealtime()

  useEffect(() => { callbacks.current = { onChallengeStarted, onChallengeCompleted } })

  const apply = useCallback((snapshot: ChallengeSnapshot) => {
    const received = { snapshot, receivedAt: performance.now() }
    setInvitations((previous) => {
      const others = previous.filter((invitation) => invitation.id !== snapshot.id)
      return snapshot.status === 'lobby' && snapshot.me?.inviteStatus === 'invited' ? [...others, snapshot] : others
    })

    const previous = currentRef.current?.snapshot
    let next: ReceivedSnapshot | null = currentRef.current
    if (previous?.id === snapshot.id && previous.generatedAt > snapshot.generatedAt) return
    if (isParticipant(snapshot)) {
      const replacesOtherActive = previous && previous.id !== snapshot.id && activeStatuses.includes(previous.status)
      if (snapshot.status === 'cancelled') {
        if (previous?.id === snapshot.id) next = null
        if (previous?.id === snapshot.id && snapshot.creatorId !== userId) setNotice(`${snapshot.creatorName} cancelled the challenge.`)
      } else if (!replacesOtherActive || activeStatuses.includes(snapshot.status)) {
        next = received
      }
    } else if (previous?.id === snapshot.id) {
      next = null
    }
    if (next?.snapshot.id === snapshot.id && previous?.id === snapshot.id) {
      if (previous.status === 'lobby' && snapshot.status === 'playing') callbacks.current.onChallengeStarted()
      if (previous.status !== 'complete' && snapshot.status === 'complete') callbacks.current.onChallengeCompleted()
    }
    currentRef.current = next
    setCurrent(next)
  }, [userId])

  const refresh = useCallback(async () => {
    try {
      const { current: snapshot, invitations: pending } = await request<{ current: ChallengeSnapshot | null; invitations: ChallengeSnapshot[] }>('/api/challenges/current')
      setInvitations(pending)
      if (snapshot) apply(snapshot)
      else if (currentRef.current && activeStatuses.includes(currentRef.current.snapshot.status)) {
        currentRef.current = null
        setCurrent(null)
      }
    } catch {
      // Retried on the next reconnect.
    }
  }, [apply])

  // Reload on every (re)connect: events sent while disconnected are lost.
  useEffect(() => {
    if (connected) void refresh()
  }, [connected, refresh])

  // Only the current challenge's messages are kept; a muted chat drops them.
  const addChatMessage = useCallback((message: ChatMessage) => {
    if (message.challengeId !== currentRef.current?.snapshot.id || mutedChatsRef.current.includes(message.challengeId)) return
    setChat((previous) => previous.some((existing) => existing.id === message.id)
      ? previous
      : [...previous.filter((existing) => existing.challengeId === message.challengeId), message])
  }, [])

  useRealtimeEvent('challenge_message', (data) => addChatMessage(data as ChatMessage))

  useRealtimeEvent('challenge_update', (data) => apply(data as ChallengeSnapshot))
  useRealtimeEvent('challenge_analysis_progress', (data) => {
    const { challengeId, done, total } = data as { challengeId: string; done: number; total: number }
    const received = currentRef.current
    if (received?.snapshot.id !== challengeId) return
    const next = { ...received, snapshot: { ...received.snapshot, analysis: { done, total } } }
    currentRef.current = next
    setCurrent(next)
  })

  // The creator's browser analyzes the finished challenge. Keyed by challenge and
  // attempt so progress updates don't restart it; not cancelled on re-render.
  useEffect(() => {
    const snapshot = current?.snapshot
    if (!snapshot || snapshot.status !== 'analyzing' || snapshot.creatorId !== userId) return
    const key = `${snapshot.id}:${analysisAttempt}`
    if (analysisKey.current === key) return
    analysisKey.current = key
    const challengeId = snapshot.id

    async function run() {
      try {
        const input = await request<AnalysisInput>(`/api/challenges/${challengeId}/analysis-input`)
        const total = input.positions.reduce((sum, position) => sum + 2 + position.attemptedUcis.length, 0)
        let done = 0
        let lastReport = 0
        setAnalysisRun({ challengeId, done, total, error: null })
        const results: Array<{ fen: string; uci: string; cpl: number }> = []
        for (const position of input.positions) {
          const best = scoreValue(await engine.analyze(position.fen, input.depth))
          done += 1
          for (const uci of [position.expectedUci, ...position.attemptedUcis]) {
            const value = scoreValue(await engine.analyze(position.fen, input.depth, uci))
            results.push({ fen: position.fen, uci, cpl: Math.max(0, best - value) })
            done += 1
          }
          setAnalysisRun({ challengeId, done, total, error: null })
          if (Date.now() - lastReport > progressReportIntervalMs) {
            lastReport = Date.now()
            void request(`/api/challenges/${challengeId}/analysis-progress`, { done, total }).catch(() => undefined)
          }
        }
        apply(await request<ChallengeSnapshot>(`/api/challenges/${challengeId}/analysis`, { results }))
        setAnalysisRun(null)
      } catch (error) {
        setAnalysisRun((previous) => ({ challengeId, done: previous?.done ?? 0, total: previous?.total ?? 0, error: error instanceof Error ? error.message : 'The analysis failed.' }))
      }
    }
    void run()
  }, [analysisAttempt, apply, current, engine, userId])

  const value = useMemo<ChallengeState>(() => {
    const challengeId = () => {
      const id = currentRef.current?.snapshot.id
      if (!id) throw new Error('You are not in a challenge.')
      return id
    }
    return {
      current,
      invitations,
      analysisRun,
      notice,
      chat: current ? chat.filter((message) => message.challengeId === current.snapshot.id) : [],
      chatMutedForMe: current ? mutedChats.includes(current.snapshot.id) : false,
      sendMessage: async (text: string) => addChatMessage(await request<ChatMessage>(`/api/challenges/${challengeId()}/messages`, { text })),
      setChatMutedForMe: (muted: boolean) => {
        const id = currentRef.current?.snapshot.id
        if (!id) return
        const next = muted ? [...mutedChatsRef.current.filter((existing) => existing !== id), id] : mutedChatsRef.current.filter((existing) => existing !== id)
        mutedChatsRef.current = next
        setMutedChats(next)
        if (muted) setChat((previous) => previous.filter((message) => message.challengeId !== id))
      },
      setChatMutedForEveryone: async (muted: boolean) => apply(await request<ChallengeSnapshot>(`/api/challenges/${challengeId()}/chat-mute`, { muted })),
      dismissNotice: () => setNotice(null),
      create: async (input: CreateChallengeInput) => apply(await request<ChallengeSnapshot>('/api/challenges', input)),
      respond: async (id: string, accept: boolean) => apply(await request<ChallengeSnapshot>(`/api/challenges/${id}/respond`, { accept })),
      start: async () => apply(await request<ChallengeSnapshot>(`/api/challenges/${challengeId()}/start`, {})),
      cancel: async () => apply(await request<ChallengeSnapshot>(`/api/challenges/${challengeId()}/cancel`, {})),
      leave: async () => apply(await request<ChallengeSnapshot>(`/api/challenges/${challengeId()}/leave`, {})),
      resign: async () => apply(await request<ChallengeSnapshot>(`/api/challenges/${challengeId()}/resign`, {})),
      move: async (ply: number, uci: string) => {
        const result = await request<{ correct: boolean; expectedSan: string; challenge: ChallengeSnapshot }>(`/api/challenges/${challengeId()}/moves`, { ply, uci })
        apply(result.challenge)
        return result
      },
      retryAnalysis: () => setAnalysisAttempt((attempt) => attempt + 1),
      dismiss: () => {
        if (currentRef.current && activeStatuses.includes(currentRef.current.snapshot.status)) return
        currentRef.current = null
        setCurrent(null)
      },
    }
  }, [addChatMessage, analysisRun, apply, chat, current, invitations, mutedChats, notice])

  return <ChallengeContext.Provider value={value}>{children}</ChallengeContext.Provider>
}
