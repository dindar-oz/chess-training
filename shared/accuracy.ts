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

// How a position was judged: the score of its best line for the side to move,
// the engine's best move (null with no legal moves), and the second-best line's
// score (null with only one legal move). Scores are centipawns, as scoreValue().
export type PositionVerdict = { best: number; bestUci: string | null; second: number | null }

// A move's score and centipawn loss. The engine's best move is worth the best
// line and loses nothing, by definition. Any other move is worth the score of a
// search restricted to it, and loses what it falls short of the best line;
// never less than 0, should that search rate it higher than the best line did.
export function judgeMove(position: PositionVerdict, moveUci: string, searchedScore: number | null) {
  if (moveUci === position.bestUci) return { score: position.best, cpl: 0 }
  if (searchedScore === null) return null
  return { score: searchedScore, cpl: Math.max(0, position.best - searchedScore) }
}
