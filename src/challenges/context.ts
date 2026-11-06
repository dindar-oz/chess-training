import { createContext, useContext } from 'react'
import type { ChallengeSnapshot, ChatMessage, CreateChallengeInput, ReceivedSnapshot } from './types'

export type ChallengeState = {
  current: ReceivedSnapshot | null
  invitations: ChallengeSnapshot[]
  notice: string | null
  // Chat of the current challenge, oldest first. Kept only in memory: messages
  // are relayed live and never stored, so a reload starts with an empty chat.
  chat: ChatMessage[]
  // This player hid the chat for themselves (the current challenge only).
  chatMutedForMe: boolean
  sendMessage: (text: string) => Promise<void>
  setChatMutedForMe: (muted: boolean) => void
  // Host only: stops everyone from sending until unmuted.
  setChatMutedForEveryone: (muted: boolean) => Promise<void>
  dismissNotice: () => void
  create: (input: CreateChallengeInput) => Promise<void>
  respond: (challengeId: string, accept: boolean) => Promise<void>
  // Takes a seat in an open challenge.
  join: (challengeId: string) => Promise<void>
  // Host only: removes a player before the start.
  kick: (playerId: string) => Promise<void>
  start: () => Promise<void>
  cancel: () => Promise<void>
  leave: () => Promise<void>
  resign: () => Promise<void>
  move: (ply: number, uci: string) => Promise<{ correct: boolean; expectedSan: string }>
  // Clears a finished challenge so the Challenges tab offers a new one.
  dismiss: () => void
}

export const ChallengeContext = createContext<ChallengeState | null>(null)

export function useChallenges() {
  const state = useContext(ChallengeContext)
  if (!state) throw new Error('useChallenges must be used inside ChallengeProvider.')
  return state
}
