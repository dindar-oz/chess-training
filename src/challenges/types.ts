import type { TimeControl } from '../timeControl'
import type { Side } from '../types'

export type ChallengeStatus = 'lobby' | 'playing' | 'analyzing' | 'complete' | 'cancelled' | 'void'
export type InviteStatus = 'creator' | 'invited' | 'accepted' | 'declined' | 'left' | 'expired'
export type PlayStatus = 'playing' | 'finished' | 'timed_out' | 'resigned'

// Clock state as of when the snapshot left the server; see liveRemainingMs.
export type ClockView = { remainingMs: number | null; running: boolean; resumesInMs: number }

export type ChallengePlayer = {
  playerId: string
  userId: string | null
  username: string
  elo: number | null
  online: boolean
  inviteStatus: InviteStatus
  playStatus: PlayStatus | null
  movesPlayed: number
  // The player's own analysis has arrived (always true with no moves).
  analysisReady: boolean
  clock: ClockView
  result: {
    accuracy: number | null
    originalAccuracy: number | null
    averageCpl: number | null
    correctMoves: number | null
    deviations: number | null
    rank: number | null
    eloBefore: number | null
    eloAfter: number | null
  } | null
}

export type ChallengeSnapshot = {
  id: string
  generatedAt: number
  status: ChallengeStatus
  creatorId: string | null
  creatorName: string
  sideChoice: Side | 'random'
  side: Side | null
  timeControl: TimeControl
  depth: number
  createdAt: string
  // The host muted the chat for everyone.
  chatMuted: boolean
  startsInMs: number | null
  totalMoves: number | null
  // Only the ply count until the challenge completes; the full game afterwards.
  game: { plyCount: number | null; id?: string; title?: string; white?: string; black?: string; event?: string; date?: string; result?: string } | null
  // While analyzing: how long results still wait for missing analyses.
  analysisGraceInMs: number | null
  players: ChallengePlayer[]
  me: {
    playerId: string
    inviteStatus: InviteStatus
    playStatus: PlayStatus | null
    clock: ClockView
    // previousUci: the move that led here, for the last-move highlight.
    position: { ply: number; fen: string; moveNumber: number; previousSan: string | null; previousUci: string | null } | null
    moves: Array<{ ply: number; fen: string; attempted: string; expected: string; attemptedUci: string; expectedUci: string; correct: boolean }>
    analysisSubmitted: boolean
  } | null
}

// A snapshot plus the local time it arrived, so clocks can tick between updates.
export type ReceivedSnapshot = { snapshot: ChallengeSnapshot; receivedAt: number }

export type ChallengeHistoryEntry = {
  id: string
  status: 'complete' | 'void'
  gameTitle: string | null
  completedAt: string | null
  createdAt: string
  baseSeconds: number
  incrementSeconds: number
  rank: number | null
  eloBefore: number | null
  eloAfter: number | null
  accuracy: number | null
  players: number
}

export type ChatMessage = {
  id: string
  challengeId: string
  userId: string | null
  username: string
  text: string
  createdAt: string
}

export type CreateChallengeInput = {
  side: Side | 'random'
  timeControl: TimeControl
  depth: number
  inviteeIds: string[]
}

export function liveRemainingMs(clock: ClockView, receivedAt: number, now: number) {
  if (clock.remainingMs === null) return null
  if (!clock.running) return clock.remainingMs
  const elapsed = Math.max(0, now - receivedAt - clock.resumesInMs)
  return Math.max(0, clock.remainingMs - elapsed)
}

export function sideLabel(side: Side | 'random') {
  return side === 'w' ? 'White' : side === 'b' ? 'Black' : 'Random side'
}

export function isParticipant(snapshot: ChallengeSnapshot) {
  return snapshot.me?.inviteStatus === 'creator' || snapshot.me?.inviteStatus === 'accepted'
}
