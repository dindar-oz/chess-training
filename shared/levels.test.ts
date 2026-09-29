import { test } from 'node:test'
import assert from 'node:assert/strict'
import { levelProgress, xpForLevel } from './levels.ts'

test('each level needs 100 XP more than the one before', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(xpForLevel), [0, 100, 300, 600, 1000])
})

test('a new player is level 1 with 100 XP to go', () => {
  assert.deepEqual(levelProgress(0), { level: 1, xpIntoLevel: 0, xpForNext: 100, xpToNext: 100 })
})

test('reaching a threshold exactly moves up a level', () => {
  assert.equal(levelProgress(99).level, 1)
  assert.equal(levelProgress(100).level, 2)
  assert.deepEqual(levelProgress(450), { level: 3, xpIntoLevel: 150, xpForNext: 300, xpToNext: 150 })
})
