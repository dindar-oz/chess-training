import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accuracyFromCpl, judgeMove } from './accuracy.ts'

const position = { best: 42, bestUci: 'e2e4', second: 30 }

test("the engine's best move loses nothing and is fully accurate, without a search of its own", () => {
  assert.deepEqual(judgeMove(position, 'e2e4', null), { score: 42, cpl: 0 })
  // Even if a search restricted to it disagreed slightly with the best line.
  assert.deepEqual(judgeMove(position, 'e2e4', 17), { score: 42, cpl: 0 })
  assert.equal(accuracyFromCpl(0), 100)
})

test('another move loses what it falls short of the best line', () => {
  assert.deepEqual(judgeMove(position, 'd2d4', -58), { score: -58, cpl: 100 })
  assert.equal(accuracyFromCpl(100), 37)
})

test('another move rated above the best line loses nothing', () => {
  assert.deepEqual(judgeMove(position, 'd2d4', 50), { score: 50, cpl: 0 })
})

test('another move cannot be judged before it is searched', () => {
  assert.equal(judgeMove(position, 'd2d4', null), null)
})
