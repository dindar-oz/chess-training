import { useState } from 'react'
import { defaultDepth, maxDepth, maxInvitees, minDepth } from '../../shared/challengeRules.ts'
import { TimeControlPicker } from '../components/TimeControlPicker'
import { useRealtime } from '../realtime/context'
import { readStored, writeStored } from '../storage'
import { isValidTimeControl, timeControlPresets } from '../timeControl'
import type { TimeControl } from '../timeControl'
import type { AuthUser, Side } from '../types'
import { useChallenges } from './context'

const timeControlStorageKey = 'chess-training-challenge-time-control'
const sideOptions: Array<{ value: Side | 'random'; label: string; icon: string }> = [
  { value: 'w', label: 'White', icon: '♔' },
  { value: 'b', label: 'Black', icon: '♚' },
  { value: 'random', label: 'Random', icon: '⚄' },
]

function storedTimeControl(): TimeControl {
  const stored = readStored<unknown>(timeControlStorageKey, null)
  return isValidTimeControl(stored) ? stored : timeControlPresets[3]
}

export function NewChallengePanel({ user }: { user: AuthUser }) {
  const { create } = useChallenges()
  const { connected, onlineUsers } = useRealtime()
  const [side, setSide] = useState<Side | 'random'>('random')
  const [timeControl, setTimeControl] = useState<TimeControl>(storedTimeControl)
  const [depth, setDepth] = useState(defaultDepth)
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const others = onlineUsers.filter((onlineUser) => onlineUser.id !== user.id)
  // Someone who went offline after being ticked is silently dropped.
  const invitees = selected.filter((id) => others.some((onlineUser) => onlineUser.id === id))

  function toggle(id: string) {
    setSelected((previous) => previous.includes(id) ? previous.filter((item) => item !== id) : previous.length >= maxInvitees ? previous : [...previous, id])
  }

  async function submit() {
    setBusy(true)
    setError('')
    try {
      await create({ side, timeControl, depth, inviteeIds: invitees })
      setSelected([])
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not create the challenge.')
    } finally {
      setBusy(false)
    }
  }

  return <section className="challenge-setup">
    <div className="challenge-intro">
      <p className="section-label">NEW CHALLENGE</p>
      <h2>Same game, same clock, best accuracy wins.</h2>
      <p>Everyone plays the same side of a game picked at random from the library. The game stays hidden until every player has finished.</p>
      <p>When everyone is done, <strong>your browser</strong> runs the engine review at the depth you choose, so keep this tab open. Players are ranked by accuracy, and ratings are updated.</p>
    </div>
    <div className="challenge-form">
      <p className="section-label">YOUR SIDE</p>
      <div className="filter-group challenge-sides">{sideOptions.map((option) => <button key={option.value} className={side === option.value ? 'selected' : ''} onClick={() => setSide(option.value)}><span aria-hidden="true">{option.icon}</span> {option.label}</button>)}</div>
      <TimeControlPicker value={timeControl} allowUntimed={false} onChange={(value) => { if (value) { setTimeControl(value); writeStored(timeControlStorageKey, value) } }} />
      <label className="depth-control">REVIEW DEPTH <strong>{depth}</strong><input type="range" min={minDepth} max={maxDepth} value={depth} onChange={(event) => setDepth(Number(event.target.value))} /></label>
      <p className="section-label">INVITE ONLINE PLAYERS <span className="invite-count">{invitees.length}/{maxInvitees}</span></p>
      {!connected ? <p className="empty-log">Reconnecting to the live server...</p> : others.length === 0 ? <p className="empty-log">No other members are online right now.</p> : <div className="invite-list">{others.map((onlineUser) => <label key={onlineUser.id} className={`invite-option ${invitees.includes(onlineUser.id) ? 'selected' : ''}`}><input type="checkbox" checked={invitees.includes(onlineUser.id)} onChange={() => toggle(onlineUser.id)} /><span className="online-dot" /><strong>{onlineUser.username}</strong><span>{onlineUser.elo} ELO</span></label>)}</div>}
      {error && <p className="admin-error">{error}</p>}
      <button className="primary-button challenge-submit" disabled={busy || invitees.length === 0} onClick={() => void submit()}><span className="button-icon" aria-hidden="true">⚔</span> {busy ? 'Sending...' : `Send ${invitees.length || ''} invitation${invitees.length === 1 ? '' : 's'}`}</button>
    </div>
  </section>
}
