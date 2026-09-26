import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DatabaseSync } from 'node:sqlite'
import { Chess } from 'chess.js'
import type { Move } from 'chess.js'
import { accuracyFromCpl } from '../shared/accuracy.ts'
import { analysisGraceMs, correctionDelayMs, maxChatLength, maxDepth, maxInvitees, minDepth, preferredMinPlies, startCountdownMs } from '../shared/challengeRules.ts'
import { computeRatingChanges } from '../shared/elo.ts'
import { RequestError, allowRequest, readJson, sendError, sendJson } from './http.ts'
import { isOnline, sendToUser, updateOnlineUser } from './realtime.ts'

// Challenge lifecycle: lobby -> playing -> analyzing -> complete, with cancelled
// (from lobby) and void (analysis never delivered) as dead ends.
//
// The server keeps each player's Fischer clock and never sends the game's moves or
// identity to clients before the challenge completes: a player only ever receives
// the position they must move in, so the master's moves can't be read in advance.
// The creator's browser runs the engine analysis; the server turns the submitted
// centipawn losses into accuracies, rankings, ELO, XP and training stats.

type ChallengeUser = { id: string; username: string; elo: number }
type AwardXp = (userId: string, sessionId: string, correctMoves: number, deviations: number, attemptedMoves: number, completed: boolean) => unknown
type ChallengeStatus = 'lobby' | 'playing' | 'analyzing' | 'complete' | 'cancelled' | 'void'
type InviteStatus = 'creator' | 'invited' | 'accepted' | 'declined' | 'left' | 'expired'
type PlayStatus = 'playing' | 'finished' | 'timed_out' | 'resigned'
type Side = 'w' | 'b'

type ChallengeRow = {
  id: string
  creator_id: string | null
  creator_name: string
  side_choice: Side | 'random'
  side: Side | null
  base_seconds: number
  increment_seconds: number
  depth: number
  status: ChallengeStatus
  game_id: string | null
  game_title: string | null
  game_white: string | null
  game_black: string | null
  game_event: string | null
  game_date: string | null
  game_result: string | null
  game_pgn: string | null
  ply_count: number | null
  created_at: string
  starts_at: number | null
  finished_at: number | null
  completed_at: string | null
  chat_muted: number
}

type PlayerRow = {
  id: string
  challenge_id: string
  user_id: string | null
  username: string
  invite_status: InviteStatus
  play_status: PlayStatus | null
  remaining_ms: number | null
  clock_started_at: number | null
  next_ply: number | null
  finished_at: number | null
  moves_played: number
  correct_moves: number | null
  deviations: number | null
  accuracy: number | null
  original_accuracy: number | null
  average_cpl: number | null
  rank: number | null
  elo_before: number | null
  elo_after: number | null
  analysis_submitted_at: string | null
  current_elo: number | null
}

type MoveRow = {
  player_id: string
  ply: number
  correct: number
  // Centipawn losses of the player's move and of the master's move, from the
  // player's own analysis; null until submitted.
  cpl: number | null
  original_cpl: number | null
}

type ParsedGame = { moves: Move[] }

let database: DatabaseSync
let awardXp: AwardXp
const parsedGames = new Map<string, ParsedGame>()
const flagTimers = new Map<string, NodeJS.Timeout>()

const sweepIntervalMs = 30_000
const lobbyCreatorGraceMs = 60_000
const lobbyMaxAgeMs = 30 * 60 * 1000
const maxAnalysisBytes = 1024 * 1024

export function initChallenges(dependencies: { database: DatabaseSync; awardXp: AwardXp }) {
  database = dependencies.database
  awardXp = dependencies.awardXp
  database.exec(`
    CREATE TABLE IF NOT EXISTS challenges (
      id TEXT PRIMARY KEY,
      creator_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      creator_name TEXT NOT NULL,
      side_choice TEXT NOT NULL,
      side TEXT,
      base_seconds INTEGER NOT NULL,
      increment_seconds INTEGER NOT NULL,
      depth INTEGER NOT NULL,
      status TEXT NOT NULL,
      game_id TEXT,
      game_title TEXT,
      game_white TEXT,
      game_black TEXT,
      game_event TEXT,
      game_date TEXT,
      game_result TEXT,
      game_pgn TEXT,
      ply_count INTEGER,
      created_at TEXT NOT NULL,
      starts_at INTEGER,
      finished_at INTEGER,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS challenges_status ON challenges (status);
    CREATE TABLE IF NOT EXISTS challenge_players (
      id TEXT PRIMARY KEY,
      challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      username TEXT NOT NULL,
      invite_status TEXT NOT NULL,
      play_status TEXT,
      remaining_ms INTEGER,
      clock_started_at INTEGER,
      next_ply INTEGER,
      finished_at INTEGER,
      moves_played INTEGER NOT NULL DEFAULT 0,
      correct_moves INTEGER,
      deviations INTEGER,
      accuracy REAL,
      original_accuracy REAL,
      average_cpl REAL,
      rank INTEGER,
      elo_before INTEGER,
      elo_after INTEGER,
      UNIQUE (challenge_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS challenge_players_user ON challenge_players (user_id);
    CREATE TABLE IF NOT EXISTS challenge_moves (
      player_id TEXT NOT NULL REFERENCES challenge_players(id) ON DELETE CASCADE,
      challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
      ply INTEGER NOT NULL,
      fen_before TEXT NOT NULL,
      expected_uci TEXT NOT NULL,
      expected_san TEXT NOT NULL,
      attempted_uci TEXT NOT NULL,
      attempted_san TEXT NOT NULL,
      correct INTEGER NOT NULL,
      think_ms INTEGER NOT NULL,
      cpl REAL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (player_id, ply)
    );
    CREATE INDEX IF NOT EXISTS challenge_moves_challenge ON challenge_moves (challenge_id);
  `)
  // Clocks survive restarts because they are stored as remaining time plus the
  // moment the current think started; only the flag timers need rebuilding.
  for (const player of database.prepare("SELECT challenge_players.id FROM challenge_players JOIN challenges ON challenges.id = challenge_players.challenge_id WHERE challenges.status = 'playing' AND challenge_players.play_status = 'playing'").all() as Array<{ id: string }>) {
    scheduleFlag(player.id)
  }
  for (const migration of [
    'ALTER TABLE challenges ADD COLUMN chat_muted INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE challenge_players ADD COLUMN analysis_submitted_at TEXT',
    'ALTER TABLE challenge_moves ADD COLUMN original_cpl REAL',
  ]) {
    try {
      database.exec(migration)
    } catch {
      // Existing databases may already have the column.
    }
  }
  setInterval(sweep, sweepIntervalMs).unref()
}

