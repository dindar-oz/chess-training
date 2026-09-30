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

// Winning chances from the mover's point of view, from -1 (lost) to 1 (won), as
// lichess computes them: centipawns are capped at +-1000, so a mate counts as a
// clearly won position. Drops in this value decide mistakes and blunders.
export function winningChances(centipawns: number) {
  const capped = Math.max(-1000, Math.min(1000, centipawns))
  return 2 / (1 + Math.exp(-0.00368208 * capped)) - 1
}
