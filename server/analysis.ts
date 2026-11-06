import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { availableParallelism, setPriority } from 'node:os'
import type { DatabaseSync } from 'node:sqlite'
import { scoreValue } from '../shared/accuracy.ts'
import type { EngineScore, PositionVerdict } from '../shared/accuracy.ts'
import { EngineChannel } from '../shared/engineChannel.ts'
import type { StartEngine } from '../shared/engineChannel.ts'

// Server-side engine analysis: the scores that challenge accuracies, marks,
// rankings and badges are computed from.
//
// Every player must gain or lose exactly the same from the same move, so a
// search is never repeated: each (position, move) is searched once per engine
// and depth, its result is stored, and everyone who reached that position or
// played that move is judged from the stored result. Searches are also made
// repeatable (one thread, a fixed hash size, a cleared hash before each search,
// a fixed depth), so they don't depend on what was searched before.
//
// The engine is native Stockfish when STOCKFISH_PATH names one (the Docker
// image does), otherwise the WASM build from the `stockfish` npm package. Each
// worker is its own process at a lower OS priority, so long searches never
// hold up the web server. Workers take the most urgent search the task source
// (the challenges) asks for whenever they are free.

// A search to run: the position's two best lines (moveUci null), or the score
// of one move in it.
export type SearchTask = { fen: string; depth: number; moveUci: string | null }

const defaultDepth = readInt('ANALYSIS_DEPTH', 24, 12, 30)
const workerCount = readInt('ANALYSIS_WORKERS', Math.max(1, availableParallelism() - 1), 1, 32)
const hashMb = 64
// Generous: a timeout only guards against a stuck engine, and a slow CPU can
// take minutes over a hard position at depth 24.
const channelOptions = {
  searchTimeoutMs: 20 * 60_000,
  stopGraceMs: 10_000,
  startTimeoutMs: 120_000,
  attempts: 2,
  setup: ['setoption name Threads value 1', `setoption name Hash value ${hashMb}`],
  independentSearches: true,
}
// A failed search is tried again after this long.
const retryDelayMs = 60_000
const maxQueuedRequests = 4

type Worker = { channel: EngineChannel; busy: boolean }
type Request = { task: SearchTask; resolve: (score: EngineScore) => void; reject: (error: unknown) => void }

let database: DatabaseSync
let engineName: string | null = null
let engineKind: 'native' | 'wasm' | null = null
let engineProblem: string | null = null
let workers: Worker[] = []
let taskSource: () => Iterable<SearchTask> = () => []
const finishedListeners: Array<() => void> = []
const inFlight = new Set<string>()
const retryAfter = new Map<string, number>()
const requests: Request[] = []
const stats = { searches: 0, totalMs: 0, lastError: null as { message: string; at: string } | null }

function readInt(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name])
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback
}

// ---------- engines ----------

// An engine in its own process, talking UCI over stdin/stdout.
function processEngine(command: string, args: string[]): StartEngine {
  return (onLine, onCrash) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true })
    let ended = false
    const crash = (message: string) => {
      if (ended) return
      ended = true
      onCrash(message)
    }
    if (child.pid !== undefined) {
      try {
        setPriority(child.pid, 10)
      } catch {
        // Not allowed here; it runs at normal priority.
      }
    }
    let buffer = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk
      for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
        const line = buffer.slice(0, end).trim()
        buffer = buffer.slice(end + 1)
        if (line) onLine(line)
      }
    })
    // Writing to an engine that just died; reported through 'exit'.
    child.stdin.on('error', () => undefined)
    child.on('error', (error) => crash(error.message))
    child.on('exit', (code, signal) => crash(`exited (${signal ?? code})`))
    return {
      send: (line) => {
        if (!ended && child.stdin.writable) child.stdin.write(`${line}\n`)
      },
      terminate: () => {
        ended = true
        child.kill()
      },
    }
  }
}

