import { scoreValue } from '../shared/accuracy.ts'
import type { EngineScore } from '../shared/accuracy.ts'
import { EngineChannel } from '../shared/engineChannel.ts'
import type { SearchProgress, SearchResult, StartEngine } from '../shared/engineChannel.ts'

export type { EngineScore }
export type EnginePhase = 'best' | 'original' | 'attempted'
// Progress of a live search: the deepest depth reached so far, best line first.
export type LiveAnalysis = SearchProgress

const ENGINE_URL = '/engine/stockfish-18-lite-single.js'

// Stockfish in a Web Worker, behind the engine channel (see engineChannel.ts
// for how searches are isolated, timed out, checked and retried).
const startWorker: StartEngine = (onLine, onCrash) => {
  const worker = new Worker(ENGINE_URL)
  worker.addEventListener('message', (event: MessageEvent) => onLine(String(event.data)))
  worker.addEventListener('error', (event) => onCrash(event.message))
  worker.addEventListener('messageerror', () => onCrash('unreadable message'))
  return { send: (command) => worker.postMessage(command), terminate: () => worker.terminate() }
}

// One channel, and so one engine, for the page's whole lifetime, created on
// the first search. React StrictMode mounts components twice in development
// and tears the first one down; an engine per component instance could be
// aborted mid-load right as a second one starts loading the same
// multi-megabyte WASM file. Every instance of the class below shares it, so
// solo reviews and challenge analysis also take turns on it.
const channel = new EngineChannel(startWorker)

// Results are cached by depth, position and move, so searches run in the
// background during a session are reused instantly by the end-of-game review.
// A prefetch is skipped when its turn comes if it has gone stale (the session
// was abandoned) and nothing else has asked for the same search meanwhile.
// Only checked results are cached; a failed search is retried when asked again.
type CacheEntry = { promise: Promise<SearchResult>; needed: boolean }
const resultCache = new Map<string, CacheEntry>()
const maxCachedResults = 4000

export class ClientStockfishEngine {
  private queued(fen: string, depth: number, moveUci: string | undefined, multipv: number, isStale?: () => boolean) {
    const key = `${depth}|${fen}|${moveUci ?? '*'}${multipv > 1 ? `|top${multipv}` : ''}`
    const cached = resultCache.get(key)
    if (cached) {
      if (!isStale) cached.needed = true
      return cached.promise
    }
    const entry = { needed: !isStale } as CacheEntry
    entry.promise = channel.search({ fen, depth, moveUci, multipv }, () => !entry.needed && (isStale?.() ?? false))
    entry.promise.catch(() => { if (resultCache.get(key) === entry) resultCache.delete(key) })
    resultCache.set(key, entry)
    if (resultCache.size > maxCachedResults) resultCache.delete(resultCache.keys().next().value!)
    return entry.promise
  }

  analyze(fen: string, depth: number, moveUci?: string) {
    return this.queued(fen, depth, moveUci, 1).then((result) => result.lines[0].score)
  }

  // The best move's score, the second-best move's (null with only one legal
  // move), and the best move itself. Used where only moves (!) are judged.
  analyzeTopTwo(fen: string, depth: number) {
    return this.queued(fen, depth, undefined, 2).then((result) => ({ best: result.lines[0].score, second: result.lines[1]?.score ?? null, bestUci: result.bestUci }))
  }

  // Queues the searches compare() will need for a move: the best line, the
  // master's move and the attempted move, as far as they are known yet (before
  // you move, only the position). With `topTwo` the best line is searched with
  // its runner-up, as analyzeTopTwo() needs. Resolves true once all are done,
  // false if they were skipped as stale or failed.
  prefetch(fen: string, depth: number, originalUci: string | null, attemptedUci: string | null, isStale: () => boolean, topTwo = false) {
    const searches: Array<Promise<unknown>> = [this.queued(fen, depth, undefined, topTwo ? 2 : 1, isStale)]
    if (originalUci) searches.push(this.queued(fen, depth, originalUci, 1, isStale))
    if (attemptedUci && attemptedUci !== originalUci) searches.push(this.queued(fen, depth, attemptedUci, 1, isStale))
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

  // Streams the best `multipv` lines of a position as the search deepens, up to
  // `depth`, for browsing a finished game. It waits its turn like every search;
  // the returned function cancels it, stopping the search if it runs.
  analyzeLive(fen: string, depth: number, multipv: number, onUpdate: (update: LiveAnalysis) => void) {
    return channel.live({ fen, depth, multipv }, onUpdate)
  }

  terminate() {
    // No-op: the engine is shared by every instance of this class for the
    // page's lifetime, so no single component's cleanup should end it.
  }
}
