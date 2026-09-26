import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeRatingChanges, expectedScore, initialRating, pairScore, ratingFloor } from './elo.ts'
import type { RatedParticipant } from './elo.ts'

const player = (id: string, accuracy: number | null, rating = initialRating, finished = true): RatedParticipant => ({ id, rating, finished, accuracy })
const byId = (changes: ReturnType<typeof computeRatingChanges>) => Object.fromEntries(changes.map((change) => [change.id, change]))

test('a duel between equal ratings moves each player by K/2', () => {
  const changes = byId(computeRatingChanges([player('a', 90), player('b', 70)]))
  assert.equal(changes.a.delta, 16)
  assert.equal(changes.b.delta, -16)
  assert.equal(changes.a.rank, 1)
  assert.equal(changes.b.rank, 2)
})

test('accuracies within the draw margin are a draw and share a rank', () => {
  const a = player('a', 80.4)
  const b = player('b', 80)
  assert.equal(pairScore(a, b), 0.5)
  const changes = byId(computeRatingChanges([a, b]))
  assert.equal(changes.a.delta, 0)
  assert.equal(changes.a.rank, 1)
  assert.equal(changes.b.rank, 1)
})

test('finishers rank above timeouts regardless of accuracy', () => {
  const finisher = player('finisher', 40)
  const timedOut = player('timedOut', 99, initialRating, false)
  assert.equal(pairScore(finisher, timedOut), 1)
  const changes = byId(computeRatingChanges([finisher, timedOut]))
  assert.equal(changes.finisher.rank, 1)
  assert.ok(changes.finisher.delta > 0)
  assert.ok(changes.timedOut.delta < 0)
})

test('a forfeited player ranks below finishers and timeouts', () => {
  const forfeited = { ...player('gone', 99), forfeited: true }
  const timedOut = player('slow', 10, initialRating, false)
  assert.equal(pairScore(timedOut, forfeited), 1)
  assert.equal(pairScore(player('done', 20), forfeited), 1)
  const changes = byId(computeRatingChanges([player('done', 20), timedOut, forfeited]))
  assert.deepEqual([changes.done.rank, changes.slow.rank, changes.gone.rank], [1, 2, 3])
  assert.ok(changes.gone.delta < 0)
})

test('timeouts are ordered among themselves by accuracy, null counting as 0', () => {
  assert.equal(pairScore(player('x', 30, 1200, false), player('y', null, 1200, false)), 1)
})

test('K is split across opponents so a 5-player winner gains about as much as a duel winner', () => {
  const field = [player('a', 95), player('b', 80), player('c', 70), player('d', 60), player('e', 50)]
  const changes = byId(computeRatingChanges(field))
  assert.equal(changes.a.delta, 16)
  assert.equal(changes.e.delta, -16)
  assert.equal(changes.c.delta, 0)
  assert.deepEqual(field.map((entry) => changes[entry.id].rank), [1, 2, 3, 4, 5])
})

test('rating changes are zero-sum up to rounding', () => {
  const field = [player('a', 91, 1500), player('b', 88, 1310), player('c', 62, 1180), player('d', 75, 990, false)]
  const total = computeRatingChanges(field).reduce((sum, change) => sum + change.delta, 0)
  assert.ok(Math.abs(total) <= field.length / 2)
})

test('an upset against a much stronger player gains more than beating an equal', () => {
  const upset = byId(computeRatingChanges([player('weak', 90, 1000), player('strong', 70, 1600)]))
  assert.ok(upset.weak.delta > 16)
  assert.ok(expectedScore(1000, 1600) < 0.1)
})

test('ratings never fall below the floor', () => {
  const changes = byId(computeRatingChanges([player('a', 90, 2400), player('b', 10, ratingFloor)]))
  assert.equal(changes.b.after, ratingFloor)
})

test('a lone participant is unrated', () => {
  assert.deepEqual(computeRatingChanges([player('solo', 90)]), [{ id: 'solo', before: initialRating, after: initialRating, delta: 0, rank: 1 }])
})
