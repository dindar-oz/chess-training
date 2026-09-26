import { formatTimeControl } from '../timeControl'
import { ChallengeChat } from './ChallengeChat'
import type { AnalysisRun } from './context'
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
  analysisRun: AnalysisRun | null
  onRetryAnalysis: () => void
  onTrainGame: (gameId: string) => void
  onClose: () => void
  closeLabel: string
  // Only the current challenge has a live chat; past ones are shown without it.
  showChat: boolean
}

export function ChallengeResults({ challenge, userId, analysisRun, onRetryAnalysis, onTrainGame, onClose, closeLabel, showChat }: ChallengeResultsProps) {
  const isCreator = challenge.creatorId === userId
  const ranked = [...challenge.players].sort((a, b) => (a.result?.rank ?? 99) - (b.result?.rank ?? 99))
  const progress = analysisRun ?? (challenge.analysis ? { ...challenge.analysis, error: null } : null)
  const game = challenge.game

  return <section className="history-section challenge-results">
    {challenge.status === 'analyzing' && <>
      <div className="section-heading"><div><p className="section-label">ENGINE REVIEW</p><h2>Everyone is done. Scoring the moves.</h2></div></div>
      <div className="analysis-progress" aria-live="polite">
        <div className="analysis-progress-label"><strong>{isCreator ? 'Your browser is analyzing at depth ' + challenge.depth : `${challenge.creatorName}'s browser is analyzing at depth ${challenge.depth}`}</strong><span>{progress && progress.total > 0 ? `${Math.round((progress.done / progress.total) * 100)}%` : 'Starting...'}</span></div>
        <div className="analysis-progress-track"><span style={{ width: `${progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%` }} /></div>
        <div className="analysis-progress-meta"><span>{progress ? `${progress.done} of ${progress.total} evaluations` : 'Waiting for the first evaluations'}</span><span>{isCreator ? 'Keep this tab open until it finishes' : 'Results appear here automatically'}</span></div>
      </div>
      {isCreator && analysisRun?.error && <div className="admin-error">The analysis stopped: {analysisRun.error} <button className="text-button" onClick={onRetryAnalysis}>Retry</button></div>}
    </>}

    {challenge.status === 'void' && <>
      <div className="section-heading"><div><p className="section-label">CHALLENGE VOIDED</p><h2>The analysis never arrived.</h2></div></div>
      <p className="empty-log">The creator's browser didn't finish the engine review within 24 hours, so nobody's rating changed.</p>
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
          <td>{player.username}</td>
          <td>{result?.accuracy === null || result?.accuracy === undefined ? '—' : `${result.accuracy}%`}</td>
          <td>{result?.correctMoves ?? 0} / {player.movesPlayed}</td>
          <td>{player.playStatus ? playStatusLabels[player.playStatus] : '—'}</td>
          <td>{result?.eloAfter ?? '—'}{delta !== null && <b className={delta >= 0 ? 'rating-gain' : 'rating-loss'}> {delta >= 0 ? `+${delta}` : delta}</b>}</td>
        </tr>
      })}</tbody></table></div>
      <p className="results-note">Finishers rank above players who ran out of time or resigned. Otherwise higher accuracy wins, and accuracies within 1% count as a draw.</p>
    </>}

    {challenge.me && challenge.me.moves.length > 0 && <div className="move-log results-moves"><p className="section-label">YOUR MOVES</p>{challenge.me.moves.map((record) => <div className="move-row" key={record.ply}><span>{Math.floor(record.ply / 2) + 1}{record.ply % 2 === 1 ? '...' : '.'}</span><strong>{record.attempted}</strong><span className={record.correct ? 'match' : 'deviation'}>{record.correct ? 'MATCH' : `→ ${record.expected}`}</span></div>)}</div>}
    {showChat && <ChallengeChat userId={userId} />}
    {challenge.status !== 'analyzing' && <button className="primary-button results-close" onClick={onClose}>{closeLabel}</button>}
  </section>
}
