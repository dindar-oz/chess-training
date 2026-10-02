import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EngineChannel, EngineError, SearchSkipped } from './engineChannel.ts'
import type { SearchProgress, StartEngine } from './engineChannel.ts'

// How the fake engine treats a position (its FEN is just a name here).
type Behaviour = {
  ms?: number
  cp?: number
  // Depth it reports reaching (default: the requested depth).
  reached?: number
  // Keeps searching after `stop`, so only the channel's grace timer ends it.
  ignoresStop?: boolean
  // Searches every move even when one was given (as Stockfish does with a move it rejects).
  ignoresSearchmoves?: boolean
  // Crashes partway through the search.
  crashes?: boolean
  // No legal moves: answers at depth 0 with `bestmove (none)`.
  noMoves?: boolean
}

// A fake UCI engine that behaves like Stockfish: one search at a time (a `go`
// during a search waits for it), `stop` ends a search at once, and output
// arrives asynchronously. `starts` counts the engines started.
function fakeEngine(behaviours: Record<string, Behaviour>, options: { neverReady?: (start: number) => boolean; crashOnlyFirst?: boolean } = {}) {
  const state = { starts: 0, terminated: 0 }
  const start: StartEngine = (onLine, onCrash) => {
    state.starts += 1
    const startNumber = state.starts
    let alive = true
    let fen = ''
    let multipv = 1
    let searching: { stop: () => void } | null = null
    const pending: string[] = []
    const emit = (line: string) => setTimeout(() => { if (alive) onLine(line) })
    const run = (command: string) => {
      if (command === 'uci') return void (options.neverReady?.(startNumber) || emit('uciok'))
      if (command === 'isready') return emit('readyok')
      if (command.startsWith('setoption name MultiPV value ')) return void (multipv = Number(command.split(' ').at(-1)))
      if (command.startsWith('position fen ')) return void (fen = command.slice(13))
      if (!command.startsWith('go')) return
      const depth = Number(command.match(/depth (\d+)/)![1])
      const move = command.match(/searchmoves (\S+)/)?.[1]
      const behaviour = behaviours[fen] ?? {}
      let done = false
      const finish = () => {
        if (done) return
        done = true
        clearTimeout(timer)
        searching = null
        if (behaviour.noMoves) {
          emit('info depth 0 score mate 0')
          emit('bestmove (none)')
        } else {
          for (let line = 1; line <= multipv; line += 1) emit(`info depth ${behaviour.reached ?? depth} multipv ${line} score cp ${(behaviour.cp ?? 0) - (line - 1) * 10} pv e2e4 e7e5`)
          emit(`bestmove ${move && !behaviour.ignoresSearchmoves ? move : 'd2d4'}`)
        }
        while (!searching && pending.length) run(pending.shift()!)
      }
      searching = { stop: () => { if (!behaviour.ignoresStop) finish() } }
      if (behaviour.crashes && (!options.crashOnlyFirst || startNumber === 1)) {
        setTimeout(() => { if (alive) onCrash('worker crashed') }, 5)
        return
      }
      const timer = setTimeout(finish, behaviour.ms ?? 1)
      emit(`info depth 1 multipv 1 score cp 999 pv a2a3`)
    }
    return {
      send: (command) => {
        if (!alive) return
        if (command === 'stop') return searching?.stop()
        if (searching && command !== 'stop') return void pending.push(command)
        run(command)
      },
      terminate: () => {
        alive = false
        state.terminated += 1
      },
    }
  }
  return { start, state }
}

const fast = { searchTimeoutMs: 100, stopGraceMs: 100, startTimeoutMs: 100 }

test('a search returns its own score, depth and move', async () => {
  const { start } = fakeEngine({ a: { cp: 35 } })
  const result = await new EngineChannel(start, fast).search({ fen: 'a', depth: 12, multipv: 2 })
  assert.equal(result.depth, 12)
  assert.deepEqual(result.lines.map((line) => line.score.cp), [35, 25])
  assert.equal(result.bestUci, 'd2d4')
})

test('a search of one move reports that move', async () => {
  const { start } = fakeEngine({ a: { cp: -514 } })
  const result = await new EngineChannel(start, fast).search({ fen: 'a', depth: 12, moveUci: 'f5g7', multipv: 1 })
  assert.equal(result.bestUci, 'f5g7')
  assert.equal(result.lines[0].score.cp, -514)
})