// The npm package's WASM build, run by Node in a child process that relays UCI
// lines (it can't run in a worker thread, which it mistakes for its own).
function wasmEngine(): StartEngine {
  const modulePath = createRequire(import.meta.url).resolve('stockfish')
  const relay = [
    "const readline = require('node:readline')",
    'require(process.argv[1])(process.argv[2]).then((engine) => {',
    '  engine.listener = (output) => process.stdout.write(String(output) + String.fromCharCode(10))',
    "  readline.createInterface({ input: process.stdin }).on('line', (line) => engine.sendCommand(line))",
    "  process.stdin.on('end', () => process.exit(0))",
    '})',
  ].join(String.fromCharCode(10))
  return processEngine(process.execPath, ['-e', relay, modulePath, 'single'])
}

// Starts the engine once to learn its name (which goes into every stored
// result) and to check that it runs at all.
function identify(start: StartEngine) {
  return new Promise<string>((resolve, reject) => {
    let name = ''
    const timer = setTimeout(() => {
      engine.terminate()
      reject(new Error('it did not start in time'))
    }, channelOptions.startTimeoutMs)
    const engine = start((line) => {
      if (line.startsWith('id name ')) name = line.slice(8).trim()
      if (line !== 'uciok') return
      clearTimeout(timer)
      engine.terminate()
      if (name) resolve(name)
      else reject(new Error('it did not give its name'))
    }, (message) => {
      clearTimeout(timer)
      reject(new Error(message))
    })
    engine.send('uci')
  })
}

async function startEngines() {
  const nativePath = process.env.STOCKFISH_PATH
  let start: StartEngine | null = null
  if (nativePath) {
    try {
      if (!existsSync(nativePath)) throw new Error('no such file')
      const native = processEngine(nativePath, [])
      engineName = await identify(native)
      engineKind = 'native'
      start = native
    } catch (error) {
      engineProblem = `STOCKFISH_PATH (${nativePath}) failed: ${error instanceof Error ? error.message : error}. Using the slower WASM engine instead.`
      console.error(`Analysis: ${engineProblem}`)
    }
  }
  if (!start) {
    try {
      const wasm = wasmEngine()
      engineName = await identify(wasm)
      engineKind = 'wasm'
      start = wasm
    } catch (error) {
      engineProblem = `No engine could be started: ${error instanceof Error ? error.message : error}. Challenges can't be scored.`
      console.error(`Analysis: ${engineProblem}`)
      return
    }
  }
  workers = Array.from({ length: workerCount }, () => ({ channel: new EngineChannel(start, channelOptions), busy: false }))
  console.log(`Analysis: ${engineName} (${engineKind}), ${workerCount} worker${workerCount === 1 ? '' : 's'}, depth ${defaultDepth}.`)
  pump()
}

// ---------- stored results ----------

export function initAnalysis(dependencies: { database: DatabaseSync }) {
  database = dependencies.database
  // `move` is '' for a position's two best lines (score, second_score and
  // best_uci), else the move whose score was searched (score only).
  database.exec(`
    CREATE TABLE IF NOT EXISTS engine_evaluations (
      engine TEXT NOT NULL,
      depth INTEGER NOT NULL,
      fen TEXT NOT NULL,
      move TEXT NOT NULL,
      score REAL NOT NULL,
      second_score REAL,
      best_uci TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (engine, depth, fen, move)
    )
  `)
  void startEngines()
}

type StoredRow = { score: number; second_score: number | null; best_uci: string | null }

function stored(fen: string, depth: number, move: string) {
  if (!engineName) return undefined
  return database.prepare('SELECT score, second_score, best_uci FROM engine_evaluations WHERE engine = ? AND depth = ? AND fen = ? AND move = ?')
    .get(engineName, depth, fen, move) as StoredRow | undefined
}

// The position's verdict, once it has been searched.
export function positionVerdict(fen: string, depth: number): PositionVerdict | null {
  const row = stored(fen, depth, '')
  return row ? { best: row.score, second: row.second_score, bestUci: row.best_uci } : null
}

// The score of a move in a position (for the side to move), once searched.
// The best move is never searched on its own: see judgeMove().
export function storedMoveScore(fen: string, depth: number, moveUci: string) {
  return stored(fen, depth, moveUci)?.score ?? null
}

// The default depth for new analyses, and the engine that runs them (null
// until it has started, or if none could be).
export function analysisSettings() {
  return { depth: defaultDepth, engine: engineName }
}

// ---------- scheduling ----------

const taskKey = (task: SearchTask) => `${task.depth}|${task.fen}|${task.moveUci ?? ''}`

