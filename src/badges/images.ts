import type { BadgeId } from '../../shared/badges.ts'
import beatMaster from '../assets/badge-beat-master.svg'
import beatMaster3 from '../assets/badge-beat-master-3.svg'
import streak10 from '../assets/badge-challenge-streak-10.svg'
import streak3 from '../assets/badge-challenge-streak-3.svg'
import streak5 from '../assets/badge-challenge-streak-5.svg'
import firstChallenge from '../assets/badge-first-challenge.svg'
import firstGame from '../assets/badge-first-game.svg'
import noBlunders from '../assets/badge-no-blunders.svg'
import noMistakes from '../assets/badge-no-mistakes.svg'
import onlyMoves3 from '../assets/badge-only-moves-3.svg'
import outplayMaster from '../assets/badge-outplay-master.svg'

// Each image is src/assets/badge-<id>.svg and shows the badge's XP.
export const badgeImages: Record<BadgeId, string> = {
  'first-game': firstGame,
  'first-challenge': firstChallenge,
  'challenge-streak-3': streak3,
  'challenge-streak-5': streak5,
  'challenge-streak-10': streak10,
  'beat-master': beatMaster,
  'beat-master-3': beatMaster3,
  'outplay-master': outplayMaster,
  'no-blunders': noBlunders,
  'no-mistakes': noMistakes,
  'only-moves-3': onlyMoves3,
}
