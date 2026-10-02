import type { EngineScore } from './accuracy.ts'

// The one way to talk to a UCI engine (Stockfish) for analysis whose numbers
// are stored: accuracies, marks, badges and rankings all come from here, so
// every search is isolated, bounded in time and checked before it is used.
//
// - Searches run strictly one at a time. A search owns the engine from its
//   `go` until the engine reports `bestmove`; output arriving while no search
//   owns the engine is dropped, so it can never be taken for another search's.
// - A search that runs too long is stopped and still owns the engine until its
//   `bestmove`. An engine that doesn't stop in time, crashes or never finishes
//   loading is terminated, and the next search starts a fresh one.
// - A result is used only if the search finished, reached the requested depth
//   and, when one move was to be searched, searched that move (an engine
//   silently searches every move if it doesn't accept the one it was given).
// - A search that fails is retried on a fresh engine before giving up.
//
// The engine itself is behind `StartEngine`: a Web Worker in the browser, a
// fake in the tests.

// A running engine: UCI commands go in through `send`. Its output lines and a
// crash come back through the callbacks it was started with, never
// synchronously from `start` or `send`.
export type EngineProcess = { send: (command: string) => void; terminate: () => void }
export type StartEngine = (onLine: (line: string) => void, onCrash: (message: string) => void) => EngineProcess

// `moveUci` restricts the search to that one move (UCI searchmoves); `multipv`
// is the number of best lines to report.
export type SearchRequest = { fen: string; depth: number; moveUci?: string; multipv: number }
// A principal line: its score for the side to move, its moves in UCI, and the
// depth it was searched to.
export type EngineLine = { score: EngineScore; pv: string[]; depth: number }
// A finished, checked search: its lines best first, the move the engine would
// play (null with no legal moves), and the depth of the best line.
export type SearchResult = { lines: EngineLine[]; bestUci: string | null; depth: number }
// A live search's progress, for display only.
export type SearchProgress = { depth: number; lines: EngineLine[]; done: boolean }

// The engine failed or its result can't be trusted; worth retrying.
export class EngineError extends Error {}
// The search was skipped before it started (see `skipIf`); not an error.
export class SearchSkipped extends Error {}

export type EngineOptions = {
  // Longest a search may run before it is stopped.
  searchTimeoutMs: number
  // How long a stopped search may take to report back before the engine is replaced.
  stopGraceMs: number
  // Longest the engine may take to load and answer the UCI handshake.
  startTimeoutMs: number
  // Tries per search, each on a fresh engine after a failure.
  attempts: number
}

export const defaultEngineOptions: EngineOptions = { searchTimeoutMs: 125_000, stopGraceMs: 10_000, startTimeoutMs: 60_000, attempts: 2 }

const uciMove = /^[a-h][1-8][a-h][1-8][qrbn]?$/

export function parseScore(line: string): EngineScore | null {
  const match = line.match(/ score (cp|mate) (-?\d+)/)
  if (!match) return null
  return match[1] === 'cp' ? { cp: Number(match[2]), mate: null } : { cp: null, mate: Number(match[2]) }
}

// One engine process and who currently owns its output.
type Process = {
  engine: EngineProcess
  ready: Promise<void>
  dead: boolean
  // The running search's line handler; null between searches.
  owner: ((line: string) => void) | null
  // The running search's crash handler.
  onCrash: ((error: EngineError) => void) | null
}

// What a search reported, before it is checked.
type RawSearch = { lines: EngineLine[]; bestUci: string | null; depth: number; stopped: 'timeout' | 'cancelled' | null }

export class EngineChannel {
  private readonly startEngine: StartEngine
  private readonly options: EngineOptions
  private process: Process | null = null
  private queue: Promise<unknown> = Promise.resolve()

  constructor(startEngine: StartEngine, options: Partial<EngineOptions> = {}) {
    this.startEngine = startEngine
    this.options = { ...defaultEngineOptions, ...options }
  }

  // A checked search result. `skipIf` is asked when the search's turn comes;
  // true skips it (SearchSkipped). Throws EngineError once every attempt failed.
  async search(request: SearchRequest, skipIf?: () => boolean): Promise<SearchResult> {
    let lastError: unknown = null
    for (let attempt = 1; attempt <= this.options.attempts; attempt += 1) {
      try {
        return await this.enqueue(async (process) => {
          if (skipIf?.()) throw new SearchSkipped('Skipped a search that is no longer needed.')
          try {
            return checked(await this.run(process, request), request)
          } catch (error) {
            // Replaced within this search's turn, so the next search (this
            // one's retry included) runs on a fresh engine.
            if (error instanceof EngineError) this.kill(process)
            throw error
          }
        })
      } catch (error) {
        if (!(error instanceof EngineError)) throw error
        lastError = error
      }
    }
    throw lastError
  }

  // A search whose progress is shown as it deepens; nothing it reports is
  // stored. The returned function cancels it (stopping it if it runs).
  live(request: SearchRequest, onProgress: (progress: SearchProgress) => void) {
    let cancelled = false
    const control: { stop: (() => void) | null } = { stop: null }
    void this.enqueue(async (process) => {
      if (cancelled) return
      const raw = await this.run(process, request, (progress) => { if (!cancelled) onProgress(progress) }, control)
      if (!cancelled) onProgress({ depth: raw.depth, lines: raw.lines, done: raw.stopped === null })
    }).catch(() => undefined)
    return () => {
      cancelled = true
      control.stop?.()
    }
  }

