import { useEffect, useRef, useState } from 'react'
import { defaultDepth, defaultOpenPlayers, maxDepth, maxInvitees, maxOpenPlayers, minDepth, minOpenPlayers } from '../../shared/challengeRules.ts'
import { TimeControlPicker } from '../components/TimeControlPicker'
import { useRealtime } from '../realtime/context'
import { readStored, writeStored } from '../storage'
import { isValidTimeControl, timeControlPresets } from '../timeControl'
import type { TimeControl } from '../timeControl'
import type { AuthUser, Side } from '../types'
import { useChallenges } from './context'

export type NewChallengeKind = 'invite' | 'open'

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

type NewChallengeDialogProps = {
  user: AuthUser
  kind: NewChallengeKind
  onClose: () => void
}

export function NewChallengeDialog({ user, kind, onClose }: NewChallengeDialogProps) {
  const { create } = useChallenges()
  const { connected, onlineUsers } = useRealtime()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [side, setSide] = useState<Side | 'random'>('random')
  const [timeControl, setTimeControl] = useState<TimeControl>(storedTimeControl)
  const [depth, setDepth] = useState(defaultDepth)
  const [maxPlayers, setMaxPlayers] = useState(defaultOpenPlayers)
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const others = onlineUsers.filter((onlineUser) => onlineUser.id !== user.id)
  // Someone who went offline after being ticked is silently dropped.
  const invitees = selected.filter((id) => others.some((onlineUser) => onlineUser.id === id))
  const isOpen = kind === 'open'

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  function toggle(id: string) {
    setSelected((previous) => previous.includes(id) ? previous.filter((item) => item !== id) : previous.length >= maxInvitees ? previous : [...previous, id])
  }

  async function submit() {
    setBusy(true)
    setError('')
    try {
      await create(isOpen ? { kind, side, timeControl, depth, maxPlayers } : { kind, side, timeControl, depth, inviteeIds: invitees })
      onClose()
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not create the challenge.')
      setBusy(false)
    }
  }

  // A click on the backdrop lands on the dialog element itself.
  return <dialog ref={dialogRef} className="challenge-dialog" aria-labelledby="challenge-dialog-title" onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) dialogRef.current?.close() }}>
    <div className="challenge-dialog-head">
      <div>
        <p className="section-label">{isOpen ? 'OPEN CHALLENGE' : 'CHALLENGE BY INVITATION'}</p>
        <h2 id="challenge-dialog-title">{isOpen ? 'Open seats for anyone.' : 'Invite online players.'}</h2>
      </div>
      <button className="dialog-close" aria-label="Close" onClick={() => dialogRef.current?.close()}>×</button>
    </div>
    <p className="challenge-dialog-note">{isOpen
      ? 'Your challenge appears in the lobby, and anyone can take a seat until it is full. You start it whenever at least one player has joined.'
      : 'Invited players get a pop-up on any screen. You start once at least one of them has accepted.'}</p>
    <div className="challenge-form">
      <p className="section-label">YOUR SIDE</p>
      <div className="filter-group challenge-sides">{sideOptions.map((option) => <button key={option.value} className={side === option.value ? 'selected' : ''} onClick={() => setSide(option.value)}><span aria-hidden="true">{option.icon}</span> {option.label}</button>)}</div>
      <TimeControlPicker value={timeControl} allowUntimed={false} onChange={(value) => { if (value) { setTimeControl(value); writeStored(timeControlStorageKey, value) } }} />
      <label className="depth-control">REVIEW DEPTH <strong>{depth}</strong><input type="range" min={minDepth} max={maxDepth} value={depth} onChange={(event) => setDepth(Number(event.target.value))} /></label>
      {isOpen
        ? <label className="depth-control">MAX PLAYERS (YOU INCLUDED) <strong>{maxPlayers}</strong><input type="range" min={minOpenPlayers} max={maxOpenPlayers} value={maxPlayers} onChange={(event) => setMaxPlayers(Number(event.target.value))} /></label>
        : <>
          <p className="section-label">INVITE ONLINE PLAYERS <span className="invite-count">{invitees.length}/{maxInvitees}</span></p>
          {!connected ? <p className="empty-log">Reconnecting to the live server...</p> : others.length === 0 ? <p className="empty-log">No other members are online right now.</p> : <div className="invite-list">{others.map((onlineUser) => <label key={onlineUser.id} className={`invite-option ${invitees.includes(onlineUser.id) ? 'selected' : ''}`}><input type="checkbox" checked={invitees.includes(onlineUser.id)} onChange={() => toggle(onlineUser.id)} /><span className="online-dot" /><strong>{onlineUser.username}</strong><span>{onlineUser.elo} ELO</span></label>)}</div>}
        </>}
      {error && <p className="admin-error">{error}</p>}
      {isOpen
        ? <button className="primary-button challenge-submit" disabled={busy} onClick={() => void submit()}><span className="button-icon" aria-hidden="true">⚑</span> {busy ? 'Opening...' : 'Open challenge'}</button>
        : <button className="primary-button challenge-submit" disabled={busy || invitees.length === 0} onClick={() => void submit()}><span className="button-icon" aria-hidden="true">⚔</span> {busy ? 'Sending...' : `Send ${invitees.length || ''} invitation${invitees.length === 1 ? '' : 's'}`}</button>}
    </div>
  </dialog>
}
