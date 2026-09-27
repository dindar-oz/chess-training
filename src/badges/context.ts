import { createContext, useContext } from 'react'
import type { BadgeId } from '../../shared/badges.ts'

export type EarnedBadge = { id: BadgeId; earnedAt: string; seen: boolean }

export type BadgeState = {
  earned: EarnedBadge[]
  loaded: boolean
}

export const BadgeContext = createContext<BadgeState>({ earned: [], loaded: false })

export function useBadges() {
  return useContext(BadgeContext)
}