test('a timed-out search fails, and the searches after it still get their own results', async () => {
  const { start, state } = fakeEngine({ slow: { ms: 10_000, cp: -111 }, next: { cp: 222 }, after: { cp: 333 } })
  const channel = new EngineChannel(start, fast)
  const slow = channel.search({ fen: 'slow', depth: 12, multipv: 1 })
  const next = channel.search({ fen: 'next', depth: 12, multipv: 1 })
  const after = channel.search({ fen: 'after', depth: 12, multipv: 1 })
  await assert.rejects(slow, (error) => error instanceof EngineError && /too long/.test(error.message))
  assert.equal((await next).lines[0].score.cp, 222)
  assert.equal((await after).lines[0].score.cp, 333)
  // Each failed attempt replaced its engine. The retry queues behind the two
  // other searches, which run on the engine that replaced the first one.
  assert.equal(state.starts, 2)
  assert.equal(state.terminated, 2)
})

test('an engine that ignores stop is replaced, and the next search runs on a fresh one', async () => {
  const { start, state } = fakeEngine({ stuck: { ms: 10_000, ignoresStop: true }, next: { cp: 42 } })
  const channel = new EngineChannel(start, fast)
  const stuck = channel.search({ fen: 'stuck', depth: 12, multipv: 1 })
  const next = channel.search({ fen: 'next', depth: 12, multipv: 1 })
  await assert.rejects(stuck, /stopped responding/)
  assert.equal((await next).lines[0].score.cp, 42)
  assert.ok(state.terminated >= 2)
})

test('a crash is retried on a fresh engine', async () => {
  const { start, state } = fakeEngine({ a: { crashes: true, cp: 77 } }, { crashOnlyFirst: true })
  const result = await new EngineChannel(start, fast).search({ fen: 'a', depth: 12, multipv: 1 })
  assert.equal(result.lines[0].score.cp, 77)
  assert.equal(state.starts, 2)
})

test('an engine that never finishes loading is replaced', async () => {
  const { start, state } = fakeEngine({ a: { cp: 5 } }, { neverReady: (startNumber) => startNumber === 1 })
  const result = await new EngineChannel(start, fast).search({ fen: 'a', depth: 12, multipv: 1 })
  assert.equal(result.lines[0].score.cp, 5)
  assert.equal(state.starts, 2)
})

test('a result for a move the engine did not search is rejected', async () => {
  const { start } = fakeEngine({ a: { ignoresSearchmoves: true } })
  await assert.rejects(new EngineChannel(start, fast).search({ fen: 'a', depth: 12, moveUci: 'e1g1', multipv: 1 }), /did not search the move e1g1/)
})

test('a result short of the requested depth is rejected', async () => {
  const { start } = fakeEngine({ a: { reached: 9 } })
  await assert.rejects(new EngineChannel(start, fast).search({ fen: 'a', depth: 12, multipv: 1 }), /depth 9 of 12/)
})

test('a position with no legal moves is scored at depth 0', async () => {
  const { start } = fakeEngine({ mated: { noMoves: true } })
  const result = await new EngineChannel(start, fast).search({ fen: 'mated', depth: 12, multipv: 1 })
  assert.deepEqual(result.lines[0].score, { cp: null, mate: 0 })
  assert.equal(result.bestUci, null)
})

test('output that arrives between searches is not taken for the next search', async () => {
  let deliver: ((line: string) => void) | null = null
  const { start } = fakeEngine({ a: { cp: 10 }, b: { cp: 20 } })
  const spying: StartEngine = (onLine, onCrash) => {
    deliver = onLine
    return start(onLine, onCrash)
  }
  const channel = new EngineChannel(spying, fast)
  assert.equal((await channel.search({ fen: 'a', depth: 12, multipv: 1 })).lines[0].score.cp, 10)
  // A stray line with no search running: dropped.
  deliver!('info depth 12 multipv 1 score cp -9999 pv h2h4')
  deliver!('bestmove h2h4')
  assert.equal((await channel.search({ fen: 'b', depth: 12, multipv: 1 })).lines[0].score.cp, 20)
})

test('a skipped search is not retried and does not block the queue', async () => {
  const { start, state } = fakeEngine({ a: { cp: 1 } })
  const channel = new EngineChannel(start, fast)
  await assert.rejects(channel.search({ fen: 'a', depth: 12, multipv: 1 }, () => true), (error) => error instanceof SearchSkipped)
  assert.equal((await channel.search({ fen: 'a', depth: 12, multipv: 1 })).lines[0].score.cp, 1)
  assert.equal(state.starts, 1)
})

test('a live search reports progress, and cancelling it frees the engine for the next search', async () => {
  const { start } = fakeEngine({ deep: { ms: 10_000, cp: 50 }, next: { cp: 60 } })
  const channel = new EngineChannel(start, fast)
  const updates: SearchProgress[] = []
  const cancel = channel.live({ fen: 'deep', depth: 30, multipv: 3 }, (progress) => updates.push(progress))
  await new Promise((resolve) => setTimeout(resolve, 20))
  cancel()
  assert.equal((await channel.search({ fen: 'next', depth: 12, multipv: 1 })).lines[0].score.cp, 60)
  assert.ok(updates.length >= 1 && updates.every((update) => !update.done))
})
