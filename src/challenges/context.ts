import { createContext, useContext } from 'react'
import type { ChallengeSnapshot, CreateChallengeInput, ReceivedSnapshot } from './types'

export type AnalysisRun = { challengeId: string; done: number; total: number; error: string | null }

export type ChallengeState = {
  current: ReceivedSnapshot | null
  invitations: ChallengeSnapshot[]
  // Set only in the creator's browser while it analyzes a finished challenge.
  analysisRun: AnalysisRun | null
  notice: string | null
  dismissNotice: () => void
  create: (input: CreateChallengeInput) => Promise<void>
  respond: (challengeId: string, accept: boolean) => Promise<void>
  start: () => Promise<void>
  cancel: () => Promise<void>
  leave: () => Promise<void>
  resign: () => Promise<void>
  move: (ply: number, uci: string) => Promise<{ correct: boolean; expectedSan: string }>
  retryAnalysis: () => void
  // Clears a finished challenge so the Challenges tab offers a new one.
  dismiss: () => void
}

export const ChallengeContext = createContext<ChallengeState | null>(null)

export function useChallenges() {
  const state = useContext(ChallengeContext)
  if (!state) throw new Error('useChallenges must be used inside ChallengeProvider.')
  return state
}
