import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { accuracyFromCpl } from '../../shared/accuracy.ts'
import { plyLabel } from './steps'
import type { OtherPlayerProgress, ReviewMove } from './steps'

type SeriesKind = 'you' | 'master' | 'other'
// One line of the plot: its running accuracy after each of your moves (null
// where it has no value yet, or where another player had stopped playing).
type Series = { id: string; name: string; kind: SeriesKind; values: Array<number | null> }

const height = 220
const margin = { top: 14, right: 92, bottom: 28, left: 40 }
const kindOrder: Record<SeriesKind, number> = { you: 0, master: 1, other: 2 }

// The average accuracy of the moves so far, skipping moves never analyzed;
// null until the first analyzed one, and wherever a move is missing.
function runningAccuracy(cpls: Array<number | null | undefined>, present: boolean[]) {
  let total = 0
  let count = 0
  return cpls.map((cpl, index) => {
    if (!present[index]) return null
    if (cpl !== null && cpl !== undefined) {
      total += accuracyFromCpl(cpl)
      count += 1
    }
    return count > 0 ? total / count : null
  })
}

// You, the master on the same positions and, in a challenge, every other
// player: they all faced the same position at each of your plies.
function accuracySeries(moves: ReviewMove[], others: OtherPlayerProgress[]): Series[] {
  const everyMove = moves.map(() => true)
  const series: Series[] = [
    { id: 'you', name: 'You', kind: 'you', values: runningAccuracy(moves.map((move) => move.cpl), everyMove) },
    { id: 'master', name: 'Master', kind: 'master', values: runningAccuracy(moves.map((move) => move.originalCpl), everyMove) },
  ]
  others.forEach((other, index) => {
    const byPly = new Map(other.moves.map((move) => [move.ply, move.cpl]))
    series.push({ id: `other-${index}`, name: other.username, kind: 'other', values: runningAccuracy(moves.map((move) => byPly.get(move.ply)), moves.map((move) => byPly.has(move.ply))) })
  })
  return series.filter((line) => line.values.some((value) => value !== null))
}

function formatPercent(value: number | null) {
  return value === null ? '—' : `${Math.round(value)}%`
}

// A move's own accuracy and loss, e.g. "34% · lost 1.05".
function ownMove(move: ReviewMove) {
  if (move.cpl === null || move.cpl === undefined) return null
  return `${accuracyFromCpl(move.cpl)}% · lost ${(move.cpl / 100).toFixed(2)}`
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(560)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return { ref, width }
}

type AccuracyPlotProps = {
  moves: ReviewMove[]
  others: OtherPlayerProgress[]
  // Where the board is, in move indexes: n while your move n (or the master's
  // replacing it) is on show, n - 0.5 before it; null before your first move.
  position: number | null
  onSelectMove: (moveIndex: number) => void
}