// ---------- reads ----------

function getChallenge(id: string) {
  return database.prepare('SELECT * FROM challenges WHERE id = ?').get(id) as ChallengeRow | undefined
}

function getPlayers(challengeId: string) {
  return database.prepare('SELECT challenge_players.*, users.elo AS current_elo FROM challenge_players LEFT JOIN users ON users.id = challenge_players.user_id WHERE challenge_id = ? ORDER BY challenge_players.rowid').all(challengeId) as PlayerRow[]
}

function getPlayer(playerId: string) {
  return database.prepare('SELECT challenge_players.*, users.elo AS current_elo FROM challenge_players LEFT JOIN users ON users.id = challenge_players.user_id WHERE challenge_players.id = ?').get(playerId) as PlayerRow | undefined
}

function playerFor(challengeId: string, userId: string) {
  return getPlayers(challengeId).find((player) => player.user_id === userId)
}

function isParticipant(player: PlayerRow) {
  return player.invite_status === 'creator' || player.invite_status === 'accepted'
}

// The challenge a user is taking part in right now (lobby, playing, or awaiting analysis).
function currentChallengeId(userId: string) {
  const row = database.prepare(`
    SELECT challenges.id FROM challenges JOIN challenge_players ON challenge_players.challenge_id = challenges.id
    WHERE challenge_players.user_id = ? AND challenge_players.invite_status IN ('creator', 'accepted') AND challenges.status IN ('lobby', 'playing', 'analyzing')
    ORDER BY challenges.created_at DESC LIMIT 1
  `).get(userId) as { id: string } | undefined
  return row?.id ?? null
}

// Busy users can't create or join another challenge. A finished player waiting on
// analysis is free again, except the creator, whose browser runs that analysis.
function isBusy(userId: string) {
  const row = database.prepare(`
    SELECT 1 FROM challenges JOIN challenge_players ON challenge_players.challenge_id = challenges.id
    WHERE challenge_players.user_id = ? AND challenge_players.invite_status IN ('creator', 'accepted')
      AND (challenges.status IN ('lobby', 'playing') OR (challenges.status = 'analyzing' AND challenges.creator_id = ?))
    LIMIT 1
  `).get(userId, userId)
  return row !== undefined
}

function parsedGame(challenge: ChallengeRow): ParsedGame {
  const cached = parsedGames.get(challenge.id)
  if (cached) return cached
  const chess = new Chess()
  chess.loadPgn(challenge.game_pgn ?? '')
  const parsed = { moves: chess.history({ verbose: true }) }
  parsedGames.set(challenge.id, parsed)
  return parsed
}

function nextPlyFor(moves: Move[], side: Side, fromPly: number) {
  for (let ply = fromPly; ply < moves.length; ply += 1) {
    if (moves[ply].color === side) return ply
  }
  return null
}

function timeControlLabel(challenge: ChallengeRow) {
  return `${challenge.base_seconds / 60}+${challenge.increment_seconds}`
}

// ---------- snapshots (what each client is allowed to see) ----------

function clockView(player: PlayerRow, now: number) {
  if (player.play_status !== 'playing' || player.clock_started_at === null || player.remaining_ms === null) {
    return { remainingMs: player.remaining_ms, running: false, resumesInMs: 0 }
  }
  if (player.clock_started_at > now) return { remainingMs: player.remaining_ms, running: true, resumesInMs: player.clock_started_at - now }
  return { remainingMs: Math.max(0, player.remaining_ms - (now - player.clock_started_at)), running: true, resumesInMs: 0 }
}

