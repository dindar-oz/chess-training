import { useState } from 'react'
import { formatTimeControl } from '../timeControl'
import { useChallenges } from './context'
import { sideLabel } from './types'

// Invitations float over every screen so nobody misses one while training.
export function InvitationToasts({ onAccepted }: { onAccepted: () => void }) {
  const { invitations, respond, notice, dismissNotice } = useChallenges()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  async function answer(challengeId: string, accept: boolean) {
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

  if (invitations.length === 0 && !notice) return null
  return <div className="toast-stack" aria-live="polite">
    {notice && <div className="toast notice-toast"><p>{notice}</p><button className="text-button" onClick={dismissNotice}>Dismiss</button></div>}
    {invitations.map((invitation) => {
      const invitedCount = invitation.players.filter((player) => player.inviteStatus !== 'declined' && player.inviteStatus !== 'left').length
      return <div className="toast" key={invitation.id}>
        <p className="section-label">⚔ CHALLENGE INVITATION</p>
        <strong>{invitation.creatorName} challenges you</strong>
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
