export type EngineScore = {
  cp: number | null
  mate: number | null
}

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

function scoreValue(score: EngineScore) {
  if (score.mate !== null) return score.mate > 0 ? 100_000 : -100_000
  return score.cp ?? 0
}

// One Worker for the page's whole lifetime, created lazily on first use.
// React StrictMode mounts components twice in development and tears the first
// one down; if the engine were created per component instance, that teardown
// could abort a Worker mid-handshake right as a second one starts loading the
// same multi-megabyte WASM file. A module-level singleton sidesteps that
// entirely, matching how the Node backend already keeps one persistent engine.
let sharedWorker: Worker | null = null
let sharedReady: Promise<void> | null = null

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
  private requestQueue: Promise<unknown> = Promise.resolve()

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

  analyze(fen: string, depth: number, moveUci?: string) {
    const task = this.requestQueue.then(() => this.analyzeSingle(fen, depth, moveUci))
    this.requestQueue = task.catch(() => undefined)
    return task
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
