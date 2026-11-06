import { useEffect } from 'react'
import { formatTimeControl } from '../timeControl'
import { ChallengeChat } from './ChallengeChat'
import { ReviewPreview } from '../review/ReviewPreview'
import { PlayerName } from '../titles/PlayerName'
import { useChallenges } from './context'
import type { ChallengeSnapshot, PlayStatus } from './types'

const playStatusLabels: Record<PlayStatus, string> = {
  playing: 'Playing',
  finished: 'Finished',
  timed_out: 'Time out',
  resigned: 'Resigned',
}

type ChallengeResultsProps = {
  challenge: ChallengeSnapshot
  userId: string
  onTrainGame: (gameId: string) => void
  onAnalyze: (challengeId: string) => void
  onClose: () => void
  closeLabel: string
  // Only the current challenge has a live chat; past ones are shown without it.
  showChat: boolean
  // Leaves the challenge before its results (only for your current challenge).
  onStepAway?: () => void
}

const notifiedNote = "You'll be notified when the results arrive, on any page of the site or at your next visit."

export function ChallengeResults({ challenge, userId, onTrainGame, onAnalyze, onClose, closeLabel, showChat, onStepAway }: ChallengeResultsProps) {
  const { markResultsSeen } = useChallenges()
  const over = challenge.status === 'complete' || challenge.status === 'void'
  const pending = challenge.status === 'playing' || challenge.status === 'analyzing'
  // Showing the final results counts as seeing them: no notice for them.
  const isPlayer = challenge.me !== null
  useEffect(() => {
    if (over && isPlayer) markResultsSeen(challenge.id)
  }, [challenge.id, isPlayer, markResultsSeen, over])
  const ranked = [...challenge.players].sort((a, b) => (a.result?.rank ?? 99) - (b.result?.rank ?? 99))
  const game = challenge.game
  const progress = challenge.analysisProgress
  const percent = progress && progress.total > 0 ? Math.round((progress.scored / progress.total) * 100) : 0

  const leave = onStepAway && <div className="step-away">
    <button className="primary-button" onClick={onStepAway}>Leave the challenge</button>
    <p>{notifiedNote}</p>
  </div>

  return <section className="history-section challenge-results">
    {challenge.status === 'playing' && <>
      <div className="section-heading"><div><p className="section-label">RESULTS PENDING</p><h2>You're done. Waiting for the other players.</h2></div></div>
      <div className="analysis-players">{challenge.players.map((player) => <div key={player.playerId} className={player.playStatus === 'playing' ? 'analyzing' : 'ready'}>
        <strong>{player.userId === userId ? 'You' : <PlayerName userId={player.userId} name={player.username} />}</strong>
        <span>{player.playStatus ? playStatusLabels[player.playStatus] : '—'}</span>
      </div>)}</div>
      {leave ?? <p className="results-note">{notifiedNote}</p>}
    </>}

    {challenge.status === 'analyzing' && <>
      <div className="section-heading"><div><p className="section-label">ENGINE REVIEW</p><h2>Everyone is done. Scoring the moves.</h2></div></div>
      {progress && <div className="analysis-progress" aria-live="polite">
        <div className="analysis-progress-label"><strong>The server is scoring every move at depth {challenge.depth}</strong><span>{percent}%</span></div>
        <div className="analysis-progress-track"><span style={{ width: `${percent}%` }} /></div>
        <div className="analysis-progress-meta"><span>{progress.scored} of {progress.total} moves</span>{challenge.analysisEngine && <span>{challenge.analysisEngine}</span>}</div>
      </div>}
      <div className="analysis-players">{challenge.players.map((player) => <div key={player.playerId} className={player.analysisReady ? 'ready' : 'analyzing'}>
        <strong>{player.userId === userId ? 'You' : <PlayerName userId={player.userId} name={player.username} />}</strong>
        <span>{player.analysisReady ? 'Scored ✓' : 'Scoring...'}</span>
      </div>)}</div>
      <p className="results-note">The server's engine scores everyone's moves the same way: the same move in the same position always costs the same, and the engine's own best move always counts as 100%.</p>
      {leave ?? <p className="results-note">{notifiedNote}</p>}
    </>}

    {challenge.status === 'void' && <>
      <div className="section-heading"><div><p className="section-label">CHALLENGE VOIDED</p><h2>The moves could not be scored.</h2></div></div>
      <p className="empty-log">This challenge was voided, so nobody's rating changed.</p>
    </>}

    {challenge.status === 'complete' && <>
      <div className="section-heading"><div><p className="section-label">FINAL STANDINGS</p><h2>{ranked[0]?.result?.rank === 1 ? `${ranked.filter((player) => player.result?.rank === 1).map((player) => player.username).join(' & ')} wins.` : 'Challenge complete.'}</h2></div></div>
      {game?.title && <div className="revealed-game">
        <div><p className="section-label">THE MYSTERY GAME WAS</p><strong>{game.white} vs {game.black}</strong><span>{game.event} · {game.date} · {game.result} · {formatTimeControl(challenge.timeControl)} · you played {challenge.side === 'w' ? 'White' : 'Black'}</span></div>
        {game.id && <button className="table-action" onClick={() => onTrainGame(game.id!)}><span className="button-icon" aria-hidden="true">↗</span> Train this game</button>}
      </div>}
      <div className="games-table-wrap"><table className="games-table results-table"><thead><tr><th>Place</th><th>Player</th><th>Accuracy</th><th>Matched</th><th>Status</th><th>Rating</th></tr></thead><tbody>{ranked.map((player) => {
        const result = player.result
        const delta = result && result.eloAfter !== null && result.eloBefore !== null ? result.eloAfter - result.eloBefore : null
        return <tr key={player.playerId} className={player.userId === userId ? 'leaderboard-self' : ''}>
          <td>{result?.rank ?? '—'}</td>
          <td><PlayerName userId={player.userId} name={player.username} /></td>
          <td>{result?.accuracy === null || result?.accuracy === undefined ? '—' : `${result.accuracy}%`}</td>
          <td>{result?.correctMoves ?? 0} / {player.movesPlayed}</td>
          <td>{player.playStatus ? playStatusLabels[player.playStatus] : '—'}</td>
          <td>{result?.eloAfter ?? '—'}{delta !== null && <b className={delta >= 0 ? 'rating-gain' : 'rating-loss'}> {delta >= 0 ? `+${delta}` : delta}</b>}</td>
        </tr>
      })}</tbody></table></div>
      <p className="results-note">Finishers rank above players who ran out of time or resigned. Otherwise higher accuracy wins, and accuracies within 1% count as a draw.</p>
    </>}

    {challenge.me && challenge.me.moves.length > 0 && challenge.side && !pending
      ? <ReviewPreview moves={challenge.me.moves} side={challenge.side} onAnalyze={() => onAnalyze(challenge.id)} />
      : challenge.me && challenge.me.moves.length > 0 && <div className="move-log results-moves"><p className="section-label">YOUR MOVES</p>{challenge.me.moves.map((record) => <div className="move-row" key={record.ply}><span>{Math.floor(record.ply / 2) + 1}{record.ply % 2 === 1 ? '...' : '.'}</span><strong>{record.attempted}</strong><span className={record.correct ? 'match' : 'deviation'}>{record.correct ? 'MATCH' : `→ ${record.expected}`}</span></div>)}</div>}
    {showChat && <ChallengeChat userId={userId} />}
    {(!pending || !onStepAway) && <button className="primary-button results-close" onClick={onClose}>{closeLabel}</button>}
  </section>
}
