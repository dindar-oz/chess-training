import type { BadgeId } from '../../shared/badges.ts'
import firstChallenge from '../assets/badge-first-challenge.svg'
import firstGame from '../assets/badge-first-game.svg'
import streak10 from '../assets/badge-streak-10.svg'
import streak3 from '../assets/badge-streak-3.svg'
import streak5 from '../assets/badge-streak-5.svg'

export const badgeImages: Record<BadgeId, string> = {
  'first-game': firstGame,
  'first-challenge': firstChallenge,
  'challenge-streak-3': streak3,
  'challenge-streak-5': streak5,
  'challenge-streak-10': streak10,
}
