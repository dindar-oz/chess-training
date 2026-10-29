// Which library games a challenge may pick, chosen by its host. Lengths count full
// moves (a game of 41 plies has 21 moves); null means no limit. Shared so the
// dialog flags the same problems the server rejects.

export type GameFilter = {
  minMoves: number | null
  maxMoves: number | null
  // Only games won by either side (1-0 or 0-1).
  decisiveOnly: boolean
  // Both players rated at least this, from the PGN's WhiteElo/BlackElo headers;
  // games without ratings never match.
  minElo: number | null
}

export const anyGame: GameFilter = { minMoves: null, maxMoves: null, decisiveOnly: false, minElo: null }
export const maxFilterMoves = 400
export const maxFilterElo = 3500

export function gameFilterProblem(filter: GameFilter) {
  for (const value of [filter.minMoves, filter.maxMoves]) {
    if (value !== null && (!Number.isInteger(value) || value < 1 || value > maxFilterMoves)) return `Game length must be 1-${maxFilterMoves} moves.`
  }
  if (filter.minMoves !== null && filter.maxMoves !== null && filter.minMoves > filter.maxMoves) return 'The minimum length is above the maximum.'
  if (filter.minElo !== null && (!Number.isInteger(filter.minElo) || filter.minElo < 1 || filter.minElo > maxFilterElo)) return `Minimum ELO must be 1-${maxFilterElo}.`
  return null
}

// Reads a filter from untrusted JSON; a missing filter (older pages) picks any game.
export function parseGameFilter(value: unknown): GameFilter {
  if (value === undefined || value === null) return anyGame
  if (typeof value !== 'object') throw new Error('Invalid game filter.')
  const input = value as Record<string, unknown>
  const limit = (field: unknown) => {
    if (field === undefined || field === null) return null
    if (typeof field !== 'number') throw new Error('Invalid game filter.')
    return field
  }
  const filter = { minMoves: limit(input.minMoves), maxMoves: limit(input.maxMoves), decisiveOnly: input.decisiveOnly === true, minElo: limit(input.minElo) }
  const problem = gameFilterProblem(filter)
  if (problem) throw new Error(problem)
  return filter
}

// Ply bounds for the move limits: a game of n moves has 2n - 1 or 2n plies.
export function plyRange(filter: GameFilter) {
  return { minPlies: filter.minMoves === null ? 0 : filter.minMoves * 2 - 1, maxPlies: filter.maxMoves === null ? null : filter.maxMoves * 2 }
}

// Short labels for the lobby and the open-challenge list; empty for any game.
export function describeGameFilter(filter: GameFilter) {
  const parts: string[] = []
  if (filter.minMoves !== null && filter.maxMoves !== null) parts.push(filter.minMoves === filter.maxMoves ? `${filter.minMoves} moves` : `${filter.minMoves}–${filter.maxMoves} moves`)
  else if (filter.minMoves !== null) parts.push(`${filter.minMoves}+ moves`)
  else if (filter.maxMoves !== null) parts.push(`Up to ${filter.maxMoves} moves`)
  if (filter.decisiveOnly) parts.push('Decisive')
  if (filter.minElo !== null) parts.push(`Both ${filter.minElo}+ ELO`)
  return parts
}
