import { useEffect, useMemo } from 'react'
import type { CSSProperties } from 'react'
import { badgeDefinitions } from '../../shared/badges.ts'
import type { BadgeId } from '../../shared/badges.ts'
import { useChallenges } from '../challenges/context'
import { play } from '../sounds'
import { badgeImages } from './images'

const confettiColors = ['#d48a36', '#2c665d', '#b85b4e', '#f0c477', '#3d5a8a', '#18242a']
// While the player's clock is running the celebration is a small corner card that
// doesn't cover the board or take clicks, and it goes away by itself.
const compactDismissMs = 4500

type BadgeCelebrationProps = {
  badgeId: BadgeId
  // Further badges waiting to be celebrated after this one.
  remaining: number
  onDismiss: () => void
  onOpenAwards: () => void
}

// Confetti pieces flying out from the badge. Deterministic, so renders are pure.
function confettiPieces(count: number, reach: number) {
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2 + (index % 3) * 0.35
    const distance = reach * (0.55 + ((index * 37) % 45) / 100)
    return {
      '--x': `${Math.round(Math.cos(angle) * distance)}px`,
      '--y': `${Math.round(Math.sin(angle) * distance - reach * 0.2)}px`,
      '--r': `${(index * 83) % 540 - 270}deg`,
      '--delay': `${(index % 5) * 40}ms`,
      background: confettiColors[index % confettiColors.length],
    } as CSSProperties
  })
}

export function BadgeCelebration({ badgeId, remaining, onDismiss, onOpenAwards }: BadgeCelebrationProps) {
  const { current } = useChallenges()
  const compact = current?.snapshot.status === 'playing' && current.snapshot.me?.playStatus === 'playing'
  const badge = badgeDefinitions.find((definition) => definition.id === badgeId)!
  const confetti = useMemo(() => confettiPieces(compact ? 14 : 36, compact ? 70 : 230), [compact])

  useEffect(() => { play('badge') }, [])

  useEffect(() => {
    if (!compact) return
    const timer = window.setTimeout(onDismiss, compactDismissMs)
    return () => window.clearTimeout(timer)
  }, [compact, onDismiss])

  useEffect(() => {
    if (compact) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onDismiss() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [compact, onDismiss])

  const medal = <div className="celebration-medal">
    <div className="celebration-rays" aria-hidden="true" />
    <div className="celebration-confetti" aria-hidden="true">
      {confetti.map((style, index) => <i key={index} style={style} />)}
    </div>
    <img src={badgeImages[badgeId]} alt="" className="celebration-image" />
  </div>

  if (compact) {
    return <div className="badge-celebration compact" role="status" aria-live="polite">
      {medal}
      <div className="celebration-text">
        <p className="section-label">NEW BADGE</p>
        <strong>{badge.name}</strong>
        <span>{badge.description}</span>
      </div>
    </div>
  }

  return <div className="badge-celebration" role="dialog" aria-modal="true" aria-labelledby="celebration-title">
    <div className="celebration-backdrop" onClick={onDismiss} />
    <div className="celebration-card">
      {medal}
      <p className="section-label">NEW BADGE EARNED</p>
      <h2 id="celebration-title">{badge.name}</h2>
      <p className="celebration-description">{badge.description}</p>
      <div className="celebration-actions">
        <button className="primary-button" autoFocus onClick={onDismiss}>{remaining > 0 ? 'Next badge' : 'Awesome!'}</button>
        <button className="text-button" onClick={onOpenAwards}>See all badges</button>
      </div>
    </div>
  </div>
}
