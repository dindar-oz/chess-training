import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { winningChances } from './accuracy.ts'
import { analysisBadgesFor, badgeDefinitions, badgeXp, currentStreak, isBadgeId, longestStreak, moveMark, streakBadgesFor } from './badges.ts'
import type { ReviewedMove } from './badges.ts'

test('current streak counts only the trailing run of correct moves', () => {
  assert.equal(currentStreak([]), 0)
  assert.equal(currentStreak([true, true, false]), 0)
  assert.equal(currentStreak([true, false, true, true]), 2)
  assert.equal(currentStreak([true, true, true]), 3)
})

test('longest streak finds the best run anywhere', () => {
  assert.equal(longestStreak([]), 0)
  assert.equal(longestStreak([false, false]), 0)
  assert.equal(longestStreak([true, true, true, false, true, true]), 3)
  assert.equal(longestStreak([true, false, true, true, true, true, true]), 5)
})

test('streak badges unlock at 3, 5 and 10', () => {
  assert.deepEqual(streakBadgesFor(2), [])
  assert.deepEqual(streakBadgesFor(3), ['challenge-streak-3'])
  assert.deepEqual(streakBadgesFor(9), ['challenge-streak-3', 'challenge-streak-5'])
  assert.deepEqual(streakBadgesFor(12), ['challenge-streak-3', 'challenge-streak-5', 'challenge-streak-10'])
})

test('badge ids are validated', () => {
  assert.equal(isBadgeId('first-challenge'), true)
  assert.equal(isBadgeId('only-moves-3'), true)
  assert.equal(isBadgeId('nope'), false)
  assert.equal(isBadgeId(3), false)
})

test('every badge pays XP and prints the same XP on its image', () => {
  for (const badge of badgeDefinitions) {
    assert.ok(badge.xp > 0, badge.id)
    assert.equal(badgeXp(badge.id), badge.xp)
    const svg = readFileSync(new URL(`../src/assets/badge-${badge.id}.svg`, import.meta.url), 'utf8')
    assert.ok(svg.includes(`>+${badge.xp} XP<`), `badge-${badge.id}.svg should show +${badge.xp} XP`)
  }
})

test('winning chances are symmetric and capped', () => {
  assert.equal(winningChances(0), 0)
  assert.ok(Math.abs(winningChances(300) + winningChances(-300)) < 1e-12)
  assert.equal(winningChances(100_000), winningChances(1000))
  assert.ok(winningChances(1000) > 0.95 && winningChances(1000) < 1)
})

// A matched move with a perfect review unless overridden.
function move(changes: Partial<ReviewedMove> = {}): ReviewedMove {
  return { correct: true, cpl: 0, originalCpl: 0, best: 30, attempted: 30, original: 30, second: 10, playedBest: true, ...changes }
}
const improvement = move({ correct: false, attempted: 50, original: -50, playedBest: false })
const onlyMove = move({ best: 50, attempted: 50, second: -200 })

test('engine badges need a review depth of 21 or more', () => {
  const moves = [improvement, improvement, improvement, onlyMove, onlyMove, onlyMove]
  assert.deepEqual(analysisBadgesFor({ depth: 20, finished: true, moves }), [])
  assert.ok(analysisBadgesFor({ depth: 21, finished: true, moves }).includes('beat-master-3'))
  assert.deepEqual(analysisBadgesFor({ depth: 30, finished: true, moves: [] }), [])
})

test('beating the master counts deviations that keep clearly more winning chance', () => {
  const badges = (moves: ReviewedMove[]) => analysisBadgesFor({ depth: 22, finished: false, moves })
  assert.deepEqual(badges([improvement]), ['beat-master'])
  assert.deepEqual(badges([improvement, improvement, move(), improvement]), ['beat-master', 'beat-master-3'])
  // Within the noise margin, or a matched move, is not an improvement.
  assert.deepEqual(badges([move({ correct: false, attempted: 10, original: 0, playedBest: false })]), [])
  assert.deepEqual(badges([move({ attempted: 50, original: -50 })]), [])
  // Older reviews without scores can't prove an improvement.
  assert.deepEqual(badges([move({ correct: false, attempted: null, original: null })]), [])
})

