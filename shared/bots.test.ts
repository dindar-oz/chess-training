import { test } from 'node:test'
import assert from 'node:assert/strict'
import { botThinkMs, chooseBotMove, isBotLevel } from './bots.ts'

// A fixed sequence of "random" numbers.
const rolls = (...values: number[]) => () => values.shift() ?? 0
const position = { masterUci: 'e2e4', legalUcis: ['e2e4', 'd2d4', 'g1f3', 'a2a3'], engineBestUci: 'd2d4' }

test("a bot plays the master's move when its roll is under its level's rate", () => {
  assert.equal(chooseBotMove('weak', position, rolls(0.39)), 'e2e4')
  assert.equal(chooseBotMove('strong', position, rolls(0.84)), 'e2e4')
})

test("a straying bot plays the engine's best move when it is known", () => {
  assert.equal(chooseBotMove('strong', position, rolls(0.9)), 'd2d4')
  assert.equal(chooseBotMove('medium', position, rolls(0.7, 0.5)), 'd2d4')
})

test("a straying bot with no better move known plays the master's move", () => {
  assert.equal(chooseBotMove('strong', { ...position, engineBestUci: null }, rolls(0.9)), 'e2e4')
  assert.equal(chooseBotMove('medium', { ...position, engineBestUci: 'e2e4' }, rolls(0.9, 0.9)), 'e2e4')
})

test('the weak bot sometimes plays a random legal move other than the master\'s', () => {
  assert.equal(chooseBotMove('weak', position, rolls(0.9, 0.1, 0.99)), 'a2a3')
  assert.equal(chooseBotMove('weak', position, rolls(0.9, 0.1, 0)), 'd2d4')
  // The strong bot never does.
  assert.equal(chooseBotMove('strong', position, rolls(0.9, 0, 0.99)), 'd2d4')
})

test('a bot never thinks longer than a twentieth of its clock', () => {
  assert.equal(botThinkMs('weak', 20_000, rolls(1)), 1_000)
  assert.equal(botThinkMs('weak', 600_000, rolls(0)), 2_000)
})

test('bot levels are checked', () => {
  assert.ok(isBotLevel('medium'))
  assert.ok(!isBotLevel('grandmaster'))
  assert.ok(!isBotLevel('toString'))
})
