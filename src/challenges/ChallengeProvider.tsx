import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { scoreValue } from '../../shared/accuracy.ts'
import { analysisGraceMs, helperDelayMs } from '../../shared/challengeRules.ts'
import { ClientStockfishEngine } from '../clientStockfish'
import { play } from '../sounds'
import { useRealtime, useRealtimeEvent } from '../realtime/context'
import { readApiResponse } from '../types'
import { ChallengeContext } from './context'
import type { AnalysisRun, ChallengeState } from './context'
import { isParticipant } from './types'
import { useNow } from './useNow'
import type { ChallengeSnapshot, ChatMessage, CreateChallengeInput, ReceivedSnapshot } from './types'

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
  const [helperRuns, setHelperRuns] = useState<Record<string, { done: number; total: number }>>({})
  const helperAttempts = useRef(new Map<string, number>())
  const helpersInFlight = useRef(new Set<string>())
  const helperRunsRef = useRef<Record<string, { done: number; total: number }>>({})
  const [notice, setNotice] = useState<string | null>(null)
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [mutedChats, setMutedChats] = useState<string[]>([])
  const mutedChatsRef = useRef<string[]>([])
  const currentRef = useRef<ReceivedSnapshot | null>(null)
  // Invitations already announced with a sound.
  const invitationIds = useRef(new Set<string>())
  const analysisKey = useRef<string | null>(null)
  const callbacks = useRef({ onChallengeStarted, onChallengeCompleted })
  const engine = useMemo(() => new ClientStockfishEngine(), [])
  const { connected, onlineUsers } = useRealtime()

  useEffect(() => { callbacks.current = { onChallengeStarted, onChallengeCompleted } })

  const apply = useCallback((snapshot: ChallengeSnapshot) => {
    const received = { snapshot, receivedAt: performance.now() }
    const isNewInvitation = snapshot.status === 'lobby' && snapshot.me?.inviteStatus === 'invited' && !invitationIds.current.has(snapshot.id)
    if (snapshot.status === 'lobby' && snapshot.me?.inviteStatus === 'invited') invitationIds.current.add(snapshot.id)
    if (isNewInvitation) play('invitation')
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
      if (previous.status !== 'complete' && snapshot.status === 'complete') {
        play('challengeEnd')
        callbacks.current.onChallengeCompleted()
      }
      // The host hears each player who accepts.
      const accepted = (players: ChallengeSnapshot['players']) => players.filter((player) => player.inviteStatus === 'accepted').length
      if (snapshot.status === 'lobby' && snapshot.creatorId === userId && accepted(snapshot.players) > accepted(previous.players)) play('playerJoined')
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
    if (message.userId !== userId) play('chat')
    setChat((previous) => previous.some((existing) => existing.id === message.id)
      ? previous
      : [...previous.filter((existing) => existing.challengeId === message.challengeId), message])
  }, [userId])

  useRealtimeEvent('challenge_message', (data) => addChatMessage(data as ChatMessage))

  useRealtimeEvent('challenge_update', (data) => apply(data as ChallengeSnapshot))

  // Every player's browser analyzes their own moves in the background while they
  // play: the position's best move while they think, then the master's move and
  // theirs right after they move. Results are cached in the engine.
  const snapshot = current?.snapshot
  const myMoves = snapshot?.me?.moves
  const myPositionFen = snapshot?.status === 'playing' ? snapshot.me?.position?.fen ?? null : null
  const challengeIdForAnalysis = snapshot?.id ?? null
  const depth = snapshot?.depth ?? 0
  useEffect(() => {
    if (!challengeIdForAnalysis) return
    const isStale = () => currentRef.current?.snapshot.id !== challengeIdForAnalysis
    if (myPositionFen) void engine.prefetch(myPositionFen, depth, null, null, isStale)
    for (const move of myMoves ?? []) void engine.prefetch(move.fen, depth, move.expectedUci, move.attemptedUci, isStale)
  }, [challengeIdForAnalysis, depth, engine, myMoves, myPositionFen])

  // Once you've finished (or timed out or resigned), your browser completes the
  // analysis of your moves and submits it automatically; a reload resumes it.
  const mustSubmit = Boolean(snapshot && snapshot.me && (snapshot.status === 'playing' || snapshot.status === 'analyzing')
    && snapshot.me.playStatus && snapshot.me.playStatus !== 'playing' && snapshot.me.moves.length > 0 && !snapshot.me.analysisSubmitted)
  useEffect(() => {
    if (!mustSubmit || !challengeIdForAnalysis) return
    const key = `${challengeIdForAnalysis}:${analysisAttempt}`
    if (analysisKey.current === key) return
    analysisKey.current = key
    const challengeId = challengeIdForAnalysis
    const moves = currentRef.current?.snapshot.me?.moves ?? []

    async function run() {
      try {
        let done = 0
        setAnalysisRun({ challengeId, done, total: moves.length, error: null })
        const results: Array<{ ply: number; cpl: number; originalCpl: number }> = []
        for (const move of moves) {
          const best = scoreValue(await engine.analyze(move.fen, depth))
          const original = scoreValue(await engine.analyze(move.fen, depth, move.expectedUci))
          const attempted = scoreValue(await engine.analyze(move.fen, depth, move.attemptedUci))
          results.push({ ply: move.ply, cpl: Math.max(0, best - attempted), originalCpl: Math.max(0, best - original) })
          done += 1
          setAnalysisRun({ challengeId, done, total: moves.length, error: null })
        }
        apply(await request<ChallengeSnapshot>(`/api/challenges/${challengeId}/analysis`, { results }))
        setAnalysisRun(null)
      } catch (error) {
        setAnalysisRun((previous) => ({ challengeId, done: previous?.done ?? 0, total: previous?.total ?? moves.length, error: error instanceof Error ? error.message : 'The analysis failed.' }))
      }
    }
    void run()
  }, [analysisAttempt, apply, challengeIdForAnalysis, depth, engine, mustSubmit])

  // Analyze for other players who finished on time but whose analysis is missing
  // (offline, or silent for a minute). Several browsers may help; the server
  // keeps the first complete analysis.
  const analyzingNow = useNow(snapshot?.status === 'analyzing', 5000)
  const waitedMs = snapshot?.status === 'analyzing' && snapshot.analysisGraceInMs !== null && current
    ? analysisGraceMs - snapshot.analysisGraceInMs + Math.max(0, analyzingNow - current.receivedAt)
    : 0
  const onlineIds = useMemo(() => new Set(onlineUsers.map((onlineUser) => onlineUser.id)), [onlineUsers])
  const helpTargets = snapshot?.status === 'analyzing' && snapshot.me && isParticipant(snapshot)
    ? snapshot.players.filter((player) => player.userId !== userId && !player.analysisReady && player.playStatus === 'finished'
      && (player.userId === null || !onlineIds.has(player.userId) || waitedMs > helperDelayMs)).map((player) => player.playerId)
    : []
  const helpTargetKey = helpTargets.join(',')
  useEffect(() => {
    if (!challengeIdForAnalysis || !helpTargetKey) return
    const challengeId = challengeIdForAnalysis
    for (const playerId of helpTargetKey.split(',')) {
      const key = `${challengeId}:${playerId}`
      const attempts = helperAttempts.current.get(key) ?? 0
      if (attempts >= 3 || helpersInFlight.current.has(key)) continue
      helperAttempts.current.set(key, attempts + 1)
      helpersInFlight.current.add(key)
      void (async () => {
        try {
          const input = await request<{ depth: number; analysisReady: boolean; moves: Array<{ ply: number; fen: string; expectedUci: string; attemptedUci: string }> }>(`/api/challenges/${challengeId}/players/${playerId}/moves`)
          if (input.analysisReady) return
          const update = (done: number) => {
            helperRunsRef.current = { ...helperRunsRef.current, [playerId]: { done, total: input.moves.length } }
            setHelperRuns(helperRunsRef.current)
          }
          update(0)
          const results: Array<{ ply: number; cpl: number; originalCpl: number }> = []
          for (const move of input.moves) {
            const best = scoreValue(await engine.analyze(move.fen, input.depth))
            const original = scoreValue(await engine.analyze(move.fen, input.depth, move.expectedUci))
            const attempted = scoreValue(await engine.analyze(move.fen, input.depth, move.attemptedUci))
            results.push({ ply: move.ply, cpl: Math.max(0, best - attempted), originalCpl: Math.max(0, best - original) })
            update(results.length)
          }
          apply(await request<ChallengeSnapshot>(`/api/challenges/${challengeId}/players/${playerId}/analysis`, { results }))
        } catch {
          // Retried on the next check (up to three attempts) unless the challenge moved on.
        } finally {
          helpersInFlight.current.delete(key)
          const { [playerId]: _finished, ...rest } = helperRunsRef.current
          helperRunsRef.current = rest
          setHelperRuns(rest)
        }
      })()
    }
  }, [apply, challengeIdForAnalysis, engine, helpTargetKey])

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
      helperRuns,
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
  }, [addChatMessage, analysisRun, apply, chat, current, helperRuns, invitations, mutedChats, notice])

  return <ChallengeContext.Provider value={value}>{children}</ChallengeContext.Provider>
}
