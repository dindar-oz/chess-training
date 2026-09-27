// Badges shared by the server (which awards them) and the client (which shows them).

export type BadgeId = 'first-game' | 'first-challenge' | 'challenge-streak-3' | 'challenge-streak-5' | 'challenge-streak-10'

export type BadgeDefinition = {
  id: BadgeId
  name: string
  // Shown once the badge is earned.
  description: string
  // Shown while it is still locked.
  hint: string
}

// Matching the master's move this many times in a row within one challenge.
export const streakBadges: Array<{ length: number; id: BadgeId }> = [
  { length: 3, id: 'challenge-streak-3' },
  { length: 5, id: 'challenge-streak-5' },
  { length: 10, id: 'challenge-streak-10' },
]

export const badgeDefinitions: BadgeDefinition[] = [
  {
    id: 'first-game',
    name: '1st Game Completed',
    description: 'Earned for finishing your first game, in training or in a challenge.',
    hint: 'Finish a training session or a challenge to unlock this badge.',
  },
  {
    id: 'first-challenge',
    name: 'First Challenge',
    description: 'Earned for playing your first challenge through to the results.',
    hint: 'Play a challenge through to the results without resigning.',
  },
  {
    id: 'challenge-streak-3',
    name: 'Hat Trick',
    description: 'Matched 3 master moves in a row during a challenge.',
    hint: 'Match 3 master moves in a row during a challenge.',
  },
  {
    id: 'challenge-streak-5',
    name: 'On Fire',
    description: 'Matched 5 master moves in a row during a challenge.',
    hint: 'Match 5 master moves in a row during a challenge.',
  },
  {
    id: 'challenge-streak-10',
    name: 'Master Mind',
    description: 'Matched 10 master moves in a row during a challenge.',
    hint: 'Match 10 master moves in a row during a challenge.',
  },
]

export function isBadgeId(value: unknown): value is BadgeId {
  return badgeDefinitions.some((badge) => badge.id === value)
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
