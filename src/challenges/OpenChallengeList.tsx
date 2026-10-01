import { useCallback, useEffect, useState } from 'react'
import { useRealtime, useRealtimeEvent } from '../realtime/context'
import { formatTimeControl } from '../timeControl'
import { readApiResponse } from '../types'
import { useChallenges } from './context'
import { confirmLeavingWaitingRoom, sideLabel } from './types'
import type { OpenChallenge } from './types'

// The lobby: open challenges anyone can join until their seats are taken. The
// server pushes the whole list whenever one of them changes.
export function OpenChallengeList({ userId }: { userId: string }) {
  const { current, join } = useChallenges()
  const { connected } = useRealtime()
  const [challenges, setChallenges] = useState<OpenChallenge[] | null>(null)
  const [joiningId, setJoiningId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const currentId = current?.snapshot.id ?? null

  const load = useCallback(async () => {
    const response = await fetch('/api/challenges/open')
    const result = await readApiResponse<OpenChallenge[]>(response)
    if (response.ok) setChallenges(result as OpenChallenge[])
  }, [])

  // Reload on every (re)connect: updates sent while disconnected are lost.
  useEffect(() => {
    if (connected) void load()
  }, [connected, load])

  useRealtimeEvent('open_challenges', (data) => setChallenges(data as OpenChallenge[]))

  async function take(challengeId: string) {
    if (!confirmLeavingWaitingRoom(current?.snapshot, userId)) return
    setJoiningId(challengeId)
    setError('')
    try {
      await join(challengeId)
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : 'Could not join the challenge.')
    } finally {
      setJoiningId(null)
    }
  }

  const listed = (challenges ?? []).filter((challenge) => challenge.id !== currentId)
  return <div className="open-challenges">
    {error && <p className="admin-error">{error}</p>}
    {challenges === null ? <p className="empty-log">Loading open challenges...</p>
      : listed.length === 0 ? <div className="empty-library">No open challenges right now. Open one and others can join.</div>
      : <div className="open-challenge-list">{listed.map((challenge) => {
        const full = challenge.players >= challenge.maxPlayers
        const mine = challenge.creatorId === userId
        return <div key={challenge.id} className={`open-challenge ${full ? 'full' : ''}`}>
          <div className="open-challenge-host"><strong>{challenge.creatorName}</strong><span>{challenge.creatorElo ?? '—'} ELO</span></div>
          <span>{formatTimeControl(challenge.timeControl)}</span>
          <span>{sideLabel(challenge.sideChoice)}</span>
          <span>Depth {challenge.depth}</span>
          <span className="open-challenge-seats" title="Seats taken, host included">{challenge.players}/{challenge.maxPlayers}</span>
          {mine ? <b>Yours</b>
            : <button className="table-action" disabled={full || joiningId !== null} onClick={() => void take(challenge.id)}>{full ? 'Full' : joiningId === challenge.id ? 'Joining...' : 'Join'}</button>}
        </div>
      })}</div>}
  </div>
}
