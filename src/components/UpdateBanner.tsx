import { useEffect } from 'react'
import { useChallenges } from '../challenges/context'
import { useRealtime } from '../realtime/context'
import type { AppView } from '../types'

const safeViews: AppView[] = ['home', 'library', 'stats', 'awards', 'leaderboard', 'challenges']
const activeChallengeStatuses = ['lobby', 'playing', 'analyzing']

type UpdateBannerProps = {
  view: AppView
  // A training session was opened since the page loaded (it may still be running).
  trainingOpened: boolean
}

// After a deploy, this page is running old code. It reloads by itself when that
// can't interrupt anything; otherwise it asks, and never mid-game.
export function UpdateBanner({ view, trainingOpened }: UpdateBannerProps) {
  const { updateAvailable } = useRealtime()
  const { current } = useChallenges()
  const challengeActive = current !== null && activeChallengeStatuses.includes(current.snapshot.status)
  const safeToReload = updateAvailable && safeViews.includes(view) && !trainingOpened && !challengeActive

  useEffect(() => {
    if (safeToReload) window.location.reload()
  }, [safeToReload])

  if (!updateAvailable) return null
  return <div className="update-banner" role="status">
    <span>A new version of Replay Lab is available.{challengeActive || trainingOpened ? ' Reload when your current game is finished.' : ''}</span>
    <button onClick={() => window.location.reload()}>Reload</button>
  </div>
}