function snapshot(challenge: ChallengeRow, forUserId: string) {
  const now = Date.now()
  const players = getPlayers(challenge.id)
  const me = players.find((player) => player.user_id === forUserId) ?? null
  const revealed = challenge.status === 'complete' || challenge.status === 'void'
  const game = challenge.game_pgn && challenge.side ? parsedGame(challenge) : null
  const totalMoves = game && challenge.side ? game.moves.filter((move) => move.color === challenge.side).length : null
  let position = null
  if (game && me?.play_status === 'playing' && me.next_ply !== null) {
    const move = game.moves[me.next_ply]
    position = { ply: me.next_ply, fen: move.before, moveNumber: Math.floor(me.next_ply / 2) + 1, previousSan: me.next_ply > 0 ? game.moves[me.next_ply - 1].san : null }
  }
  // A player's own moves include the position and UCI moves so their browser can
  // analyze them; nobody receives anyone else's moves.
  const myMoves = me
    ? (database.prepare('SELECT ply, fen_before AS fen, attempted_san AS attempted, expected_san AS expected, attempted_uci AS attemptedUci, expected_uci AS expectedUci, correct FROM challenge_moves WHERE player_id = ? ORDER BY ply').all(me.id) as Array<{ ply: number; fen: string; attempted: string; expected: string; attemptedUci: string; expectedUci: string; correct: number }>)
      .map((move) => ({ ...move, correct: move.correct === 1 }))
    : []
  return {
    id: challenge.id,
    // Lets clients drop a snapshot that arrives after a newer one (HTTP vs SSE races).
    generatedAt: now,
    status: challenge.status,
    creatorId: challenge.creator_id,
    creatorName: challenge.creator_name,
    sideChoice: challenge.side_choice,
    side: challenge.side,
    timeControl: { baseSeconds: challenge.base_seconds, incrementSeconds: challenge.increment_seconds },
    depth: challenge.depth,
    createdAt: challenge.created_at,
    chatMuted: challenge.chat_muted === 1,
    startsInMs: challenge.starts_at === null ? null : challenge.starts_at - now,
    totalMoves,
    game: revealed && challenge.game_id
      ? { id: challenge.game_id, title: challenge.game_title, white: challenge.game_white, black: challenge.game_black, event: challenge.game_event, date: challenge.game_date, result: challenge.game_result, plyCount: challenge.ply_count }
      : challenge.ply_count === null ? null : { plyCount: challenge.ply_count },
    // While analyzing: how long results still wait for missing analyses.
    analysisGraceInMs: challenge.status === 'analyzing' && challenge.finished_at !== null ? Math.max(0, challenge.finished_at + analysisGraceMs - now) : null,
    players: players
      .filter((player) => challenge.status === 'lobby' ? player.invite_status !== 'expired' : isParticipant(player))
      .map((player) => ({
        playerId: player.id,
        userId: player.user_id,
        username: player.user_id ? player.username : `${player.username} (deleted)`,
        elo: player.elo_before ?? player.current_elo,
        online: player.user_id ? isOnline(player.user_id) : false,
        inviteStatus: player.invite_status,
        playStatus: player.play_status,
        movesPlayed: player.moves_played,
        analysisReady: player.analysis_submitted_at !== null || player.moves_played === 0,
        clock: clockView(player, now),
        // Results stay hidden until everyone is ranked.
        result: challenge.status === 'complete'
          ? { accuracy: player.accuracy, originalAccuracy: player.original_accuracy, averageCpl: player.average_cpl, correctMoves: player.correct_moves, deviations: player.deviations, rank: player.rank, eloBefore: player.elo_before, eloAfter: player.elo_after }
          : null,
      })),
    me: me ? { playerId: me.id, inviteStatus: me.invite_status, playStatus: me.play_status, clock: clockView(me, now), position, moves: myMoves, analysisSubmitted: me.analysis_submitted_at !== null } : null,
  }
}

// Every change is pushed as a fresh per-user snapshot, including to pending invitees
// (whose clients show it as an invitation) and to anyone who just dropped out.
function publish(challengeId: string) {
  const challenge = getChallenge(challengeId)
  if (!challenge) return
  for (const player of getPlayers(challengeId)) {
    if (player.user_id) sendToUser(player.user_id, 'challenge_update', snapshot(challenge, player.user_id))
  }
}

// ---------- clocks ----------

function scheduleFlag(playerId: string) {
  clearTimeout(flagTimers.get(playerId))
  flagTimers.delete(playerId)
  const player = getPlayer(playerId)
  if (!player || player.play_status !== 'playing' || player.clock_started_at === null || player.remaining_ms === null) return
  const flagAt = player.clock_started_at + player.remaining_ms
  flagTimers.set(playerId, setTimeout(() => flagIfOverdue(playerId), Math.max(0, flagAt - Date.now()) + 5))
}

function flagIfOverdue(playerId: string) {
  flagTimers.delete(playerId)
  const player = getPlayer(playerId)
  if (!player || player.play_status !== 'playing') return
  const clock = clockView(player, Date.now())
  if ((clock.remainingMs ?? 0) > 0) {
    scheduleFlag(playerId)
    return
  }
  database.prepare("UPDATE challenge_players SET play_status = 'timed_out', remaining_ms = 0, clock_started_at = NULL, next_ply = NULL, finished_at = ? WHERE id = ?").run(Date.now(), playerId)
  finishIfAllDone(player.challenge_id)
  publish(player.challenge_id)
}

function stopPlayer(player: PlayerRow, playStatus: PlayStatus) {
  const clock = clockView(player, Date.now())
  database.prepare('UPDATE challenge_players SET play_status = ?, remaining_ms = ?, clock_started_at = NULL, next_ply = NULL, finished_at = ? WHERE id = ?')
    .run(playStatus, Math.max(0, clock.remainingMs ?? 0), Date.now(), player.id)
  clearTimeout(flagTimers.get(player.id))
  flagTimers.delete(player.id)
}

