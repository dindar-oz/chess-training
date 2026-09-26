import { useRealtime } from '../realtime/context'
import { useChallenges } from './context'
import { formatClock, formatTimeControl } from '../timeControl'
import { ChallengeChat } from './ChallengeChat'
import type { AnalysisRun } from './context'
import type { ChallengeSnapshot, PlayStatus } from './types'
import { useNow } from './useNow'

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
  // When the snapshot arrived (performance.now()), so the grace countdown can tick.
  receivedAt?: number
  // Only the current challenge has a live chat; past ones are shown without it.
  showChat: boolean
}

export function ChallengeResults({ challenge, userId, analysisRun, onRetryAnalysis, onTrainGame, onClose, closeLabel, showChat, receivedAt }: ChallengeResultsProps) {
  const { onlineUsers } = useRealtime()
  const { helperRuns } = useChallenges()
  const onlineIds = new Set(onlineUsers.map((onlineUser) => onlineUser.id))
  const now = useNow(challenge.status === 'analyzing', 1000)
  const graceLeftMs = challenge.analysisGraceInMs === null ? null : Math.max(0, challenge.analysisGraceInMs - (receivedAt === undefined ? 0 : Math.max(0, now - receivedAt)))
  const ranked = [...challenge.players].sort((a, b) => (a.result?.rank ?? 99) - (b.result?.rank ?? 99))
  const game = challenge.game

  return <section className="history-section challenge-results">
    {challenge.status === 'analyzing' && <>
      <div className="section-heading"><div><p className="section-label">ENGINE REVIEW</p><h2>Everyone is done. Scoring the moves.</h2></div></div>
      {analysisRun && <div className="analysis-progress" aria-live="polite">
        <div className="analysis-progress-label"><strong>Your browser is analyzing your moves at depth {challenge.depth}</strong><span>{analysisRun.total > 0 ? `${Math.round((analysisRun.done / analysisRun.total) * 100)}%` : ''}</span></div>
        <div className="analysis-progress-track"><span style={{ width: `${analysisRun.total > 0 ? (analysisRun.done / analysisRun.total) * 100 : 0}%` }} /></div>
        <div className="analysis-progress-meta"><span>{analysisRun.done} of {analysisRun.total} moves</span><span>Keep this page open until it's sent</span></div>
      </div>}
      {analysisRun?.error && <div className="admin-error">Your analysis stopped: {analysisRun.error} <button className="text-button" onClick={onRetryAnalysis}>Retry</button></div>}
      <div className="analysis-players">{challenge.players.map((player) => {
        // Only a connected player's browser can still send their analysis.
        const online = player.userId !== null && (player.userId === userId || onlineIds.has(player.userId))
        const helping = helperRuns[player.playerId]
        const state = player.analysisReady ? 'ready' : helping ? 'helping' : online ? 'analyzing' : 'offline'
        const label = state === 'ready' ? 'Analysis in ✓'
          : helping ? `${online ? 'Not responding' : 'Offline'} · you're analyzing it (${helping.done}/${helping.total})`
          : state === 'analyzing' ? 'Analyzing...'
          : player.playStatus === 'finished' ? 'Offline · waiting for another player to analyze it'
          : `Offline${graceLeftMs === null ? '' : ` · ranked last in ${formatClock(graceLeftMs)}`}`
        return <div key={player.playerId} className={state}>
          <strong>{player.userId === userId ? 'You' : player.username}</strong>
          <span>{label}</span>
        </div>
      })}</div>
      <p className="results-note">Each player's browser analyzes their own moves and sends them automatically. Results appear as soon as everyone's analysis is in{graceLeftMs !== null && `; anyone still missing in ${formatClock(graceLeftMs)} is ranked last. If a player who finished on time has left, the other players' browsers analyze their moves for them`}.</p>
    </>}

    {challenge.status === 'void' && <>
      <div className="section-heading"><div><p className="section-label">CHALLENGE VOIDED</p><h2>The analysis never arrived.</h2></div></div>
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
