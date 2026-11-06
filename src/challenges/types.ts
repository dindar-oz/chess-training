import type { GameFilter } from '../../shared/gameFilter.ts'
import type { ReviewMove } from '../review/steps'
import type { TimeControl } from '../timeControl'
import type { Side } from '../types'

export type ChallengeStatus = 'lobby' | 'playing' | 'analyzing' | 'complete' | 'cancelled' | 'void'
export type InviteStatus = 'creator' | 'invited' | 'accepted' | 'declined' | 'left' | 'expired' | 'kicked'
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
  // The server has scored all of the player's moves (always true with no moves).
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
  // The server engine's search depth for every move.
  depth: number
  // The server engine that scores the moves (such as "Stockfish 19"), known
  // from the start; null for challenges scored in the players' browsers.
  analysisEngine: string | null
  createdAt: string
  // The host muted the chat for everyone.
  chatMuted: boolean
  // Seats (host included) of an open challenge; null when players were invited.
  maxPlayers: number | null
  // Which library games the challenge may pick.
  gameFilter: GameFilter
  startsInMs: number | null
  totalMoves: number | null
  // Only the ply count until the challenge completes; the full game afterwards.
  game: { plyCount: number | null; id?: string; title?: string; white?: string; black?: string; event?: string; date?: string; result?: string } | null
  // While playing or analyzing: how many of all the players' moves are scored.
  analysisProgress: { scored: number; total: number } | null
  players: ChallengePlayer[]
  me: {
    playerId: string
    inviteStatus: InviteStatus
    playStatus: PlayStatus | null
    clock: ClockView
    // previousUci: the move that led here, for the last-move highlight.
    position: { ply: number; fen: string; moveNumber: number; previousSan: string | null; previousUci: string | null } | null
    // mark: ?, ?? or ! once the move has been scored (see moveMark); scores
    // stay hidden while you're still playing.
    moves: ReviewMove[]
    // You finished and left before the results; you're notified when they're ready.
    steppedAway: boolean
  } | null
}

// A snapshot plus the local time it arrived, so clocks can tick between updates.
export type ReceivedSnapshot = { snapshot: ChallengeSnapshot; receivedAt: number }

export type ChallengeHistoryEntry = {
  id: string
  // pending: you finished and left; the results aren't in yet (the game stays secret).
  status: 'complete' | 'void' | 'pending'
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
  // Your moves in it; a challenge you played no moves in has nothing to analyze.
  movesPlayed: number
}

// The notice that a challenge's results are ready (or that it was voided),
// sent when it ends and again at each visit until you've seen the results.
export type ChallengeResultNotice = {
  challengeId: string
  status: 'complete' | 'void'
  // Revealed with the results; null for a voided challenge.
  gameTitle: string | null
  players: number
  rank: number | null
  accuracy: number | null
  eloBefore: number | null
  eloAfter: number | null
}

export type ChatMessage = {
  id: string
  challengeId: string
  userId: string | null
  username: string
  text: string
  createdAt: string
}

// An open challenge waiting for players, as listed in the lobby.
export type OpenChallenge = {
  id: string
  creatorId: string | null
  creatorName: string
  creatorElo: number | null
  sideChoice: Side | 'random'
  timeControl: TimeControl
  depth: number
  maxPlayers: number
  gameFilter: GameFilter
  // Seated players, host included.
  players: number
  createdAt: string
}

export type CreateChallengeInput = {
  side: Side | 'random'
  timeControl: TimeControl
  gameFilter: GameFilter
} & ({ kind: 'invite'; inviteeIds: string[] } | { kind: 'open'; maxPlayers: number })

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

// Joining or accepting another challenge takes a player out of the waiting room
// they are in (a host's challenge is cancelled), so they are asked first.
export function confirmLeavingWaitingRoom(current: ChallengeSnapshot | undefined, userId: string) {
  if (!current || current.status !== 'lobby' || !isParticipant(current)) return true
  return window.confirm(current.creatorId === userId
    ? 'This cancels your own challenge. Continue?'
    : `This takes you out of ${current.creatorName}'s challenge. Continue?`)
}
