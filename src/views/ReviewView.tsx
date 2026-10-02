import { useEffect, useState } from 'react'
import type { ChallengeSnapshot } from '../challenges/types'
import { MainNav } from '../components/MainNav'
import { PageHeader } from '../components/PageHeader'
import { ReviewBoard } from '../review/ReviewBoard'
import { markClasses } from '../review/steps'
import type { ReviewGame, ReviewMove, ReviewSource } from '../review/steps'
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

async function loadReview(source: ReviewSource): Promise<ReviewGame> {
  if (source.kind === 'training') {
    const response = await fetch(`/api/stats/${encodeURIComponent(source.sessionId)}/review`)
    const result = await readApiResponse<TrainingReview>(response)
    if (!response.ok) throw new Error(result.error ?? 'Could not load this game.')
    const details = ['Training', new Date(result.completedAt).toLocaleDateString(), result.timeControl, `you played ${sideName(result.side)}`]
    return { title: result.gameTitle, details: details.filter(Boolean).join(' · '), side: result.side, depth: result.depth, accuracy: result.learnerAccuracy, moves: result.moves }
  }
  const response = await fetch(`/api/challenges/${source.challengeId}`)
  const result = await readApiResponse<ChallengeSnapshot>(response)
  if (!response.ok) throw new Error(result.error ?? 'Could not load this challenge.')
  if (!result.side || !result.me || result.me.moves.length === 0) throw new Error('You played no moves in this challenge.')
  const game = result.game
  const title = game?.white && game.black ? `${game.white} vs ${game.black}` : game?.title ?? 'Challenge'
  const details = ['Challenge', game?.event, game?.date, formatTimeControl(result.timeControl), `you played ${sideName(result.side)}`]
  const accuracy = result.players.find((player) => player.playerId === result.me!.playerId)?.result?.accuracy ?? null
  return { title, details: details.filter(Boolean).join(' · '), side: result.side, depth: result.depth, accuracy, moves: result.me.moves }
}

// The summary strip under the title: accuracy, matched moves and the marks,
// which double as the legend for the move list.
function ReviewSummary({ game }: { game: ReviewGame }) {
  const matched = game.moves.filter((move) => move.correct).length
  const count = (mark: string) => game.moves.filter((move) => move.mark === mark).length
  const marks = [{ mark: '??' as const, label: 'BLUNDERS' }, { mark: '?' as const, label: 'MISTAKES' }, { mark: '!' as const, label: 'ONLY MOVES' }]
  return <div className="review-summary">
    {game.accuracy !== null && <div><strong>{Math.round(game.accuracy)}%</strong><span>ACCURACY</span></div>}
    <div><strong>{matched} / {game.moves.length}</strong><span>MATCHED THE MASTER</span></div>
    {marks.map(({ mark, label }) => <div key={mark}><strong><b className={markClasses[mark]}>{mark}</b> {count(mark)}</strong><span>{label}</span></div>)}
  </div>
}

// The analysis page of a finished training session or challenge: your moves
// on a board you can play on, with the engine's view of every position.
export function ReviewView({ user, source, from, backLabel, onBack, onNavigate, onLogout }: ReviewViewProps) {
  const [game, setGame] = useState<ReviewGame | null>(null)
  const [error, setError] = useState('')

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
        <ReviewSummary game={game} />
      </>}
    </div>
    {error ? <p className="admin-error">{error}</p>
      : !game ? <p className="empty-log">Loading the game...</p>
      : <>
        <ReviewBoard moves={game.moves} side={game.side} depth={game.depth} />
        <p className="review-hint">← → step through the game · drag or click a piece to try your own line · click a move to jump to it</p>
      </>}
  </main>
}