// Where searches come from: called whenever a worker is free, it lists the
// searches wanted, most urgent first. Searches already stored, running or
// recently failed are passed over.
export function setTaskSource(source: () => Iterable<SearchTask>) {
  taskSource = source
}

// Called after each search finishes (successfully or not).
export function onSearchFinished(listener: () => void) {
  finishedListeners.push(listener)
}

// New searches may be wanted: put free workers to work.
export function requestAnalysis() {
  pump()
}

function nextTask() {
  const now = Date.now()
  for (const task of taskSource()) {
    const key = taskKey(task)
    if (inFlight.has(key) || (retryAfter.get(key) ?? 0) > now || stored(task.fen, task.depth, task.moveUci ?? '')) continue
    return task
  }
  return null
}

function pump() {
  for (const worker of workers) {
    if (worker.busy) continue
    const request = requests.shift()
    if (request) {
      void runRequest(worker, request)
      continue
    }
    const task = nextTask()
    if (!task) return
    void runTask(worker, task)
  }
}

async function search(worker: Worker, task: SearchTask) {
  worker.busy = true
  const started = Date.now()
  try {
    const result = await worker.channel.search({ fen: task.fen, depth: task.depth, moveUci: task.moveUci ?? undefined, multipv: task.moveUci ? 1 : 2 })
    stats.searches += 1
    stats.totalMs += Date.now() - started
    return result
  } catch (error) {
    stats.lastError = { message: error instanceof Error ? error.message : String(error), at: new Date().toISOString() }
    throw error
  } finally {
    worker.busy = false
  }
}

async function runTask(worker: Worker, task: SearchTask) {
  const key = taskKey(task)
  inFlight.add(key)
  try {
    const result = await search(worker, task)
    const [first, second] = result.lines
    database.prepare('INSERT OR IGNORE INTO engine_evaluations (engine, depth, fen, move, score, second_score, best_uci, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(engineName, task.depth, task.fen, task.moveUci ?? '', scoreValue(first.score), task.moveUci || !second ? null : scoreValue(second.score), task.moveUci ? null : result.bestUci, new Date().toISOString())
    retryAfter.delete(key)
  } catch (error) {
    console.error(`Analysis: search failed (${key}): ${error instanceof Error ? error.message : error}`)
    retryAfter.set(key, Date.now() + retryDelayMs)
    setTimeout(pump, retryDelayMs + 100).unref()
  } finally {
    inFlight.delete(key)
  }
  for (const listener of finishedListeners) {
    try {
      listener()
    } catch (error) {
      console.error('Analysis: a listener failed:', error)
    }
  }
  pump()
}

async function runRequest(worker: Worker, request: Request) {
  try {
    request.resolve((await search(worker, request.task)).lines[0].score)
  } catch (error) {
    request.reject(error)
  }
  pump()
}

// One search answered directly and not stored (the /api/analyze endpoint).
// These go ahead of challenge searches; null when too many are waiting.
export function analyzeNow(fen: string, depth: number, moveUci?: string) {
  if (workers.length === 0 || requests.length >= maxQueuedRequests) return null
  return new Promise<EngineScore>((resolve, reject) => {
    requests.push({ task: { fen, depth, moveUci: moveUci ?? null }, resolve, reject })
    pump()
  })
}

// For the admin page: what runs the analysis and how it is keeping up. Azure
// App Service sets WEBSITE_SKU to the plan's tier (such as Free or Basic).
export function analysisStatus() {
  let waiting = 0
  for (const task of taskSource()) {
    if (!inFlight.has(taskKey(task)) && !stored(task.fen, task.depth, task.moveUci ?? '')) waiting += 1
    if (waiting >= 999) break
  }
  return {
    engine: engineName,
    kind: engineKind,
    problem: engineProblem,
    depth: defaultDepth,
    workers: workers.length,
    busyWorkers: workers.filter((worker) => worker.busy).length,
    cpus: availableParallelism(),
    waiting,
    searches: stats.searches,
    averageSeconds: stats.searches ? Math.round(stats.totalMs / stats.searches / 100) / 10 : null,
    lastError: stats.lastError,
    hostingPlan: process.env.WEBSITE_SKU ?? null,
  }
}
