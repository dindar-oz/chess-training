export type Side = 'w' | 'b'
export type AppView = 'library' | 'training' | 'stats' | 'awards' | 'leaderboard' | 'admin'
export type Role = 'user' | 'admin'
export type AuthUser = { id: string; username: string; xp: number; role: Role }
export type GameFilter = 'all' | 'decisive' | 'draw'

export type GameRecord = {
  id: string
  title: string
  white: string
  black: string
  event: string
  date: string
  result: string
  pgn: string
  plyCount: number
}

export type SessionStat = {
  id: string
  gameId: string
  gameTitle: string
  side: Side
  attemptedMoves: number
  correctMoves: number
  deviations: number
  learnerAccuracy: number | null
  originalAccuracy: number | null
  averageCpl: number | null
  completedAt: string
}

export type LeaderboardEntry = {
  username: string
  xp: number
  averageAccuracy: number | null
}

export type AdminUser = {
  id: string
  username: string
  role: Role
  xp: number
  createdAt: string
  disabledAt: string | null
  sessions: number
  lastTrainedAt: string | null
  locked: boolean
}

// Parses an API response, tolerating empty or non-JSON bodies (cold starts, proxies).
export async function readApiResponse<T>(response: Response): Promise<T & { error?: string }> {
  try {
    return await response.json() as T & { error?: string }
  } catch {
    return {} as T & { error?: string }
  }
}