// The running accuracy after each of your moves, for you, the master and the
// other challengers. A marker follows the board; hovering shows every line's
// value at a move and clicking jumps the board there. A table view carries
// the same numbers.
export function AccuracyPlot({ moves, others, position, onSelectMove }: AccuracyPlotProps) {
  const series = useMemo(() => accuracySeries(moves, others), [moves, others])
  const [hover, setHover] = useState<number | null>(null)
  const [showTable, setShowTable] = useState(false)
  const { ref, width } = useWidth()
  const count = moves.length
  const plotWidth = Math.max(40, width - margin.left - margin.right)
  const plotHeight = height - margin.top - margin.bottom

  const allValues = series.flatMap((line) => line.values.filter((value): value is number => value !== null))
  const low = Math.max(0, Math.min(80, Math.floor(Math.min(...allValues) / 10) * 10))
  const tickStep = 100 - low > 50 ? 20 : 10
  const yTicks: number[] = []
  for (let tick = low; tick <= 100; tick += tickStep) yTicks.push(tick)
  const xStep = Math.max(1, Math.ceil(count / 7))
  const xTicks = moves.map((_, index) => index).filter((index) => index % xStep === 0)

  const x = (index: number) => margin.left + (count === 1 ? plotWidth / 2 : (index / (count - 1)) * plotWidth)
  const y = (value: number) => margin.top + (1 - (value - low) / (100 - low)) * plotHeight

  function path(values: Array<number | null>) {
    let d = ''
    let drawing = false
    values.forEach((value, index) => {
      if (value === null) {
        drawing = false
        return
      }
      d += `${drawing ? 'L' : 'M'}${x(index).toFixed(1)},${y(value).toFixed(1)}`
      drawing = true
    })
    return d
  }

  function indexAt(event: MouseEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect()
    const offset = event.clientX - box.left - margin.left
    return Math.max(0, Math.min(count - 1, count === 1 ? 0 : Math.round((offset / plotWidth) * (count - 1))))
  }

  // Others under the master, under you; later lines paint on top.
  const drawOrder = [...series].sort((a, b) => kindOrder[b.kind] - kindOrder[a.kind])
  const you = series.find((line) => line.kind === 'you')
  const master = series.find((line) => line.kind === 'master')
  const othersCount = series.filter((line) => line.kind === 'other').length
  const lastOf = (line: Series) => {
    for (let index = line.values.length - 1; index >= 0; index -= 1) if (line.values[index] !== null) return { index, value: line.values[index]! }
    return null
  }
  // End labels name you and the master at the right edge, unless they would collide.
  const ends = [you, master].map((line) => line && lastOf(line) ? { line, ...lastOf(line)! } : null).filter((end) => end !== null)
  const labelEnds = ends.length < 2 || Math.abs(y(ends[0].value) - y(ends[1].value)) >= 14
  const hoverMove = hover === null ? null : moves[hover]
  const summary = `Running accuracy over your ${count} moves: ${series.filter((line) => line.kind !== 'other').map((line) => `${line.name.toLowerCase()} ${formatPercent(lastOf(line)?.value ?? null)}`).join(', ')}${othersCount ? `, and ${othersCount} other ${othersCount === 1 ? 'player' : 'players'}` : ''}.`

  return <div className="accuracy-plot" ref={ref}>
    <div className="accuracy-plot-head">
      <p className="section-label">ACCURACY PROGRESS</p>
      <div className="plot-legend">
        <span><i className="plot-key you" /> You</span>
        {master && <span><i className="plot-key master" /> Master</span>}
        {othersCount > 0 && <span title={series.filter((line) => line.kind === 'other').map((line) => line.name).join(', ')}><i className="plot-key other" /> Other players ({othersCount})</span>}
      </div>
      <button className="text-button" onClick={() => setShowTable(!showTable)}>{showTable ? 'Show plot' : 'Show table'}</button>
    </div>
    {showTable ? <div className="plot-table-wrap"><table className="plot-table">
      <thead><tr><th>Move</th><th>This move</th>{series.map((line) => <th key={line.id}>{line.name}</th>)}</tr></thead>
      <tbody>{moves.map((move, index) => <tr key={move.ply} onClick={() => onSelectMove(index)}>
        <td>{plyLabel(move.ply)} {move.attempted}{move.mark}</td>
        <td>{ownMove(move) ?? '—'}</td>
        {series.map((line) => <td key={line.id}>{formatPercent(line.values[index])}</td>)}
      </tr>)}</tbody>
    </table></div>
    : <div className="plot-frame">
      <svg width={width} height={height} role="img" aria-label={summary}
        onPointerMove={(event) => setHover(indexAt(event))} onPointerLeave={() => setHover(null)} onClick={(event) => onSelectMove(indexAt(event))}>
        {yTicks.map((tick) => <g key={tick}>
          <line className="plot-grid" x1={margin.left} x2={margin.left + plotWidth} y1={y(tick)} y2={y(tick)} />
          <text className="plot-tick" x={margin.left - 8} y={y(tick)} textAnchor="end" dominantBaseline="middle">{tick}%</text>
        </g>)}
        {xTicks.map((index) => <text key={index} className="plot-tick" x={x(index)} y={height - 8} textAnchor="middle">{Math.floor(moves[index].ply / 2) + 1}</text>)}
        {position !== null && <line className="plot-position" x1={x(Math.max(0, position))} x2={x(Math.max(0, position))} y1={margin.top} y2={margin.top + plotHeight} />}
        {hover !== null && <line className="plot-crosshair" x1={x(hover)} x2={x(hover)} y1={margin.top} y2={margin.top + plotHeight} />}
        {drawOrder.map((line) => <path key={line.id} className={`plot-line ${line.kind}`} d={path(line.values)} />)}
        {/* Only mistakes and blunders: inaccuracies are too common to dot the line with. */}
        {you && moves.map((move, index) => (move.mark === '?' || move.mark === '??') && you.values[index] !== null
          && <circle key={move.ply} className={`plot-mark ${move.mark === '??' ? 'blunder' : 'mistake'}`} cx={x(index)} cy={y(you.values[index]!)} r={4} />)}
        {ends.map((end) => <g key={end.line.id}>
          <circle className={`plot-end ${end.line.kind}`} cx={x(end.index)} cy={y(end.value)} r={4} />
          {labelEnds && <text className="plot-end-label" x={x(end.index) + 9} y={y(end.value)} dominantBaseline="middle">{end.line.name} {formatPercent(end.value)}</text>}
        </g>)}
      </svg>
      {hover !== null && hoverMove && <div className={`plot-tooltip ${x(hover) > width / 2 ? 'left' : 'right'}`} style={{ left: x(hover) }}>
        <p>{plyLabel(hoverMove.ply)} {hoverMove.attempted}{hoverMove.mark}{ownMove(hoverMove) && <> · this move {ownMove(hoverMove)}</>}</p>
        {[...series].sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || (b.values[hover] ?? -1) - (a.values[hover] ?? -1)).map((line) => <div key={line.id}>
          <i className={`plot-key ${line.kind}`} /><strong>{formatPercent(line.values[hover])}</strong><span>{line.name}</span>
        </div>)}
      </div>}
    </div>}
    <p className="plot-note">Running accuracy after each of your moves ("this move" is the move's own accuracy and the pawns it lost). ● marks your mistakes and blunders. Click the plot to jump to a move.</p>
  </div>
}
