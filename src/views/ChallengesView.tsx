import { useState } from 'react'
import { ChallengeHistory } from '../challenges/ChallengeHistory'
import { ChallengePlay } from '../challenges/ChallengePlay'
import { ChallengeResults } from '../challenges/ChallengeResults'
import { useChallenges } from '../challenges/context'
import { LobbyPanel } from '../challenges/LobbyPanel'
import { NewChallengePanel } from '../challenges/NewChallengePanel'
import type { ChallengeSnapshot } from '../challenges/types'
import { MainNav } from '../components/MainNav'
import { PageHeader } from '../components/PageHeader'
import { readApiResponse } from '../types'
import type { AppView, AuthUser } from '../types'

type ChallengesViewProps = {
  user: AuthUser
  onNavigate: (view: AppView) => void
  onLogout: () => void
  onTrainGame: (gameId: string) => void
}

export function ChallengesView({ user, onNavigate, onLogout, onTrainGame }: ChallengesViewProps) {
  const { current, analysisRun, retryAnalysis, dismiss } = useChallenges()
  const [viewing, setViewing] = useState<ChallengeSnapshot | null>(null)
  const [viewError, setViewError] = useState('')
  const snapshot = current?.snapshot ?? null

  async function openPast(challengeId: string) {
    setViewError('')
    const response = await fetch(`/api/challenges/${challengeId}`)
    const result = await readApiResponse<ChallengeSnapshot>(response)
    if (response.ok) setViewing(result)
    else setViewError(result.error ?? 'Could not load that challenge.')
  }

  let body
  if (snapshot?.status === 'playing' && current) body = <ChallengePlay received={current} userId={user.id} />
  else if (snapshot?.status === 'lobby') body = <LobbyPanel challenge={snapshot} userId={user.id} />
  else if (snapshot && (snapshot.status === 'analyzing' || snapshot.status === 'complete' || snapshot.status === 'void')) {
    body = <ChallengeResults challenge={snapshot} userId={user.id} analysisRun={analysisRun?.challengeId === snapshot.id ? analysisRun : null} onRetryAnalysis={retryAnalysis} onTrainGame={onTrainGame} onClose={dismiss} closeLabel="New challenge" />
  } else if (viewing) {
    body = <ChallengeResults challenge={viewing} userId={user.id} analysisRun={null} onRetryAnalysis={retryAnalysis} onTrainGame={onTrainGame} onClose={() => setViewing(null)} closeLabel="← Back to challenges" />
  } else {
    body = <>
      <NewChallengePanel user={user} />
      {viewError && <p className="admin-error">{viewError}</p>}
      <ChallengeHistory refreshKey={`${user.elo}`} onOpen={(id) => void openPast(id)} />
    </>
  }

  return <main className="app-shell challenges-screen">
    <PageHeader eyebrow="REPLAY LAB / CHALLENGES" title={<>Play them<br /><em>all at once.</em></>} user={user} onLogout={onLogout} />
    <MainNav view="challenges" isAdmin={user.role === 'admin'} onNavigate={onNavigate} />
    {body}
  </main>
}
