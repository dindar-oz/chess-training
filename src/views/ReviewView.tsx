import { useEffect, useState } from 'react'
import { moveMark } from '../../shared/badges.ts'
import type { ChallengeSnapshot } from '../challenges/types'
import { MainNav } from '../components/MainNav'
import { PageHeader } from '../components/PageHeader'
import { AccuracyPlot } from '../review/AccuracyPlot'
import { ReviewBoard } from '../review/ReviewBoard'
import { hasAccuracyData, markClasses } from '../review/steps'
import type { OtherPlayerProgress, ReviewGame, ReviewMove, ReviewSource } from '../review/steps'
import { readStored, writeStored } from '../storage'
import { formatTimeControl } from '../timeControl'
import { readApiResponse } from '../types'
import type { AppView, AuthUser, Side } from '../types'

type ReviewViewProps = {
  user: AuthUser
  source: ReviewSource
  // The page the analysis was opened from: highlighted in the menu, and where "Back" returns.
  from: AppView
  backLabel: string
  onBack: () => void
  onNavigate: (view: AppView) => void
  onLogout: () => void
}

type TrainingReview = { gameTitle: string; side: Side; completedAt: string; timeControl: string | null; learnerAccuracy: number | null; depth: number; moves: ReviewMove[] }

const sideName = (side: Side) => side === 'w' ? 'White' : 'Black'
const plotStorageKey = 'chess-training-accuracy-plot'

// The other challengers' per-move numbers for the accuracy plot; the page
// still opens without them.
async function loadOthers(challengeId: string) {
  try {
    const response = await fetch(`/api/challenges/${challengeId}/progress`)
    return response.ok ? (await response.json() as { players: OtherPlayerProgress[] }).players : []
  } catch {
    return []
  }
}

async function loadReview(source: ReviewSource): Promise<ReviewGame> {
  if (source.kind === 'training') {
    const response = await fetch(`/api/stats/${encodeURIComponent(source.sessionId)}/review`)
    const result = await readApiResponse<TrainingReview>(response)
    if (!response.ok) throw new Error(result.error ?? 'Could not load this game.')
    const details = ['Training', new Date(result.completedAt).toLocaleDateString(), result.timeControl, `you played ${sideName(result.side)}`]
    // Marks come from the saved scores where there are some, so sessions saved
    // before a mark existed (such as ?!) get it too; older ones keep theirs.
    const moves = result.moves.map((move) => move.bestScore !== null && move.bestScore !== undefined && move.attemptedScore !== null && move.attemptedScore !== undefined
      ? { ...move, mark: moveMark({ best: move.bestScore, attempted: move.attemptedScore, second: null, playedBest: false }) }
      : move)
    return { title: result.gameTitle, details: details.filter(Boolean).join(' · '), side: result.side, depth: result.depth, accuracy: result.learnerAccuracy, moves, others: [] }
  }
  const [response, others] = await Promise.all([fetch(`/api/challenges/${source.challengeId}`), loadOthers(source.challengeId)])
  const result = await readApiResponse<ChallengeSnapshot>(response)
  if (!response.ok) throw new Error(result.error ?? 'Could not load this challenge.')
  if (!result.side || !result.me || result.me.moves.length === 0) throw new Error('You played no moves in this challenge.')
  const game = result.game
  const title = game?.white && game.black ? `${game.white} vs ${game.black}` : game?.title ?? 'Challenge'
  const details = ['Challenge', game?.event, game?.date, formatTimeControl(result.timeControl), `you played ${sideName(result.side)}`]
  const accuracy = result.players.find((player) => player.playerId === result.me!.playerId)?.result?.accuracy ?? null
  return { title, details: details.filter(Boolean).join(' · '), side: result.side, depth: result.depth, accuracy, moves: result.me.moves, others }
}

// The summary strip under the title: accuracy, matched moves and the marks,
// which double as the legend for the move list, then the plot toggle (when the
// moves carry the numbers it needs).
function ReviewSummary({ game, plotShown, onTogglePlot }: { game: ReviewGame; plotShown: boolean; onTogglePlot: (() => void) | null }) {
  const matched = game.moves.filter((move) => move.correct).length
  const count = (mark: string) => game.moves.filter((move) => move.mark === mark).length
  const marks = [{ mark: '??' as const, label: 'BLUNDERS' }, { mark: '?' as const, label: 'MISTAKES' }, { mark: '?!' as const, label: 'INACCURACIES' }, { mark: '!' as const, label: 'ONLY MOVES' }]
  return <div className="review-summary">
    {game.accuracy !== null && <div><strong>{Math.round(game.accuracy)}%</strong><span>ACCURACY</span></div>}
    <div><strong>{matched} / {game.moves.length}</strong><span>MATCHED THE MASTER</span></div>
    {marks.map(({ mark, label }) => <div key={mark}><strong><b className={markClasses[mark]}>{mark}</b> {count(mark)}</strong><span>{label}</span></div>)}
    {onTogglePlot && <button className={`table-action ${plotShown ? '' : 'secondary'} plot-toggle`} aria-pressed={plotShown} onClick={onTogglePlot}><span className="button-icon" aria-hidden="true">↗</span> {plotShown ? 'Hide accuracy plot' : 'Show accuracy plot'}</button>}
  </div>
}

// The analysis page of a finished training session or challenge: your moves
// on a board you can play on, with the engine's view of every position.
export function ReviewView({ user, source, from, backLabel, onBack, onNavigate, onLogout }: ReviewViewProps) {
  const [game, setGame] = useState<ReviewGame | null>(null)
  const [error, setError] = useState('')
  // Remembered across visits, so whoever likes the plot keeps it open.
  const [plotShown, setPlotShown] = useState(() => readStored<unknown>(plotStorageKey, false) === true)
  const canPlot = game !== null && hasAccuracyData(game.moves)

  function togglePlot() {
    setPlotShown(!plotShown)
    writeStored(plotStorageKey, !plotShown)
  }

  useEffect(() => {
    let cancelled = false
    loadReview(source)
      .then((loaded) => { if (!cancelled) setGame(loaded) })
      .catch((loadError: unknown) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load this game.') })
    return () => { cancelled = true }
  }, [source])

  return <main className="app-shell review-page">
    <PageHeader eyebrow="REPLAY LAB / GAME ANALYSIS" user={user} onLogout={onLogout} />
    <MainNav view={from} isAdmin={user.role === 'admin'} onNavigate={onNavigate} />
    <div className="review-page-head">
      <button className="text-button review-back" onClick={onBack}>← {backLabel}</button>
      {game && <>
        <div className="review-title"><h2>{game.title}</h2><span>{game.details}</span></div>
        <ReviewSummary game={game} plotShown={plotShown} onTogglePlot={canPlot ? togglePlot : null} />
      </>}
    </div>
    {error ? <p className="admin-error">{error}</p>
      : !game ? <p className="empty-log">Loading the game...</p>
      : <>
        <ReviewBoard moves={game.moves} side={game.side} depth={game.depth}
          belowBoard={canPlot && plotShown ? ({ position, goToMove }) => <AccuracyPlot moves={game.moves} others={game.others} position={position} onSelectMove={goToMove} /> : undefined} />
        <p className="review-hint">← → step through the game · drag or click a piece to try your own line · click a move to jump to it</p>
      </>}
  </main>
}
