import { useState } from 'react'
import { formatTimeControl } from '../timeControl'
import { PlayerName } from '../titles/PlayerName'
import { useChallenges } from './context'
import { confirmLeavingWaitingRoom, sideLabel } from './types'

const ordinal = (rank: number) => `${rank}${rank % 10 === 1 && rank % 100 !== 11 ? 'st' : rank % 10 === 2 && rank % 100 !== 12 ? 'nd' : rank % 10 === 3 && rank % 100 !== 13 ? 'rd' : 'th'}`

type InvitationToastsProps = {
  userId: string
  onAccepted: () => void
  // Goes to the Challenges page, where the requested results open.
  onOpenResults: () => void
  // The Challenges page is on screen, where the current challenge's results show anyway.
  onChallengesScreen: boolean
}

// Invitations and ready results float over every screen so nobody misses one
// while training.
export function InvitationToasts({ userId, onAccepted, onOpenResults, onChallengesScreen }: InvitationToastsProps) {
  const { current, invitations, respond, notice, dismissNotice, results, showResults, markResultsSeen } = useChallenges()
  const shownResults = results.filter((result) => !(onChallengesScreen && current?.snapshot.id === result.challengeId))
  const [busyId, setBusyId] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  async function answer(challengeId: string, accept: boolean) {
    if (accept && !confirmLeavingWaitingRoom(current?.snapshot, userId)) return
    setBusyId(challengeId)
    try {
      await respond(challengeId, accept)
      if (accept) onAccepted()
    } catch (error) {
      setErrors((previous) => ({ ...previous, [challengeId]: error instanceof Error ? error.message : 'Could not answer.' }))
    } finally {
      setBusyId(null)
    }
  }

  if (invitations.length === 0 && !notice && shownResults.length === 0) return null
  return <div className="toast-stack" aria-live="polite">
    {notice && <div className="toast notice-toast"><p>{notice}</p><button className="text-button" onClick={dismissNotice}>Dismiss</button></div>}
    {shownResults.map((result) => {
      const delta = result.eloAfter !== null && result.eloBefore !== null ? result.eloAfter - result.eloBefore : null
      const details = result.status === 'void'
        ? ["Its moves couldn't be scored, so nobody's rating changed."]
        : [result.gameTitle, result.accuracy === null ? null : `${Math.round(result.accuracy)}% accuracy`, delta === null ? null : `rating ${delta >= 0 ? '+' : ''}${delta}`].filter(Boolean)
      return <div className="toast result-toast" key={result.challengeId}>
        <p className="section-label">🏁 CHALLENGE RESULTS</p>
        <strong>{result.status === 'void' ? 'A challenge was voided' : result.rank === null ? 'Your results are ready' : `You placed ${ordinal(result.rank)} of ${result.players}`}</strong>
        <span>{details.join(' · ')}</span>
        <div className="toast-actions">
          <button className="primary-button" onClick={() => { showResults(result.challengeId); onOpenResults() }}>See results</button>
          <button className="table-action secondary" onClick={() => markResultsSeen(result.challengeId)}>Dismiss</button>
        </div>
      </div>
    })}
    {invitations.map((invitation) => {
      const invitedCount = invitation.players.filter((player) => player.inviteStatus !== 'declined' && player.inviteStatus !== 'left').length
      return <div className="toast" key={invitation.id}>
        <p className="section-label">⚔ CHALLENGE INVITATION</p>
        <strong><PlayerName userId={invitation.creatorId} name={invitation.creatorName} /> challenges you</strong>
        <span>{formatTimeControl(invitation.timeControl)} · {sideLabel(invitation.sideChoice)} · depth {invitation.depth} · {invitedCount} players</span>
        {errors[invitation.id] && <p className="auth-message">{errors[invitation.id]}</p>}
        <div className="toast-actions">
          <button className="primary-button" disabled={busyId === invitation.id} onClick={() => void answer(invitation.id, true)}>Accept</button>
          <button className="table-action secondary" disabled={busyId === invitation.id} onClick={() => void answer(invitation.id, false)}>Decline</button>
        </div>
      </div>
    })}
  </div>
}
