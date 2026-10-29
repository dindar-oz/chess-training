import { test } from 'node:test'
import assert from 'node:assert/strict'
import { anyGame, describeGameFilter, parseGameFilter, plyRange } from './gameFilter.ts'

test('a missing filter picks any game', () => {
  assert.deepEqual(parseGameFilter(undefined), anyGame)
  assert.deepEqual(parseGameFilter(null), anyGame)
})

test('a valid filter is kept and unknown fields are dropped', () => {
  assert.deepEqual(parseGameFilter({ minMoves: 30, maxMoves: 60, decisiveOnly: true, minElo: 2400, extra: 1 }), { minMoves: 30, maxMoves: 60, decisiveOnly: true, minElo: 2400 })
})

test('invalid filters are rejected', () => {
  assert.throws(() => parseGameFilter({ minMoves: 60, maxMoves: 30 }), /minimum length is above/)
  assert.throws(() => parseGameFilter({ minMoves: 0 }), /Game length/)
  assert.throws(() => parseGameFilter({ maxMoves: 2.5 }), /Game length/)
  assert.throws(() => parseGameFilter({ minElo: '2400' }), /Invalid game filter/)
  assert.throws(() => parseGameFilter({ minElo: 9000 }), /Minimum ELO/)
  assert.throws(() => parseGameFilter('any'), /Invalid game filter/)
})

test('move limits cover both plies of a full move', () => {
  assert.deepEqual(plyRange(anyGame), { minPlies: 0, maxPlies: null })
  // 21 moves is 41 plies (White moved last) or 42; 40 moves is at most 80 plies.
  assert.deepEqual(plyRange({ ...anyGame, minMoves: 21, maxMoves: 40 }), { minPlies: 41, maxPlies: 80 })
})

test('descriptions name each active limit', () => {
  assert.deepEqual(describeGameFilter(anyGame), [])
  assert.deepEqual(describeGameFilter({ minMoves: 30, maxMoves: 60, decisiveOnly: true, minElo: 2400 }), ['30–60 moves', 'Decisive', 'Both 2400+ ELO'])
  assert.deepEqual(describeGameFilter({ ...anyGame, minMoves: 30 }), ['30+ moves'])
  assert.deepEqual(describeGameFilter({ ...anyGame, maxMoves: 40 }), ['Up to 40 moves'])
})
