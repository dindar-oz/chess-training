import { scoreValue } from '../shared/accuracy.ts'
import type { EngineScore } from '../shared/accuracy.ts'

export type { EngineScore }
export type EnginePhase = 'best' | 'original' | 'attempted'

const ENGINE_URL = '/engine/stockfish-18-lite-single.js'
const ANALYSIS_TIMEOUT_MS = 125_000

function parseScore(line: string): EngineScore | null {
  const match = line.match(/score (cp|mate) (-?\d+)/)
  if (!match) return null
  return match[1] === 'cp'
    ? { cp: Number(match[2]), mate: null }
    : { cp: null, mate: Number(match[2]) }
}

// One Worker for the page's whole lifetime, created lazily on first use.
// React StrictMode mounts components twice in development and tears the first
// one down; if the engine were created per component instance, that teardown
// could abort a Worker mid-handshake right as a second one starts loading the
// same multi-megabyte WASM file. A module-level singleton sidesteps that
// entirely, matching how the Node backend already keeps one persistent engine.
let sharedWorker: Worker | null = null
let sharedReady: Promise<void> | null = null
// The queue is shared too: the worker can run only one search at a time, and solo
// reviews and challenge analysis may use separate engine instances concurrently.
let sharedQueue: Promise<unknown> = Promise.resolve()

// Results are cached by depth, position and move, so searches run in the
// background during a session are reused instantly by the end-of-game review.
// A prefetch is skipped when its turn comes if it has gone stale (the session
// was abandoned) and nothing else has asked for the same search meanwhile.
type CacheEntry = { promise: Promise<EngineScore>; needed: boolean }
const resultCache = new Map<string, CacheEntry>()
const maxCachedResults = 4000

class StaleAnalysisError extends Error {}

function getSharedEngine() {
  if (!sharedWorker) {
    const worker = new Worker(ENGINE_URL)
    sharedWorker = worker
    sharedReady = new Promise((resolve, reject) => {
      const onMessage = (event: MessageEvent<string>) => {
        if (event.data === 'uciok') {
          worker.postMessage('isready')
        } else if (event.data === 'readyok') {
          worker.removeEventListener('message', onMessage)
          resolve()
        }
      }
      worker.addEventListener('message', onMessage)
      worker.addEventListener('error', (event) => reject(new Error(event.message)), { once: true })
      worker.postMessage('uci')
    })
  }
  return { worker: sharedWorker, ready: sharedReady! }
}

export class ClientStockfishEngine {
  private worker: Worker
  private ready: Promise<void>

  constructor() {
    const shared = getSharedEngine()
    this.worker = shared.worker
    this.ready = shared.ready
  }

  private analyzeSingle(fen: string, depth: number, moveUci?: string): Promise<EngineScore> {
    return this.ready.then(() => new Promise<EngineScore>((resolve, reject) => {
      let latestScore: EngineScore | null = null
      const timeout = window.setTimeout(() => {
        this.worker.removeEventListener('message', onMessage)
        reject(new Error('Engine analysis timed out.'))
      }, ANALYSIS_TIMEOUT_MS)

      const onMessage = (event: MessageEvent<string>) => {
        const line = event.data
        const score = parseScore(line)
        if (score) latestScore = score
        if (line.startsWith('bestmove')) {
          window.clearTimeout(timeout)
          this.worker.removeEventListener('message', onMessage)
          if (latestScore) resolve(latestScore)
          else reject(new Error('Engine returned no score.'))
        }
      }

      this.worker.addEventListener('message', onMessage)
      this.worker.postMessage(`position fen ${fen}`)
      this.worker.postMessage(`go depth ${depth}${moveUci ? ` searchmoves ${moveUci}` : ''}`)
    }))
  }

  private queued(fen: string, depth: number, moveUci: string | undefined, isStale?: () => boolean) {
    const key = `${depth}|${fen}|${moveUci ?? '*'}`
    const cached = resultCache.get(key)
    if (cached) {
      if (!isStale) cached.needed = true
      return cached.promise
    }
    const entry = { needed: !isStale } as CacheEntry
    entry.promise = sharedQueue.then(() => {
      if (!entry.needed && isStale?.()) throw new StaleAnalysisError('Skipped a stale background search.')
      return this.analyzeSingle(fen, depth, moveUci)
    })
    sharedQueue = entry.promise.catch(() => undefined)
    // Failed or skipped searches aren't cached, so a later request retries them.
    entry.promise.catch(() => { if (resultCache.get(key) === entry) resultCache.delete(key) })
    resultCache.set(key, entry)
    if (resultCache.size > maxCachedResults) resultCache.delete(resultCache.keys().next().value!)
    return entry.promise
  }

  analyze(fen: string, depth: number, moveUci?: string) {
    return this.queued(fen, depth, moveUci)
  }

  // Queues the searches compare() will need for a move: the best line, the
  // master's move and the attempted move, as far as they are known yet (before
  // you move, only the position). Resolves true once all are done, false if they
  // were skipped as stale or failed.
  prefetch(fen: string, depth: number, originalUci: string | null, attemptedUci: string | null, isStale: () => boolean) {
    const searches = [this.queued(fen, depth, undefined, isStale)]
    if (originalUci) searches.push(this.queued(fen, depth, originalUci, isStale))
    if (attemptedUci && attemptedUci !== originalUci) searches.push(this.queued(fen, depth, attemptedUci, isStale))
    return Promise.all(searches).then(() => true, () => false)
  }

  async compare(
    fen: string,
    originalUci: string,
    attemptedUci: string,
    depth: number,
    onPhase?: (phase: EnginePhase) => void,
  ) {
    onPhase?.('best')
    const best = await this.analyze(fen, depth)
    onPhase?.('original')
    const original = await this.analyze(fen, depth, originalUci)
    onPhase?.('attempted')
    const attempted = await this.analyze(fen, depth, attemptedUci)
    const bestValue = scoreValue(best)
    const originalValue = scoreValue(original)
    const attemptedValue = scoreValue(attempted)

    return {
      best,
      original,
      attemptedScore: attempted,
      originalScore: original,
      originalCpl: Math.max(0, bestValue - originalValue),
      attemptedCpl: Math.max(0, bestValue - attemptedValue),
      relativeToOriginal: attemptedValue - originalValue,
    }
  }

  terminate() {
    // No-op: the worker is a page-lifetime singleton shared across every
    // instance of this class, so no single component's cleanup should kill it.
  }
}