test('outplaying the master needs a finished game and a 1-point accuracy lead', () => {
  const better = [move({ correct: false, cpl: 0, originalCpl: 50, playedBest: false }), move()]
  assert.ok(analysisBadgesFor({ depth: 21, finished: true, moves: better }).includes('outplay-master'))
  assert.ok(!analysisBadgesFor({ depth: 21, finished: false, moves: better }).includes('outplay-master'))
  assert.ok(!analysisBadgesFor({ depth: 21, finished: true, moves: [move(), move()] }).includes('outplay-master'))
})

test('inaccuracies, mistakes and blunders are judged by lost winning chances', () => {
  const clean = (moves: ReviewedMove[], finished = true) => analysisBadgesFor({ depth: 21, finished, moves }).filter((id) => id === 'no-blunders' || id === 'no-mistakes' || id === 'no-inaccuracies')
  assert.deepEqual(clean([move(), move()]), ['no-blunders', 'no-mistakes', 'no-inaccuracies'])
  // 0 to -120 centipawns loses about 0.22: a mistake, not a blunder.
  assert.deepEqual(clean([move(), move({ best: 0, attempted: -120, cpl: 120 })]), ['no-blunders'])
  assert.deepEqual(clean([move({ best: 100, attempted: -300, cpl: 400 })]), [])
  // Dropping from +9 to +6 in a won position loses about 0.13: an inaccuracy only.
  assert.deepEqual(clean([move({ best: 900, attempted: 600, cpl: 300 })]), ['no-blunders', 'no-mistakes'])
  // 0 to -40 centipawns loses about 0.07: not even an inaccuracy.
  assert.deepEqual(clean([move(), move({ best: 0, attempted: -40, cpl: 40 })]), ['no-blunders', 'no-mistakes', 'no-inaccuracies'])
  // Only finished games count, and every move needs its scores.
  assert.deepEqual(clean([move()], false), [])
  assert.deepEqual(clean([move(), move({ best: null, attempted: null })]), [])
})

test('only moves count when the player found the best move and the rest lose', () => {
  const badges = (moves: ReviewedMove[]) => analysisBadgesFor({ depth: 21, finished: false, moves })
  assert.deepEqual(badges([onlyMove, onlyMove, onlyMove]), ['only-moves-3'])
  assert.deepEqual(badges([onlyMove, onlyMove, move()]), [])
  assert.deepEqual(badges([onlyMove, onlyMove, { ...onlyMove, playedBest: false }]), [])
  assert.deepEqual(badges([onlyMove, onlyMove, { ...onlyMove, second: null }]), [])
})

test('moves are marked as blunders, mistakes, inaccuracies and only moves like the badges judge them', () => {
  const move = { best: 50, attempted: 50, second: null, playedBest: false }
  assert.equal(moveMark(move), null)
  // 0.1, 0.2 and 0.3 of winning chance lost from an equal position.
  assert.equal(moveMark({ ...move, best: 0, attempted: -40 }), null)
  assert.equal(moveMark({ ...move, best: 0, attempted: -60 }), '?!')
  assert.equal(moveMark({ ...move, best: 0, attempted: -120 }), '?')
  assert.equal(moveMark({ ...move, best: 0, attempted: -170 }), '??')
  // Dropping from +9 to +6 in a won position is only an inaccuracy.
  assert.equal(moveMark({ ...move, best: 900, attempted: 600 }), '?!')
  // The move from your 15. Bxd5 (+0.29 to -0.63): an inaccuracy, short of a mistake.
  assert.equal(moveMark({ ...move, best: 29, attempted: -63 }), '?!')
  assert.equal(moveMark({ ...move, playedBest: true, second: -150 }), '!')
  assert.equal(moveMark({ ...move, playedBest: false, second: -150 }), null)
  // Unscored moves (older pages) get no mark.
  assert.equal(moveMark({ ...move, best: null }), null)
})
