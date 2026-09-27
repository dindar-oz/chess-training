import assert from 'node:assert/strict'
import { test } from 'node:test'
import { currentStreak, isBadgeId, longestStreak, streakBadgesFor } from './badges.ts'

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
  assert.equal(isBadgeId('nope'), false)
  assert.equal(isBadgeId(3), false)
})
