import { useEffect, useState } from 'react'
import { ChallengeHistory } from '../challenges/ChallengeHistory'
import { ChallengePlay } from '../challenges/ChallengePlay'
import { ChallengeResults } from '../challenges/ChallengeResults'
import { useChallenges } from '../challenges/context'
import { LobbyPanel } from '../challenges/LobbyPanel'
import { NewChallengeDialog } from '../challenges/NewChallengeDialog'
import type { NewChallengeKind } from '../challenges/NewChallengeDialog'
import { OpenChallengeList } from '../challenges/OpenChallengeList'
import type { ChallengeSnapshot } from '../challenges/types'
import { MainNav } from '../components/MainNav'
import { PageHeader } from '../components/PageHeader'
import { useRealtimeEvent } from '../realtime/context'
import { readApiResponse } from '../types'
import type { ReviewSource } from '../review/steps'
import type { AppView, AuthUser } from '../types'

type ChallengesViewProps = {
  user: AuthUser
  onNavigate: (view: AppView) => void
  onLogout: () => void
  onTrainGame: (gameId: string) => void
  onAnalyze: (source: ReviewSource) => void
}

export function ChallengesView({ user, onNavigate, onLogout, onTrainGame, onAnalyze }: ChallengesViewProps) {
  const analyzeChallenge = (challengeId: string) => onAnalyze({ kind: 'challenge', challengeId })
  const { current, dismiss, stepAway, requestedResults, clearRequestedResults, results } = useChallenges()
  const [viewing, setViewing] = useState<ChallengeSnapshot | null>(null)
  const [viewError, setViewError] = useState('')
  const [creating, setCreating] = useState<NewChallengeKind | null>(null)
  const snapshot = current?.snapshot ?? null

  async function openPast(challengeId: string) {
    const response = await fetch(`/api/challenges/${challengeId}`)
    const result = await readApiResponse<ChallengeSnapshot>(response)
    setViewError('')
    if (response.ok) setViewing(result)
    else setViewError(result.error ?? 'Could not load that challenge.')
  }

  // Results asked for from a notice open here.
  useEffect(() => {
    if (requestedResults) void openPast(requestedResults).finally(clearRequestedResults)
  }, [clearRequestedResults, requestedResults])

  // A challenge you left and are looking at again stays live until its results.
  useRealtimeEvent('challenge_update', (data) => {
    const update = data as ChallengeSnapshot
    setViewing((previous) => previous?.id === update.id && previous.generatedAt < update.generatedAt ? update : previous)
  })

  // Results you opened (from the list or a notice) show above everything but a
  // game you are still playing.
  let body
  if (snapshot?.status === 'playing' && current && (snapshot.me?.playStatus === 'playing' || !viewing)) body = <ChallengePlay received={current} userId={user.id} />
  else if (viewing) {
    body = <ChallengeResults challenge={viewing} userId={user.id} onTrainGame={onTrainGame} onAnalyze={analyzeChallenge} onClose={() => setViewing(null)} closeLabel="← Back to challenges" showChat={false} />
  } else if (snapshot?.status === 'lobby') {
    // Joining another open challenge from here leaves this one (a host's is cancelled).
    body = <>
      <LobbyPanel challenge={snapshot} userId={user.id} />
      <section className="history-section waiting-lobby">
        <h2 className="centered-title">Lobby</h2>
        <OpenChallengeList userId={user.id} />
      </section>
    </>
  }
  else if (snapshot && (snapshot.status === 'analyzing' || snapshot.status === 'complete' || snapshot.status === 'void')) {
    body = <ChallengeResults challenge={snapshot} userId={user.id} onTrainGame={onTrainGame} onAnalyze={analyzeChallenge} onClose={dismiss} closeLabel="New challenge" showChat onStepAway={() => void stepAway()} />
  } else {
    body = <>
      <section className="challenge-lobby">
        <div className="challenge-lobby-list">
          <h2 className="centered-title">Lobby</h2>
          <OpenChallengeList userId={user.id} />
        </div>
        <aside className="challenge-lobby-actions">
          <p className="section-label">NEW CHALLENGE</p>
          <button className="primary-button" onClick={() => setCreating('invite')}><span className="button-icon" aria-hidden="true">⚔</span> Challenge by invitation</button>
          <button className="primary-button" onClick={() => setCreating('open')}><span className="button-icon" aria-hidden="true">⚑</span> Open challenge</button>
          <p>Everyone plays the same side of a game picked at random from the library, with the same clock. The game stays hidden until every player has finished.</p>
          <p>The server's engine scores every player's moves the same way while you play. Once you've finished you can leave; you'll be notified when the results arrive. Players are ranked by accuracy, and ratings are updated.</p>
        </aside>
      </section>
      {creating && <NewChallengeDialog user={user} kind={creating} onClose={() => setCreating(null)} />}
      {viewError && <p className="admin-error">{viewError}</p>}
      <ChallengeHistory refreshKey={`${user.elo}|${snapshot?.id ?? ''}|${results.length}`} onOpen={(id) => void openPast(id)} onAnalyze={analyzeChallenge} />
    </>
  }

  return <main className="app-shell challenges-screen">
    <PageHeader eyebrow="REPLAY LAB / CHALLENGES" user={user} onLogout={onLogout} />
    <MainNav view="challenges" isAdmin={user.role === 'admin'} onNavigate={onNavigate} />
    {body}
  </main>
}
