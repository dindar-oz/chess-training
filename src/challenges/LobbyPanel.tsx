import { useState } from 'react'
import { botLevels } from '../../shared/bots.ts'
import type { BotLevel } from '../../shared/bots.ts'
import { describeGameFilter } from '../../shared/gameFilter.ts'
import { formatTimeControl } from '../timeControl'
import { PlayerName } from '../titles/PlayerName'
import { ChallengeChat } from './ChallengeChat'
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
  kicked: 'Removed',
}

export function LobbyPanel({ challenge, userId }: { challenge: ChallengeSnapshot; userId: string }) {
  const { start, cancel, leave, kick, addBot } = useChallenges()
  const [botLevel, setBotLevel] = useState<BotLevel>('medium')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const isCreator = challenge.creatorId === userId
  const readyCount = challenge.players.filter((player) => player.inviteStatus === 'accepted').length
  const isOpen = challenge.maxPlayers !== null
  const seated = challenge.players.filter((player) => player.inviteStatus === 'creator' || player.inviteStatus === 'accepted').length
  const hasBots = challenge.players.some((player) => player.bot !== null)
  const gameSelection = describeGameFilter(challenge.gameFilter)

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
    <div className="section-heading"><div><p className="section-label">WAITING ROOM</p><h2>{isCreator ? 'Your challenge' : <><PlayerName userId={challenge.creatorId} name={challenge.creatorName} />'s challenge</>}</h2></div></div>
    <div className="lobby-settings"><div><span>SIDE</span><strong>{sideLabel(challenge.sideChoice)}</strong></div><div><span>TIME CONTROL</span><strong>{formatTimeControl(challenge.timeControl)}</strong></div><div><span>REVIEW DEPTH</span><strong>{challenge.depth}</strong></div>{isOpen ? <div><span>SEATS TAKEN</span><strong>{readyCount + 1}/{challenge.maxPlayers}</strong></div> : <div><span>GAME</span><strong>Picked at start</strong></div>}</div>
    {gameSelection.length > 0 && <p className="lobby-game-filter"><span>GAME SELECTION</span>{gameSelection.join(' · ')}</p>}
    <div className={`lobby-players ${isCreator ? 'can-kick' : ''}`}>{challenge.players.map((player) => <div key={player.playerId} className={`lobby-player ${player.inviteStatus}`}>
      {player.bot ? <span className="bot-dot" title="Bot" /> : <span className={player.online ? 'online-dot' : 'offline-dot'} title={player.online ? 'Online' : 'Offline'} />}
      <strong><PlayerName userId={player.userId} name={player.username} />{player.userId === userId && ' (you)'}</strong>
      <span>{player.bot ? 'UNRATED' : `${player.elo ?? '—'} ELO`}</span>
      <b>{inviteLabels[player.inviteStatus]}</b>
      {isCreator && (player.inviteStatus === 'accepted'
        ? <button className="text-button lobby-kick" disabled={busy} onClick={() => void run(() => kick(player.playerId))}>Remove</button>
        : <span />)}
    </div>)}</div>
    {isCreator && seated < (challenge.maxPlayers ?? 10) && <div className="add-bot">
      <span>PRACTICE BOT</span>
      <div className="filter-group">{(Object.keys(botLevels) as BotLevel[]).map((level) => <button key={level} className={botLevel === level ? 'selected' : ''} onClick={() => setBotLevel(level)}>{botLevels[level].label}</button>)}</div>
      <button className="table-action" disabled={busy} onClick={() => void run(() => addBot(botLevel))}><span className="button-icon" aria-hidden="true">🤖</span> Add bot</button>
      <p>Bots play the master's move most of the time ({Object.values(botLevels).map((level) => `${level.label.toLowerCase()} ${Math.round(level.masterRate * 100)}%`).join(', ')}) and never change anyone's rating.</p>
    </div>}
    {hasBots && !challenge.rated && <p className="lobby-unrated">Unrated: with only one person against bots, nobody's rating changes. Bots never count towards ratings.</p>}
    {error && <p className="admin-error">{error}</p>}
    <div className="lobby-actions">
      {isCreator ? <>
        <button className="primary-button" disabled={busy || readyCount === 0} onClick={() => void run(start)}><span className="button-icon" aria-hidden="true">▶</span> Start with {readyCount + 1} players</button>
        <button className="text-button" disabled={busy} onClick={() => void run(cancel)}>Cancel challenge</button>
        {readyCount === 0 && <p className="empty-log">{isOpen
          ? 'Waiting for at least one player to join from the lobby, or add a bot. Your challenge stays listed there until you start it or every seat is taken.'
          : 'Waiting for at least one player to accept, or add a bot. Invitations that are still open when you start will expire.'}</p>}
      </> : <>
        <p className="empty-log">Waiting for {challenge.creatorName} to start. A random game is picked at the start.</p>
        <button className="text-button" disabled={busy} onClick={() => void run(leave)}>Leave challenge</button>
      </>}
    </div>
    <ChallengeChat userId={userId} />
  </section>
}
