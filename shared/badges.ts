// Badges shared by the server (which awards them) and the client (which shows them).
import { accuracyFromCpl, winningChances } from './accuracy.ts'

export type BadgeId =
  | 'first-game' | 'first-challenge' | 'challenge-streak-3' | 'challenge-streak-5' | 'challenge-streak-10'
  | 'beat-master' | 'beat-master-3' | 'outplay-master' | 'no-blunders' | 'no-mistakes' | 'no-inaccuracies' | 'only-moves-3'

export type BadgeDefinition = {
  id: BadgeId
  name: string
  // Shown once the badge is earned.
  description: string
  // Shown while it is still locked.
  hint: string
  // Paid once, when the badge is earned. Also printed on the badge image
  // (src/assets/badge-<id>.svg); a test keeps the two in sync.
  xp: number
}

// Matching the master's move this many times in a row within one challenge.
export const streakBadges: Array<{ length: number; id: BadgeId }> = [
  { length: 3, id: 'challenge-streak-3' },
  { length: 5, id: 'challenge-streak-5' },
  { length: 10, id: 'challenge-streak-10' },
]

// The engine badges only count challenges reviewed at least this deep.
export const minBadgeDepth = 21
// Drops in winning chances (on the -1..1 scale above) that make a move an
// inaccuracy (?!), a mistake (?) or a blunder (??), as on lichess.
export const inaccuracyDrop = 0.1
export const mistakeDrop = 0.2
export const blunderDrop = 0.3
// An only move (!): the engine's best move, where the second-best move loses
// at least this much winning chance.
export const onlyMoveGap = 0.2
// A deviation beats the master's move when it keeps at least this much more
// winning chance, so engine noise between two equal moves doesn't count.
export const improvementMargin = 0.05
// Accuracy points by which a player must beat the master's accuracy.
export const accuracyMargin = 1

export const badgeDefinitions: BadgeDefinition[] = [
  {
    id: 'first-game',
    name: '1st Game Completed',
    description: 'Earned for finishing your first game, in training or in a challenge.',
    hint: 'Finish a training session or a challenge to unlock this badge.',
    xp: 10,
  },
  {
    id: 'first-challenge',
    name: 'First Challenge',
    description: 'Earned for playing your first challenge through to the results.',
    hint: 'Play a challenge through to the results without resigning.',
    xp: 20,
  },
  {
    id: 'challenge-streak-3',
    name: 'Hat Trick',
    description: 'Matched 3 master moves in a row during a challenge.',
    hint: 'Match 3 master moves in a row during a challenge.',
    xp: 15,
  },
  {
    id: 'challenge-streak-5',
    name: 'On Fire',
    description: 'Matched 5 master moves in a row during a challenge.',
    hint: 'Match 5 master moves in a row during a challenge.',
    xp: 30,
  },
  {
    id: 'challenge-streak-10',
    name: 'Master Mind',
    description: 'Matched 10 master moves in a row during a challenge.',
    hint: 'Match 10 master moves in a row during a challenge.',
    xp: 75,
  },
  {
    id: 'beat-master',
    name: 'Improver',
    description: 'Played a move the engine rated better than the master\'s, in a challenge reviewed at depth 21 or more.',
    hint: 'In a challenge with review depth 21 or more, play a move the engine rates better than the master\'s.',
    xp: 40,
  },
  {
    id: 'beat-master-3',
    name: 'History Rewriter',
    description: 'Beat the master\'s move 3 times in one challenge reviewed at depth 21 or more.',
    hint: 'In one challenge with review depth 21 or more, play 3 moves the engine rates better than the master\'s.',
    xp: 120,
  },
  {
    id: 'outplay-master',
    name: 'Outplayed the Master',
    description: 'Finished a challenge with a higher accuracy than the master, reviewed at depth 21 or more.',
    hint: 'Finish a challenge with review depth 21 or more with an accuracy at least 1 point above the master\'s.',
    xp: 100,
  },
  {
    id: 'no-blunders',
    name: 'Steady Hand',
    description: 'Finished a challenge without a single blunder (??), reviewed at depth 21 or more.',
    hint: 'Finish a challenge with review depth 21 or more without a blunder (??).',
    xp: 50,
  },
  {
    id: 'no-mistakes',
    name: 'Flawless',
    description: 'Finished a challenge without a single mistake (?), reviewed at depth 21 or more.',
    hint: 'Finish a challenge with review depth 21 or more without a mistake (?) or a blunder (??).',
    xp: 150,
  },
  {
    id: 'no-inaccuracies',
    name: 'Immaculate',
    description: 'Finished a challenge without a single inaccuracy (?!), mistake or blunder, reviewed at depth 21 or more.',
    hint: 'Finish a challenge with review depth 21 or more without an inaccuracy (?!), a mistake (?) or a blunder (??).',
    xp: 300,
  },
  {
    id: 'only-moves-3',
    name: 'Sharp Eye',
    description: 'Found 3 only moves (!) in one challenge reviewed at depth 21 or more.',
    hint: 'In one challenge with review depth 21 or more, find 3 only moves (!): the one move that keeps your position.',
    xp: 100,
  },
]

