export type EngineScore = {
  cp: number | null
  mate: number | null
}

export type EnginePhase = 'best' | 'original' | 'attempted'

const ENGINE_TIMEOUT_MS = 125_000

function scoreValue(score: EngineScore) {
  if (score.mate !== null) return score.mate > 0 ? 100_000 : -100_000
  return score.cp ?? 0
}

export class StockfishEngine {
  private requestQueue: Promise<unknown> = Promise.resolve()

  private async analyzeSingle(fen: string, depth: number, moveUci?: string): Promise<EngineScore> {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), ENGINE_TIMEOUT_MS)
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fen, depth, moveUci }),
        signal: controller.signal,
      })
      const body = await response.json() as EngineScore & { error?: string }
      if (!response.ok) throw new Error(body.error ?? 'Backend engine analysis failed.')
      return body
    } finally {
      window.clearTimeout(timeout)
    }
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
    // The backend owns the long-lived engine process.
  }
}

export function accuracyFromCpl(cpl: number) {
  return Math.round(100 * Math.exp(-cpl / 100))
}
