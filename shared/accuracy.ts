// Per-move accuracy from centipawn loss: 0 cpl = 100%, 100 cpl ≈ 37%.
export function accuracyFromCpl(cpl: number) {
  return Math.round(100 * Math.exp(-cpl / 100))
}

export type EngineScore = { cp: number | null; mate: number | null }

// Collapses a UCI score to centipawns so mates compare above any material score.
export function scoreValue(score: EngineScore) {
  if (score.mate !== null) return score.mate > 0 ? 100_000 : -100_000
  return score.cp ?? 0
}