function finishIfAllDone(challengeId: string) {
  const challenge = getChallenge(challengeId)
  if (!challenge || challenge.status !== 'playing') return
  const players = getPlayers(challengeId).filter(isParticipant)
  if (players.some((player) => player.play_status === 'playing')) return
  database.prepare("UPDATE challenges SET status = 'analyzing', finished_at = ? WHERE id = ?").run(Date.now(), challengeId)
  // Players who finished early have usually submitted already.
  completeIfAnalyzed(challengeId, false)
}

// Completes once every player who made a move has submitted their analysis, or
// (with force, after the grace period) without the missing ones.
function completeIfAnalyzed(challengeId: string, force: boolean) {
  const challenge = getChallenge(challengeId)
  if (!challenge || challenge.status !== 'analyzing') return
  const waiting = getPlayers(challengeId).filter((player) => isParticipant(player) && player.user_id && player.moves_played > 0 && !player.analysis_submitted_at)
  if (waiting.length === 0 || force) completeChallenge(challengeId)
}

// ---------- state changes ----------

function setStatus(challengeId: string, status: ChallengeStatus) {
  database.prepare('UPDATE challenges SET status = ? WHERE id = ?').run(status, challengeId)
  if (status === 'cancelled' || status === 'void') {
    database.prepare("UPDATE challenge_players SET invite_status = 'expired' WHERE challenge_id = ? AND invite_status = 'invited'").run(challengeId)
    parsedGames.delete(challengeId)
  }
}

