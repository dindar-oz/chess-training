import { createContext, useContext } from 'react'
import { isChessTitle } from '../../shared/titles.ts'
import type { ChessTitle } from '../../shared/titles.ts'

// Titles of titled members by user id; everyone else is absent.
export const TitlesContext = createContext<Record<string, string>>({})

export function useTitle(userId: string | null | undefined): ChessTitle | null {
  const title = useContext(TitlesContext)[userId ?? '']
  return isChessTitle(title) ? title : null
}