export function isBadgeId(value: unknown): value is BadgeId {
  return badgeDefinitions.some((badge) => badge.id === value)
}

export function badgeXp(id: BadgeId) {
  return badgeDefinitions.find((badge) => badge.id === id)?.xp ?? 0
}

// Correct moves at the end of the list, i.e. the streak still running.
export function currentStreak(correct: boolean[]) {
  let streak = 0
  for (let index = correct.length - 1; index >= 0 && correct[index]; index -= 1) streak += 1
  return streak
}

export function longestStreak(correct: boolean[]) {
  let longest = 0
  let streak = 0
  for (const value of correct) {
    streak = value ? streak + 1 : 0
    longest = Math.max(longest, streak)
  }
  return longest
}

// The streak badges a run of this length unlocks.
export function streakBadgesFor(streak: number) {
  return streakBadges.filter((badge) => streak >= badge.length).map((badge) => badge.id)
}

// One challenge move with its engine review. Scores are centipawns from the
// mover's side, with mates as +-100000 (see scoreValue); they are null for moves
// reviewed by an older page that only sent centipawn losses.
export type ReviewedMove = {
  // Matched the master's move.
  correct: boolean
  cpl: number
  originalCpl: number
  best: number | null
  attempted: number | null
  original: number | null
  // The second-best move; null when it wasn't searched or only one move was legal.
  second: number | null
  // The player's move was the engine's best move.
  playedBest: boolean
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

// Winning chance lost by playing a move scored `to` where `from` was available.
function chanceDrop(from: number, to: number) {
  return winningChances(from) - winningChances(to)
}

export type MoveMark = '!' | '?!' | '?' | '??'

// How a reviewed move is annotated: a blunder (??), mistake (?) or inaccuracy
// (?!) by the winning chance it lost against the engine's best move, or an only
// move (!), which needs the second-best score and so only appears at badge
// depth. Null when the move is none of these or wasn't scored.
export function moveMark(move: Pick<ReviewedMove, 'best' | 'attempted' | 'second' | 'playedBest'>): MoveMark | null {
  if (move.best === null || move.attempted === null) return null
  const drop = chanceDrop(move.best, move.attempted)
  if (drop >= blunderDrop) return '??'
  if (drop >= mistakeDrop) return '?'
  if (drop >= inaccuracyDrop) return '?!'
  if (move.playedBest && move.second !== null && chanceDrop(move.best, move.second) >= onlyMoveGap) return '!'
  return null
}

// The engine badges one player's reviewed challenge earns. `finished` means the
// player played every move on time (not a time-out or resignation).
export function analysisBadgesFor(review: { depth: number; finished: boolean; moves: ReviewedMove[] }): BadgeId[] {
  const { moves } = review
  if (review.depth < minBadgeDepth || moves.length === 0) return []
  const badges: BadgeId[] = []

  const improvements = moves.filter((move) => !move.correct && move.attempted !== null && move.original !== null
    && chanceDrop(move.attempted, move.original) >= improvementMargin).length
  if (improvements >= 1) badges.push('beat-master')
  if (improvements >= 3) badges.push('beat-master-3')

  if (review.finished) {
    const accuracy = average(moves.map((move) => accuracyFromCpl(move.cpl)))
    const masterAccuracy = average(moves.map((move) => accuracyFromCpl(move.originalCpl)))
    if (accuracy >= masterAccuracy + accuracyMargin) badges.push('outplay-master')
    if (moves.every((move) => move.best !== null && move.attempted !== null)) {
      const worstDrop = Math.max(...moves.map((move) => chanceDrop(move.best!, move.attempted!)))
      if (worstDrop < blunderDrop) badges.push('no-blunders')
      if (worstDrop < mistakeDrop) badges.push('no-mistakes')
      if (worstDrop < inaccuracyDrop) badges.push('no-inaccuracies')
    }
  }

  const onlyMoves = moves.filter((move) => move.playedBest && move.best !== null && move.second !== null
    && chanceDrop(move.best, move.second) >= onlyMoveGap).length
  if (onlyMoves >= 3) badges.push('only-moves-3')
  return badges
}
