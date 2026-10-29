import { useEffect, useState } from 'react'
import { anyGame, gameFilterProblem, parseGameFilter } from '../../shared/gameFilter.ts'
import type { GameFilter } from '../../shared/gameFilter.ts'
import { readStored, writeStored } from '../storage'
import { readApiResponse } from '../types'

const gameFilterStorageKey = 'chess-training-challenge-game-filter'

export function storedGameFilter(): GameFilter {
  try {
    return parseGameFilter(readStored<unknown>(gameFilterStorageKey, null))
  } catch {
    return anyGame
  }
}

export function storeGameFilter(filter: GameFilter) {
  writeStored(gameFilterStorageKey, filter)
}

// How many library games the filter allows: undefined while checking, null when
// the filter is invalid or the server couldn't be asked.
export function useMatchingGameCount(filter: GameFilter) {
  const key = JSON.stringify(filter)
  const invalid = gameFilterProblem(filter) !== null
  const [result, setResult] = useState<{ key: string; count: number | null } | null>(null)

  useEffect(() => {
    if (invalid) return
    const controller = new AbortController()
    // Waits for typing to pause before asking the server.
    const timer = setTimeout(() => {
      fetch(`/api/challenges/games?filter=${encodeURIComponent(key)}`, { signal: controller.signal })
        .then(async (response) => {
          const body = await readApiResponse<{ count: number }>(response)
          setResult({ key, count: response.ok ? body.count : null })
        })
        .catch(() => { if (!controller.signal.aborted) setResult({ key, count: null }) })
    }, 300)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [key, invalid])

  if (invalid) return null
  return result?.key === key ? result.count : undefined
}
