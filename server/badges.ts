import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DatabaseSync } from 'node:sqlite'
import { isBadgeId, longestStreak, streakBadgesFor } from '../shared/badges.ts'
import type { BadgeId } from '../shared/badges.ts'
import { readJson, RequestError, sendError, sendJson } from './http.ts'
import { sendToUser } from './realtime.ts'

let database: DatabaseSync

// Call after the users, training_sessions and challenge tables exist.
export function initBadges(dependencies: { database: DatabaseSync }) {
  database = dependencies.database
  database.exec(`
    CREATE TABLE IF NOT EXISTS user_badges (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      badge_id TEXT NOT NULL,
      earned_at TEXT NOT NULL,
      -- Set once the player has seen the celebration.
      seen_at TEXT,
      PRIMARY KEY (user_id, badge_id)
    )
  `)
  backfill()
}

// Grants badges for play that happened before badges were stored. The first-game
// badge was always shown, so it counts as seen; the others are new and will be
// celebrated once. INSERT OR IGNORE keeps this safe to run on every start.
function backfill() {
  database.prepare(`
    INSERT OR IGNORE INTO user_badges (user_id, badge_id, earned_at, seen_at)
    SELECT user_id, 'first-game', MIN(completed_at), MIN(completed_at) FROM training_sessions GROUP BY user_id
  `).run()
  database.prepare(`
    INSERT OR IGNORE INTO user_badges (user_id, badge_id, earned_at)
    SELECT challenge_players.user_id, 'first-challenge', MIN(challenges.completed_at)
    FROM challenge_players JOIN challenges ON challenges.id = challenge_players.challenge_id JOIN users ON users.id = challenge_players.user_id
    WHERE challenges.status = 'complete' AND challenge_players.moves_played > 0 AND challenge_players.play_status IS NOT 'resigned'
    GROUP BY challenge_players.user_id
  `).run()
  const moves = database.prepare(`
    SELECT challenge_players.user_id AS userId, challenge_moves.player_id AS playerId, challenge_moves.correct AS correct, challenge_moves.created_at AS createdAt
    FROM challenge_moves JOIN challenge_players ON challenge_players.id = challenge_moves.player_id JOIN users ON users.id = challenge_players.user_id
    ORDER BY challenge_moves.player_id, challenge_moves.ply
  `).all() as Array<{ userId: string; playerId: string; correct: number; createdAt: string }>
  const byPlayer = new Map<string, { userId: string; correct: boolean[]; lastAt: string }>()
  for (const move of moves) {
    const entry = byPlayer.get(move.playerId) ?? { userId: move.userId, correct: [], lastAt: move.createdAt }
    entry.correct.push(move.correct === 1)
    entry.lastAt = move.createdAt
    byPlayer.set(move.playerId, entry)
  }
  const insert = database.prepare('INSERT OR IGNORE INTO user_badges (user_id, badge_id, earned_at) VALUES (?, ?, ?)')
  for (const { userId, correct, lastAt } of byPlayer.values()) {
    for (const badgeId of streakBadgesFor(longestStreak(correct))) insert.run(userId, badgeId, lastAt)
  }
}

// Idempotent; tells the player's open pages when the badge is new.
export function awardBadge(userId: string, badgeId: BadgeId) {
  const earnedAt = new Date().toISOString()
  const inserted = database.prepare('INSERT OR IGNORE INTO user_badges (user_id, badge_id, earned_at) VALUES (?, ?, ?)').run(userId, badgeId, earnedAt)
  if (inserted.changes > 0) sendToUser(userId, 'badge_earned', { id: badgeId, earnedAt, seen: false })
}

function listBadges(userId: string) {
  return (database.prepare('SELECT badge_id AS id, earned_at AS earnedAt, seen_at AS seenAt FROM user_badges WHERE user_id = ? ORDER BY earned_at').all(userId) as Array<{ id: string; earnedAt: string; seenAt: string | null }>)
    .filter((badge) => isBadgeId(badge.id))
    .map(({ id, earnedAt, seenAt }) => ({ id, earnedAt, seen: seenAt !== null }))
}

// Handles /api/badges routes; returns false for other URLs.
export async function handleBadgeRequest(request: IncomingMessage, response: ServerResponse, user: { id: string } | null) {
  const url = request.url ?? ''
  if (url !== '/api/badges' && url !== '/api/badges/seen') return false
  if (!user) {
    sendJson(response, 401, { error: 'Authentication required.' })
    return true
  }
  try {
    if (request.method === 'GET' && url === '/api/badges') {
      sendJson(response, 200, listBadges(user.id))
      return true
    }
    if (request.method === 'POST' && url === '/api/badges/seen') {
      const body = await readJson(request)
      const ids = Array.isArray(body.ids) ? body.ids.filter(isBadgeId) : []
      const markSeen = database.prepare('UPDATE user_badges SET seen_at = ? WHERE user_id = ? AND badge_id = ? AND seen_at IS NULL')
      const now = new Date().toISOString()
      for (const id of ids) markSeen.run(now, user.id, id)
      sendJson(response, 200, { ok: true })
      return true
    }
    throw new RequestError(405, 'Method not allowed.')
  } catch (error) {
    sendError(response, error, 'Could not update badges.')
    return true
  }
}
