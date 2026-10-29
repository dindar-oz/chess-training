import { useState } from 'react'
import { anyGame, describeGameFilter, gameFilterProblem, maxFilterElo, maxFilterMoves } from '../../shared/gameFilter.ts'
import type { GameFilter } from '../../shared/gameFilter.ts'

function limitValue(text: string, max: number) {
  if (text.trim() === '') return null
  const parsed = Math.round(Number(text))
  return Number.isFinite(parsed) ? Math.min(max, Math.max(1, parsed)) : null
}

type GameFilterFieldsProps = {
  filter: GameFilter
  matching: number | null | undefined
  onChange: (filter: GameFilter) => void
}

export function GameFilterFields({ filter, matching, onChange }: GameFilterFieldsProps) {
  const summary = describeGameFilter(filter)
  const problem = gameFilterProblem(filter)
  // Starts open when a remembered selection applies; afterwards the player decides.
  const [initiallyOpen] = useState(summary.length > 0)
  const status = problem ?? (matching === undefined ? 'Checking the library...'
    : matching === null ? ''
    : matching === 0 ? 'No library games match. Loosen the selection.'
    : `${matching.toLocaleString()} library game${matching === 1 ? '' : 's'} match.`)

  return <details className="game-filter" open={initiallyOpen}>
    <summary><span className="section-label">GAME SELECTION</span><strong>{summary.length > 0 ? summary.join(' · ') : 'Any library game'}</strong></summary>
    <div className="game-filter-fields">
      <label>MIN MOVES<input type="number" min={1} max={maxFilterMoves} placeholder="Any" value={filter.minMoves ?? ''} onChange={(event) => onChange({ ...filter, minMoves: limitValue(event.target.value, maxFilterMoves) })} /></label>
      <label>MAX MOVES<input type="number" min={1} max={maxFilterMoves} placeholder="Any" value={filter.maxMoves ?? ''} onChange={(event) => onChange({ ...filter, maxMoves: limitValue(event.target.value, maxFilterMoves) })} /></label>
      <label>MIN PLAYER ELO<input type="number" min={1} max={maxFilterElo} step={50} placeholder="Any" value={filter.minElo ?? ''} onChange={(event) => onChange({ ...filter, minElo: limitValue(event.target.value, maxFilterElo) })} /></label>
    </div>
    <label className="game-filter-check"><input type="checkbox" checked={filter.decisiveOnly} onChange={(event) => onChange({ ...filter, decisiveOnly: event.target.checked })} /> Decisive games only (no draws)</label>
    <small className="game-filter-hint">Min player ELO needs both players rated at least that much; games without ratings in their PGN are skipped.</small>
    {status && <p className={`game-filter-count ${problem || matching === 0 ? 'none' : ''}`}>{status}</p>}
    {summary.length > 0 && <button type="button" className="text-button" onClick={() => onChange(anyGame)}>Any game</button>}
  </details>
}
