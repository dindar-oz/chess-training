import { useState } from 'react'
import { formatTimeControl } from '../timeControl'
import { useChallenges } from './context'
import { sideLabel } from './types'
import type { ChallengeSnapshot, InviteStatus } from './types'

const inviteLabels: Record<InviteStatus, string> = {
  creator: 'Host',
  invited: 'Invited...',
  accepted: 'Ready',
  declined: 'Declined',
  left: 'Left',
  expired: 'Expired',
}

export function LobbyPanel({ challenge, userId }: { challenge: ChallengeSnapshot; userId: string }) {
  const { start, cancel, leave } = useChallenges()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const isCreator = challenge.creatorId === userId
  const readyCount = challenge.players.filter((player) => player.inviteStatus === 'accepted').length

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The action failed.')
    } finally {
      setBusy(false)
    }
  }

  return <section className="history-section lobby">
    <div className="section-heading"><div><p className="section-label">WAITING ROOM</p><h2>{isCreator ? 'Your challenge' : `${challenge.creatorName}'s challenge`}</h2></div></div>
    <div className="lobby-settings"><div><span>SIDE</span><strong>{sideLabel(challenge.sideChoice)}</strong></div><div><span>TIME CONTROL</span><strong>{formatTimeControl(challenge.timeControl)}</strong></div><div><span>REVIEW DEPTH</span><strong>{challenge.depth}</strong></div><div><span>GAME</span><strong>Picked at start</strong></div></div>
    <div className="lobby-players">{challenge.players.map((player) => <div key={player.playerId} className={`lobby-player ${player.inviteStatus}`}>
      <span className={player.online ? 'online-dot' : 'offline-dot'} title={player.online ? 'Online' : 'Offline'} />
      <strong>{player.username}{player.userId === userId && ' (you)'}</strong>
      <span>{player.elo ?? '—'} ELO</span>
      <b>{inviteLabels[player.inviteStatus]}</b>
    </div>)}</div>
    {error && <p className="admin-error">{error}</p>}
    <div className="lobby-actions">
      {isCreator ? <>
        <button className="primary-button" disabled={busy || readyCount === 0} onClick={() => void run(start)}><span className="button-icon" aria-hidden="true">▶</span> Start with {readyCount + 1} players</button>
        <button className="text-button" disabled={busy} onClick={() => void run(cancel)}>Cancel challenge</button>
        {readyCount === 0 && <p className="empty-log">Waiting for at least one player to accept. Invitations that are still open when you start will expire.</p>}
      </> : <>
        <p className="empty-log">Waiting for {challenge.creatorName} to start. A random game is picked at the start.</p>
        <button className="text-button" disabled={busy} onClick={() => void run(leave)}>Leave challenge</button>
      </>}
    </div>
  </section>
}