  private enqueue<T>(task: (process: Process) => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const process = this.current()
      await process.ready
      return task(process)
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  private current(): Process {
    if (this.process && !this.process.dead) return this.process
    const process = { dead: false, owner: null, onCrash: null } as unknown as Process
    let loading = true
    process.ready = new Promise<void>((resolve, reject) => {
      const startTimer = setTimeout(() => {
        this.kill(process)
        reject(new EngineError('The engine did not start.'))
      }, this.options.startTimeoutMs)
      process.engine = this.startEngine((line) => {
        if (process.dead) return
        if (loading) {
          if (line === 'uciok') process.engine.send('isready')
          else if (line === 'readyok') {
            loading = false
            clearTimeout(startTimer)
            resolve()
          }
          return
        }
        // Output outside a search has no owner and is dropped.
        process.owner?.(line)
      }, (message) => {
        if (process.dead) return
        const error = new EngineError(`The engine crashed${message ? `: ${message}` : '.'}`)
        this.kill(process)
        if (loading) {
          clearTimeout(startTimer)
          reject(error)
        }
        process.onCrash?.(error)
      })
      process.engine.send('uci')
    })
    // A failed start is reported to whoever awaits `ready`, not as unhandled.
    process.ready.catch(() => undefined)
    this.process = process
    return process
  }

  private kill(process: Process) {
    if (!process.dead) {
      process.dead = true
      try {
        process.engine?.terminate()
      } catch {
        // Already gone.
      }
    }
    if (this.process === process) this.process = null
  }

  // Runs one search to its bestmove. A timeout (or `control.stop`) stops it,
  // and it still owns the engine until the engine confirms; the engine is
  // replaced if that takes too long or it crashes.
  private run(process: Process, request: SearchRequest, onProgress?: (progress: SearchProgress) => void, control?: { stop: (() => void) | null }) {
    return new Promise<RawSearch>((resolve, reject) => {
      const lines: EngineLine[] = []
      let stopped: RawSearch['stopped'] = null
      let finished = false
      let graceTimer: ReturnType<typeof setTimeout> | null = null
      const finish = () => {
        finished = true
        clearTimeout(searchTimer)
        if (graceTimer) clearTimeout(graceTimer)
        process.owner = null
        process.onCrash = null
        if (control) control.stop = null
      }
      const stop = (reason: 'timeout' | 'cancelled') => {
        if (finished || stopped) return
        stopped = reason
        process.engine.send('stop')
        graceTimer = setTimeout(() => {
          finish()
          this.kill(process)
          reject(new EngineError('The engine stopped responding.'))
        }, this.options.stopGraceMs)
      }
      const searchTimer = setTimeout(() => stop('timeout'), this.options.searchTimeoutMs)
      const current = () => lines.filter(Boolean)

      process.onCrash = (error) => {
        finish()
        reject(error)
      }
      process.owner = (line) => {
        if (line.startsWith('info')) {
          // Bound scores are provisional; the exact one follows.
          const score = / (lower|upper)bound/.test(line) ? null : parseScore(line)
          if (!score) return
          const depth = Number(line.match(/ depth (\d+)/)?.[1] ?? 0)
          const pv = line.match(/ pv (.+)$/)?.[1].trim().split(' ') ?? []
          lines[Number(line.match(/ multipv (\d+)/)?.[1] ?? 1) - 1] = { score, pv, depth }
          onProgress?.({ depth: current()[0]?.depth ?? 0, lines: current(), done: false })
        } else if (line.startsWith('bestmove')) {
          finish()
          const bestUci = line.split(' ')[1] ?? ''
          resolve({ lines: current(), bestUci: uciMove.test(bestUci) ? bestUci : null, depth: current()[0]?.depth ?? 0, stopped })
        }
      }
      if (control) control.stop = () => stop('cancelled')
      process.engine.send(`setoption name MultiPV value ${request.multipv}`)
      process.engine.send(`position fen ${request.fen}`)
      process.engine.send(`go depth ${request.depth}${request.moveUci ? ` searchmoves ${request.moveUci}` : ''}`)
    })
  }
}

// The result, if it can be trusted.
function checked(raw: RawSearch, request: SearchRequest): SearchResult {
  if (raw.stopped) throw new EngineError('The search took too long and was stopped.')
  if (raw.lines.length === 0) throw new EngineError('The engine returned no score.')
  // With no legal moves the engine answers at depth 0 with `bestmove (none)`.
  if (raw.bestUci !== null) {
    if (raw.depth < request.depth) throw new EngineError(`The search ended at depth ${raw.depth} of ${request.depth}.`)
    if (request.moveUci && raw.bestUci !== request.moveUci) throw new EngineError(`The engine did not search the move ${request.moveUci}.`)
  }
  return { lines: raw.lines, bestUci: raw.bestUci, depth: raw.depth }
}
