// FIDE titles an admin can give a member; shown before their name across the site.
export const chessTitles = {
  GM: 'Grandmaster',
  IM: 'International Master',
  FM: 'FIDE Master',
  CM: 'Candidate Master',
  WGM: 'Woman Grandmaster',
  WIM: 'Woman International Master',
  WFM: 'Woman FIDE Master',
  WCM: 'Woman Candidate Master',
} as const

export type ChessTitle = keyof typeof chessTitles

export function isChessTitle(value: unknown): value is ChessTitle {
  return typeof value === 'string' && Object.hasOwn(chessTitles, value)
}

// Limits for an ELO set by an admin.
export const minAdminElo = 100
export const maxAdminElo = 3500