function withTransaction<T>(work: () => T): T {
  database.exec('BEGIN')
  try {
    const result = work()
    database.exec('COMMIT')
    return result
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

function createChallenge(user: ChallengeUser, body: Record<string, unknown>) {
  const sideChoice = body.side
  if (sideChoice !== 'w' && sideChoice !== 'b' && sideChoice !== 'random') throw new RequestError(400, 'Choose White, Black or Random.')
  const timeControl = body.timeControl as { baseSeconds?: unknown; incrementSeconds?: unknown } | undefined
  const baseSeconds = timeControl?.baseSeconds
  const incrementSeconds = timeControl?.incrementSeconds
  if (typeof baseSeconds !== 'number' || !Number.isInteger(baseSeconds) || baseSeconds < 60 || baseSeconds > 180 * 60 || baseSeconds % 60 !== 0) throw new RequestError(400, 'Base time must be 1-180 whole minutes.')
  if (typeof incrementSeconds !== 'number' || !Number.isInteger(incrementSeconds) || incrementSeconds < 0 || incrementSeconds > 60) throw new RequestError(400, 'Increment must be 0-60 seconds.')
  const depth = body.depth
  if (typeof depth !== 'number' || !Number.isInteger(depth) || depth < minDepth || depth > maxDepth) throw new RequestError(400, `Depth must be ${minDepth}-${maxDepth}.`)
  const inviteeIds = Array.isArray(body.inviteeIds) ? [...new Set(body.inviteeIds.filter((id): id is string => typeof id === 'string'))] : []
  if (inviteeIds.length === 0) throw new RequestError(400, 'Invite at least one player.')
  if (inviteeIds.length > maxInvitees) throw new RequestError(400, `You can invite at most ${maxInvitees} players.`)
  if (inviteeIds.includes(user.id)) throw new RequestError(400, 'You are already in your own challenge.')
  if (isBusy(user.id)) throw new RequestError(409, 'Finish or leave your current challenge first.')
  const { count } = database.prepare('SELECT COUNT(*) AS count FROM games WHERE ply_count >= 2').get() as { count: number }
  if (count === 0) throw new RequestError(409, 'The game library is empty. An admin needs to import games first.')

  const invitees = inviteeIds.map((id) => database.prepare('SELECT id, username FROM users WHERE id = ? AND disabled_at IS NULL').get(id) as { id: string; username: string } | undefined)
  if (invitees.some((invitee) => !invitee)) throw new RequestError(400, 'One of the invited players no longer exists.')
  const unavailable = invitees.filter((invitee) => !isOnline(invitee!.id) || isBusy(invitee!.id)).map((invitee) => invitee!.username)
  if (unavailable.length > 0) throw new RequestError(409, `Not available right now: ${unavailable.join(', ')}.`)

  const challengeId = randomUUID()
  withTransaction(() => {
    database.prepare("INSERT INTO challenges (id, creator_id, creator_name, side_choice, base_seconds, increment_seconds, depth, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'lobby', ?)")
      .run(challengeId, user.id, user.username, sideChoice, baseSeconds, incrementSeconds, depth, new Date().toISOString())
    const insertPlayer = database.prepare('INSERT INTO challenge_players (id, challenge_id, user_id, username, invite_status) VALUES (?, ?, ?, ?, ?)')
    insertPlayer.run(randomUUID(), challengeId, user.id, user.username, 'creator')
    for (const invitee of invitees) insertPlayer.run(randomUUID(), challengeId, invitee!.id, invitee!.username, 'invited')
  })
  publish(challengeId)
  return challengeId
}

function respond(challenge: ChallengeRow, user: ChallengeUser, accept: boolean) {
  const player = playerFor(challenge.id, user.id)
  if (challenge.status !== 'lobby' || player?.invite_status !== 'invited') throw new RequestError(409, 'This invitation is no longer open.')
  if (accept && isBusy(user.id)) throw new RequestError(409, 'Finish or leave your current challenge first.')
  database.prepare('UPDATE challenge_players SET invite_status = ? WHERE id = ?').run(accept ? 'accepted' : 'declined', player.id)
  publish(challenge.id)
}

function pickGame() {
  const columns = 'id, title, white, black, event, date, result, pgn, ply_count'
  return (database.prepare(`SELECT ${columns} FROM games WHERE ply_count >= ? ORDER BY RANDOM() LIMIT 1`).get(preferredMinPlies)
    ?? database.prepare(`SELECT ${columns} FROM games WHERE ply_count >= 2 ORDER BY RANDOM() LIMIT 1`).get()) as
    { id: string; title: string; white: string; black: string; event: string; date: string; result: string; pgn: string; ply_count: number } | undefined
}

function startChallenge(challenge: ChallengeRow, user: ChallengeUser) {
  if (challenge.creator_id !== user.id) throw new RequestError(403, 'Only the creator can start the challenge.')
  if (challenge.status !== 'lobby') throw new RequestError(409, 'The challenge has already started.')
  const players = getPlayers(challenge.id)
  if (!players.some((player) => player.invite_status === 'accepted')) throw new RequestError(409, 'Wait until at least one invited player accepts.')
  const game = pickGame()
  if (!game) throw new RequestError(409, 'The game library is empty. An admin needs to import games first.')
  const side: Side = challenge.side_choice === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : challenge.side_choice
  const chess = new Chess()
  chess.loadPgn(game.pgn)
  const moves = chess.history({ verbose: true })
  const firstPly = nextPlyFor(moves, side, 0)
  if (firstPly === null) throw new RequestError(409, 'The selected game has no moves for that side. Please try again.')
  const startsAt = Date.now() + startCountdownMs

  withTransaction(() => {
    database.prepare("UPDATE challenges SET status = 'playing', side = ?, game_id = ?, game_title = ?, game_white = ?, game_black = ?, game_event = ?, game_date = ?, game_result = ?, game_pgn = ?, ply_count = ?, starts_at = ? WHERE id = ?")
      .run(side, game.id, game.title, game.white, game.black, game.event, game.date, game.result, game.pgn, moves.length, startsAt, challenge.id)
    database.prepare("UPDATE challenge_players SET play_status = 'playing', remaining_ms = ?, clock_started_at = ?, next_ply = ? WHERE challenge_id = ? AND invite_status IN ('creator', 'accepted')")
      .run(challenge.base_seconds * 1000, startsAt, firstPly, challenge.id)
    database.prepare("UPDATE challenge_players SET invite_status = 'expired' WHERE challenge_id = ? AND invite_status = 'invited'").run(challenge.id)
  })
  parsedGames.set(challenge.id, { moves })
  for (const player of getPlayers(challenge.id)) if (player.play_status === 'playing') scheduleFlag(player.id)
  publish(challenge.id)
}

function playMove(challenge: ChallengeRow, user: ChallengeUser, body: Record<string, unknown>) {
  const now = Date.now()
  const player = playerFor(challenge.id, user.id)
  if (challenge.status !== 'playing' || player?.play_status !== 'playing' || player.next_ply === null || !challenge.side) throw new RequestError(409, 'You are not playing in this challenge.')
  if (challenge.starts_at !== null && now < challenge.starts_at) throw new RequestError(409, 'The challenge has not started yet.')
  if (body.ply !== player.next_ply) throw new RequestError(409, 'That position has already been played.')
  const uci = body.uci
  if (typeof uci !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) throw new RequestError(400, 'Invalid move.')

  const clock = clockView(player, now)
  if ((clock.remainingMs ?? 0) <= 0) {
    flagIfOverdue(player.id)
    throw new RequestError(409, "Time's up.")
  }
  const { moves } = parsedGame(challenge)
  const expected = moves[player.next_ply]
  let attempted: Move
  try {
    attempted = new Chess(expected.before).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
  } catch {
    throw new RequestError(400, 'Illegal move.')
  }
  const correct = attempted.lan === expected.lan
  const thinkMs = player.clock_started_at === null ? 0 : Math.max(0, now - player.clock_started_at)
  const nextPly = nextPlyFor(moves, challenge.side, player.next_ply + 1)
  const remainingMs = (clock.remainingMs ?? 0) + challenge.increment_seconds * 1000

  withTransaction(() => {
    database.prepare('INSERT INTO challenge_moves (player_id, challenge_id, ply, fen_before, expected_uci, expected_san, attempted_uci, attempted_san, correct, think_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(player.id, challenge.id, player.next_ply!, expected.before, expected.lan, expected.san, attempted.lan, attempted.san, correct ? 1 : 0, thinkMs, new Date(now).toISOString())
    if (nextPly === null) {
      database.prepare("UPDATE challenge_players SET play_status = 'finished', remaining_ms = ?, clock_started_at = NULL, next_ply = NULL, finished_at = ?, moves_played = moves_played + 1 WHERE id = ?").run(remainingMs, now, player.id)
    } else {
      // A deviation pauses the clock while the historical line is restored.
      database.prepare('UPDATE challenge_players SET remaining_ms = ?, clock_started_at = ?, next_ply = ?, moves_played = moves_played + 1 WHERE id = ?').run(remainingMs, now + (correct ? 0 : correctionDelayMs), nextPly, player.id)
    }
  })
  scheduleFlag(player.id)
  finishIfAllDone(challenge.id)
  publish(challenge.id)
  return { correct, attemptedSan: attempted.san, expectedSan: expected.san, expectedUci: expected.lan }
}

// Each player's browser analyzes their own moves (in the background while they
// play) and submits one centipawn loss per move for their move and for the
// master's move. Players are trusted; the server only checks the shape.
function submitOwnAnalysis(challenge: ChallengeRow, player: PlayerRow, body: Record<string, unknown>) {
  if (!isParticipant(player) || !player.play_status || player.play_status === 'playing') throw new RequestError(409, 'Finish playing before submitting your analysis.')
  if (challenge.status !== 'playing' && challenge.status !== 'analyzing') return
  if (player.analysis_submitted_at) return
  const results = Array.isArray(body.results) ? body.results as Array<Record<string, unknown>> : []
  const plies = (database.prepare('SELECT ply FROM challenge_moves WHERE player_id = ?').all(player.id) as Array<{ ply: number }>).map((row) => row.ply)
  const byPly = new Map<number, { cpl: number; originalCpl: number }>()
  const validCpl = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 200_000
  for (const result of results) {
    if (typeof result?.ply !== 'number' || !validCpl(result.cpl) || !validCpl(result.originalCpl)) throw new RequestError(400, 'Malformed analysis result.')
    byPly.set(result.ply, { cpl: result.cpl, originalCpl: result.originalCpl })
  }
  const missing = plies.filter((ply) => !byPly.has(ply)).length
  if (missing > 0) throw new RequestError(400, `The analysis is missing ${missing} of ${plies.length} moves.`)
  withTransaction(() => {
    const update = database.prepare('UPDATE challenge_moves SET cpl = ?, original_cpl = ? WHERE player_id = ? AND ply = ?')
    for (const ply of plies) update.run(byPly.get(ply)!.cpl, byPly.get(ply)!.originalCpl, player.id, ply)
    database.prepare('UPDATE challenge_players SET analysis_submitted_at = ? WHERE id = ?').run(new Date().toISOString(), player.id)
  })
  completeIfAnalyzed(challenge.id, false)
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

function completeChallenge(challengeId: string) {
  const challenge = getChallenge(challengeId)!
  const players = getPlayers(challengeId).filter(isParticipant)
  const moves = database.prepare('SELECT player_id, ply, correct, cpl, original_cpl FROM challenge_moves WHERE challenge_id = ?').all(challengeId) as MoveRow[]
  // A player who made moves but whose analysis never arrived has no accuracy.
  const forfeited = (player: PlayerRow) => player.moves_played > 0 && !player.analysis_submitted_at
  const stats = new Map(players.map((player) => {
    const playerMoves = moves.filter((move) => move.player_id === player.id)
    const analyzed = forfeited(player) ? [] : playerMoves
    const attemptedCpls = analyzed.map((move) => move.cpl ?? 0)
    const originalCpls = analyzed.map((move) => move.original_cpl ?? 0)
    const accuracy = average(attemptedCpls.map(accuracyFromCpl))
    const originalAccuracy = average(originalCpls.map(accuracyFromCpl))
    const averageCpl = average(attemptedCpls)
    const correctMoves = playerMoves.filter((move) => move.correct === 1).length
    return [player.id, {
      accuracy: accuracy === null ? null : Math.round(accuracy * 10) / 10,
      originalAccuracy: originalAccuracy === null ? null : Math.round(originalAccuracy),
      averageCpl: averageCpl === null ? null : Math.round(averageCpl),
      correctMoves,
      deviations: playerMoves.length - correctMoves,
    }]
  }))
  // Deleted users keep their row for the record but are left out of the rating pool,
  // and a challenge where nobody made a move is unrated.
  const rated = moves.length === 0 ? [] : players.filter((player) => player.user_id && player.current_elo !== null)
  const changes = new Map(computeRatingChanges(rated.map((player) => ({
    id: player.id,
    rating: player.current_elo!,
    finished: player.play_status === 'finished',
    accuracy: stats.get(player.id)!.accuracy,
    forfeited: forfeited(player),
  }))).map((change) => [change.id, change]))
  const completedAt = new Date().toISOString()

  withTransaction(() => {
    for (const player of players) {
      const stat = stats.get(player.id)!
      const change = changes.get(player.id)
      database.prepare('UPDATE challenge_players SET accuracy = ?, original_accuracy = ?, average_cpl = ?, correct_moves = ?, deviations = ?, rank = ?, elo_before = ?, elo_after = ? WHERE id = ?')
        .run(stat.accuracy, stat.originalAccuracy, stat.averageCpl, stat.correctMoves, stat.deviations, change?.rank ?? null, change?.before ?? null, change?.after ?? null, player.id)
      if (!player.user_id || !change) continue
      database.prepare('UPDATE users SET elo = ? WHERE id = ?').run(change.after, player.user_id)
      database.prepare('INSERT OR IGNORE INTO rating_events (id, user_id, challenge_id, rating_before, rating_after, delta, rank, players, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), player.user_id, challengeId, change.before, change.after, change.delta, change.rank, rated.length, completedAt)
      // Challenges also count as training: a stats row plus the usual XP.
      if (player.moves_played > 0) {
        const sessionId = `challenge-${challengeId}-${player.user_id}`
        const endReason = player.play_status === 'finished' ? 'completed' : player.play_status === 'resigned' ? 'resigned' : 'timeout'
        database.prepare('INSERT OR IGNORE INTO training_sessions (id, user_id, game_id, game_title, side, attempted_moves, correct_moves, deviations, learner_accuracy, original_accuracy, average_cpl, time_control, end_reason, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(sessionId, player.user_id, challenge.game_id, challenge.game_title, challenge.side, player.moves_played, stat.correctMoves, stat.deviations, stat.accuracy === null ? null : Math.round(stat.accuracy), stat.originalAccuracy, stat.averageCpl, timeControlLabel(challenge), endReason, completedAt)
        awardXp(player.user_id, sessionId, stat.correctMoves, stat.deviations, player.moves_played, endReason === 'completed')
      }
    }
    database.prepare("UPDATE challenges SET status = 'complete', completed_at = ? WHERE id = ?").run(completedAt, challengeId)
  })
  parsedGames.delete(challengeId)
  for (const [playerId, change] of changes) {
    const userId = players.find((player) => player.id === playerId)?.user_id
    if (userId) updateOnlineUser(userId, { elo: change.after })
  }
}

// Called before a user is disabled or deleted, so their challenges don't hang.
export function handleUserRemoved(userId: string) {
  const challengeId = currentChallengeId(userId)
  const invited = database.prepare("SELECT challenge_players.id, challenge_players.challenge_id FROM challenge_players JOIN challenges ON challenges.id = challenge_players.challenge_id WHERE challenge_players.user_id = ? AND challenge_players.invite_status = 'invited' AND challenges.status = 'lobby'").all(userId) as Array<{ id: string; challenge_id: string }>
  for (const invitation of invited) {
    database.prepare("UPDATE challenge_players SET invite_status = 'declined' WHERE id = ?").run(invitation.id)
    publish(invitation.challenge_id)
  }
  if (!challengeId) return
  const challenge = getChallenge(challengeId)!
  const player = playerFor(challengeId, userId)!
  if (challenge.status === 'lobby') {
    if (challenge.creator_id === userId) setStatus(challengeId, 'cancelled')
    else database.prepare("UPDATE challenge_players SET invite_status = 'left' WHERE id = ?").run(player.id)
  } else if (challenge.status === 'playing' && player.play_status === 'playing') {
    stopPlayer(player, 'resigned')
    finishIfAllDone(challengeId)
  }
  publish(challengeId)
}

function sweep() {
  const now = Date.now()
  for (const challenge of database.prepare("SELECT * FROM challenges WHERE status IN ('lobby', 'playing', 'analyzing')").all() as ChallengeRow[]) {
    if (challenge.status === 'lobby') {
      const age = now - Date.parse(challenge.created_at)
      const creatorGone = !challenge.creator_id || !isOnline(challenge.creator_id)
      if (age > lobbyMaxAgeMs || (creatorGone && age > lobbyCreatorGraceMs)) {
        setStatus(challenge.id, 'cancelled')
        publish(challenge.id)
      }
    } else if (challenge.status === 'playing') {
      // Safety net in case a flag timer was lost.
      for (const player of getPlayers(challenge.id)) {
        if (player.play_status === 'playing' && (clockView(player, now).remainingMs ?? 0) <= 0) flagIfOverdue(player.id)
      }
    } else if (challenge.finished_at !== null && now - challenge.finished_at > analysisGraceMs) {
      // Missing analyses are ranked last rather than holding everyone's results.
      completeIfAnalyzed(challenge.id, true)
      publish(challenge.id)
    }
  }
}

// ---------- chat ----------

// Chat messages are relayed live to the players and never stored: a player who
// reloads only sees messages sent after that. Players in the challenge (host and
// accepted) can chat from the waiting room through the results unless the host
// has muted the chat for everyone.
function relayChatMessage(challenge: ChallengeRow, player: PlayerRow, user: ChallengeUser, body: Record<string, unknown>) {
  if (!isParticipant(player)) throw new RequestError(403, 'Only players in this challenge can chat.')
  if (challenge.status === 'cancelled' || challenge.status === 'void') throw new RequestError(409, 'This challenge is closed.')
  if (challenge.chat_muted === 1) throw new RequestError(403, 'The host has muted the chat.')
  const text = typeof body.text === 'string' ? body.text.replace(/\s+/g, ' ').trim() : ''
  if (!text) throw new RequestError(400, 'Type a message first.')
  if (text.length > maxChatLength) throw new RequestError(400, `Messages are limited to ${maxChatLength} characters.`)
  if (!allowRequest(`chat:${user.id}`, 10, 10_000)) throw new RequestError(429, 'You are sending messages too quickly.')
  const message = { id: randomUUID(), challengeId: challenge.id, userId: user.id, username: user.username, text, createdAt: new Date().toISOString() }
  for (const participant of getPlayers(challenge.id)) {
    if (participant.user_id && isParticipant(participant)) sendToUser(participant.user_id, 'challenge_message', message)
  }
  return message
}

// ---------- routes ----------

function history(userId: string) {
  return database.prepare(`
    SELECT challenges.id, challenges.status, challenges.game_title AS gameTitle, challenges.completed_at AS completedAt, challenges.created_at AS createdAt,
      challenges.base_seconds AS baseSeconds, challenges.increment_seconds AS incrementSeconds,
      challenge_players.rank, challenge_players.elo_before AS eloBefore, challenge_players.elo_after AS eloAfter, challenge_players.accuracy,
      (SELECT COUNT(*) FROM challenge_players others WHERE others.challenge_id = challenges.id AND others.invite_status IN ('creator', 'accepted')) AS players
    FROM challenges JOIN challenge_players ON challenge_players.challenge_id = challenges.id
    WHERE challenge_players.user_id = ? AND challenge_players.invite_status IN ('creator', 'accepted') AND challenges.status IN ('complete', 'void')
    ORDER BY challenges.created_at DESC LIMIT 20
  `).all(userId)
}

// Handles every /api/challenges route; returns false for other URLs.
export async function handleChallengeRequest(request: IncomingMessage, response: ServerResponse, user: ChallengeUser | null) {
  const url = request.url ?? ''
  if (!url.startsWith('/api/challenges')) return false
  if (!user) {
    sendJson(response, 401, { error: 'Authentication required.' })
    return true
  }
  try {
    if (request.method === 'GET' && url === '/api/challenges/current') {
      const currentId = currentChallengeId(user.id)
      const current = currentId ? getChallenge(currentId) : undefined
      const invitations = database.prepare("SELECT challenges.* FROM challenges JOIN challenge_players ON challenge_players.challenge_id = challenges.id WHERE challenge_players.user_id = ? AND challenge_players.invite_status = 'invited' AND challenges.status = 'lobby' ORDER BY challenges.created_at").all(user.id) as ChallengeRow[]
      sendJson(response, 200, { current: current ? snapshot(current, user.id) : null, invitations: invitations.map((challenge) => snapshot(challenge, user.id)) })
      return true
    }
    if (request.method === 'GET' && url === '/api/challenges/history') {
      sendJson(response, 200, history(user.id))
      return true
    }
    if (request.method === 'POST' && url === '/api/challenges') {
      if (!allowRequest(`challenge:create:${user.id}`, 20, 60 * 60 * 1000)) throw new RequestError(429, 'Too many challenges created. Please try again later.')
      const challengeId = createChallenge(user, await readJson(request))
      sendJson(response, 200, snapshot(getChallenge(challengeId)!, user.id))
      return true
    }

    const match = url.match(/^\/api\/challenges\/([0-9a-f-]{36})(?:\/([a-z-]+))?$/)
    const challenge = match ? getChallenge(match[1]) : undefined
    if (!match || !challenge) throw new RequestError(404, 'Challenge not found.')
    const action = match[2]
    if (!playerFor(challenge.id, user.id)) throw new RequestError(404, 'Challenge not found.')

    if (request.method === 'GET' && !action) {
      sendJson(response, 200, snapshot(challenge, user.id))
      return true
    }
    if (request.method === 'POST' && action === 'messages') {
      sendJson(response, 200, relayChatMessage(challenge, playerFor(challenge.id, user.id)!, user, await readJson(request)))
      return true
    }
    if (request.method !== 'POST') throw new RequestError(405, 'Method not allowed.')

    if (action === 'respond') {
      const body = await readJson(request)
      respond(challenge, user, body.accept === true)
    } else if (action === 'start') {
      startChallenge(challenge, user)
    } else if (action === 'cancel') {
      if (challenge.creator_id !== user.id || challenge.status !== 'lobby') throw new RequestError(409, 'Only the creator can cancel a challenge before it starts.')
      setStatus(challenge.id, 'cancelled')
      publish(challenge.id)
    } else if (action === 'leave') {
      const player = playerFor(challenge.id, user.id)!
      if (challenge.status !== 'lobby' || player.invite_status !== 'accepted') throw new RequestError(409, 'You can only leave a challenge before it starts.')
      database.prepare("UPDATE challenge_players SET invite_status = 'left' WHERE id = ?").run(player.id)
      publish(challenge.id)
    } else if (action === 'moves') {
      const result = playMove(challenge, user, await readJson(request))
      sendJson(response, 200, { ...result, challenge: snapshot(getChallenge(challenge.id)!, user.id) })
      return true
    } else if (action === 'resign') {
      const player = playerFor(challenge.id, user.id)!
      if (challenge.status !== 'playing' || player.play_status !== 'playing') throw new RequestError(409, 'You are not playing in this challenge.')
      stopPlayer(player, 'resigned')
      finishIfAllDone(challenge.id)
      publish(challenge.id)
    } else if (action === 'chat-mute') {
      if (challenge.creator_id !== user.id) throw new RequestError(403, 'Only the host can mute the chat for everyone.')
      const body = await readJson(request)
      database.prepare('UPDATE challenges SET chat_muted = ? WHERE id = ?').run(body.muted === true ? 1 : 0, challenge.id)
      publish(challenge.id)
    } else if (action === 'analysis') {
      submitOwnAnalysis(challenge, playerFor(challenge.id, user.id)!, await readJson(request, maxAnalysisBytes))
      publish(challenge.id)
    } else {
      throw new RequestError(404, 'Not found.')
    }
    sendJson(response, 200, snapshot(getChallenge(challenge.id)!, user.id))
  } catch (error) {
    sendError(response, error, 'Challenge request failed.')
  }
  return true
}
