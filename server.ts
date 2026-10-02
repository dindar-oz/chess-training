import { createServer } from 'node:http'
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { extname, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Chess } from 'chess.js'
import initStockfish from 'stockfish'
import { initialRating } from './shared/elo.ts'
import { awardBadge, handleBadgeRequest, initBadges } from './server/badges.ts'
import { disconnectSession, disconnectUser, openEventStream, sendToUser, setAppBuild, startHeartbeat } from './server/realtime.ts'
import { RequestError, allowRequest, readJson, sendJson } from './server/http.ts'
import { handleChallengeRequest, handleUserRemoved, initChallenges } from './server/challenges.ts'
import { importJob, startImport } from './server/pgnImport.ts'

type Engine = {
  listener?: (line: string) => void
  sendCommand: (command: string) => void
}

type AnalyzeRequest = {
  fen?: string
  moveUci?: string
  depth?: number
}

type EngineScore = {
  cp: number | null
  mate: number | null
}

const port = Number(process.env.PORT ?? 8787)
const maxDepth = 30
const maxPendingAnalyses = 4
const completionXp = 10
const matchedMoveXp = 1
const perfectSessionXp = 5
const dataDirectory = process.env.DATA_DIR ?? 'data'
const publicDirectory = resolve(process.cwd(), 'dist')
// Written by the Vite build; absent when the client is served by the dev server.
try {
  setAppBuild((JSON.parse(readFileSync(resolve(publicDirectory, 'version.json'), 'utf8')) as { build?: string }).build ?? null)
} catch {
  setAppBuild(null)
}
mkdirSync(dataDirectory, { recursive: true })
const database = new DatabaseSync(resolve(dataDirectory, 'chess-training.sqlite'))
database.exec(`
  CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    white TEXT NOT NULL,
    black TEXT NOT NULL,
    event TEXT NOT NULL,
    date TEXT NOT NULL,
    result TEXT NOT NULL,
    ply_count INTEGER NOT NULL,
    pgn TEXT NOT NULL,
    fingerprint TEXT NOT NULL UNIQUE,
    imported_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    xp INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS training_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_id TEXT NOT NULL,
    game_title TEXT NOT NULL,
    side TEXT NOT NULL,
    attempted_moves INTEGER NOT NULL,
    correct_moves INTEGER NOT NULL,
    deviations INTEGER NOT NULL,
    learner_accuracy REAL,
    original_accuracy REAL,
    average_cpl REAL,
    completed_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS xp_events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL UNIQUE,
    amount INTEGER NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS xp_events_user_created_at ON xp_events (user_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS rating_events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    challenge_id TEXT NOT NULL,
    rating_before INTEGER NOT NULL,
    rating_after INTEGER NOT NULL,
    delta INTEGER NOT NULL,
    rank INTEGER NOT NULL,
    players INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (user_id, challenge_id)
  );
  CREATE INDEX IF NOT EXISTS rating_events_user_created_at ON rating_events (user_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS password_reset_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    requested_at TEXT NOT NULL,
    resolved_at TEXT
  );
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_by TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
  )
`)
try {
  database.exec('ALTER TABLE games ADD COLUMN fingerprint TEXT')
  database.exec('CREATE UNIQUE INDEX IF NOT EXISTS games_fingerprint_unique ON games (fingerprint)')
} catch {
  // Existing databases already have the fingerprint column or index.
}
try {
  database.exec('ALTER TABLE users ADD COLUMN xp INTEGER NOT NULL DEFAULT 0')
} catch {
  // New databases already include XP; existing databases may already be migrated.
}
try {
  database.exec('ALTER TABLE training_sessions ADD COLUMN time_control TEXT')
} catch {
  // Existing databases may already have the time_control column.
}
try {
  database.exec("ALTER TABLE training_sessions ADD COLUMN end_reason TEXT NOT NULL DEFAULT 'completed'")
} catch {
  // Existing databases may already have the end_reason column.
}
try {
  // A training session's moves for the analysis page, as JSON (see parseTrainingReview).
  database.exec('ALTER TABLE training_sessions ADD COLUMN review TEXT')
} catch {
  // Existing databases may already have the review column.
}
try {
  database.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'")
} catch {
  // Existing databases may already have the role column.
}
try {
  database.exec('ALTER TABLE users ADD COLUMN disabled_at TEXT')
} catch {
  // Existing databases may already have the disabled_at column.
}
try {
  database.exec(`ALTER TABLE users ADD COLUMN elo INTEGER NOT NULL DEFAULT ${initialRating}`)
} catch {
  // Existing databases may already have the elo column.
}
// Promotion happens only at startup, never at registration, so the account must be
// registered before its name is added here; otherwise anyone could claim the name.
const adminUsernames = new Set((process.env.ADMIN_USERNAMES ?? '').split(',').map((name) => name.trim().toLowerCase()).filter(Boolean))
for (const username of adminUsernames) {
  const promoted = database.prepare("UPDATE users SET role = 'admin' WHERE username = ?").run(username)
  if (promoted.changes === 0) console.error(`ADMIN_USERNAMES: no registered user named "${username}".`)
}
const enginePromise = initStockfish('lite-single') as Promise<Engine>
let requestQueue: Promise<unknown> = Promise.resolve()
let pendingAnalyses = 0

type Role = 'user' | 'admin'
type User = { id: string; username: string; xp: number; elo: number; role: Role }

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

const resetLinkTtlMs = 24 * 60 * 60 * 1000
const minPasswordLength = 8

// Returns the user a reset token belongs to, if the token is unused and unexpired.
function userForResetToken(token: unknown) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return null
  return database.prepare(`
    SELECT users.id, users.username, users.disabled_at AS disabledAt FROM password_reset_tokens
    JOIN users ON users.id = password_reset_tokens.user_id
    WHERE password_reset_tokens.token_hash = ? AND password_reset_tokens.used_at IS NULL AND password_reset_tokens.expires_at > ?
  `).get(hashToken(token), new Date().toISOString()) as { id: string; username: string; disabledAt: string | null } | undefined ?? null
}

function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, 64).toString('hex')
}

function parseCookies(request: import('node:http').IncomingMessage) {
  return Object.fromEntries((request.headers.cookie ?? '').split(';').filter(Boolean).map((part) => {
    const [key, ...value] = part.trim().split('=')
    return [key, decodeURIComponent(value.join('='))]
  }))
}

function userForTokenHash(tokenHash: string): User | null {
  const row = database.prepare('SELECT users.id, users.username, users.xp, users.elo, users.role FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.disabled_at IS NULL').get(tokenHash, new Date().toISOString()) as User | undefined
  return row ?? null
}

function currentUser(request: import('node:http').IncomingMessage): User | null {
  const token = parseCookies(request).session
  return token ? userForTokenHash(hashToken(token)) : null
}

// Sends the 401/403 itself, so callers only need to return when this yields null.
function requireAdmin(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) {
  const user = currentUser(request)
  if (!user) {
    sendJson(response, 401, { error: 'Authentication required.' })
    return null
  }
  if (user.role !== 'admin') {
    sendJson(response, 403, { error: 'Administrator access required.' })
    return null
  }
  return user
}

function isLockedAdmin(username: string) {
  return adminUsernames.has(username.toLowerCase())
}

// A training session's moves can make its stats submission larger than other requests.
const maxStatsBytes = 512 * 1024
const reviewMarks = new Set(['?', '??', '!'])

// The moves of a training session for the analysis page, checked field by field
// and stored as JSON: the review depth, and per move the position before it,
// your move and the master's (SAN and UCI), whether they matched, and its mark.
// Null when missing or malformed, so the session is saved without them.
function parseTrainingReview(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const { depth, moves } = value as { depth?: unknown; moves?: unknown }
  if (typeof depth !== 'number' || !Number.isInteger(depth) || depth < 1 || depth > 40 || !Array.isArray(moves) || moves.length === 0 || moves.length > 500) return null
  const text = (field: unknown, maxLength: number) => typeof field === 'string' && field.length > 0 && field.length <= maxLength
  const uci = (field: unknown) => typeof field === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(field)
  const clean = []
  for (const move of moves as Array<Record<string, unknown>>) {
    if (!move || typeof move !== 'object' || !Number.isInteger(move.ply) || !text(move.fen, 100) || !text(move.attempted, 10) || !text(move.expected, 10)
      || !uci(move.attemptedUci) || !uci(move.expectedUci) || typeof move.correct !== 'boolean') return null
    const mark = typeof move.mark === 'string' && reviewMarks.has(move.mark) ? move.mark : null
    clean.push({ ply: move.ply, fen: move.fen, attempted: move.attempted, expected: move.expected, attemptedUci: move.attemptedUci, expectedUci: move.expectedUci, correct: move.correct, mark })
  }
  return JSON.stringify({ depth, moves: clean })
}

// Idempotent per session_id so a retried /api/stats submission cannot double-award XP.
// A session that ran out of time earns only its matched moves, not the completion or perfect bonuses.
function awardXp(userId: string, sessionId: string, correctMoves: number, deviations: number, attemptedMoves: number, completed: boolean) {
  const xpGained = correctMoves * matchedMoveXp + (completed ? completionXp + (attemptedMoves > 0 && deviations === 0 ? perfectSessionXp : 0) : 0)
  const inserted = database.prepare('INSERT OR IGNORE INTO xp_events (id, user_id, session_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), userId, sessionId, xpGained, 'training_session', new Date().toISOString())
  if (inserted.changes === 0) {
    const existing = database.prepare('SELECT xp FROM users WHERE id = ?').get(userId) as { xp: number }
    return { xpGained: 0, totalXp: existing.xp }
  }
  database.prepare('UPDATE users SET xp = xp + ? WHERE id = ?').run(xpGained, userId)
  const updated = database.prepare('SELECT xp FROM users WHERE id = ?').get(userId) as { xp: number }
  return { xpGained, totalXp: updated.xp }
}

function setSessionCookie(response: import('node:http').ServerResponse, token: string) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  response.setHeader('Set-Cookie', `session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure}`)
}

function clearSessionCookie(response: import('node:http').ServerResponse) {
  response.setHeader('Set-Cookie', 'session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0')
}

function clientAddress(request: import('node:http').IncomingMessage) {
  const forwarded = request.headers['x-forwarded-for']
  if (typeof forwarded === 'string') return forwarded.split(',', 1)[0].trim()
  return request.socket.remoteAddress ?? 'unknown'
}

function gameMetadata(row: Record<string, unknown>) {
  return { id: row.id, title: row.title, white: row.white, black: row.black, event: row.event, date: row.date, result: row.result, plyCount: row.ply_count }
}

function parseScore(line: string): EngineScore | null {
  const score = line.match(/score (cp|mate) (-?\d+)/)
  if (!score) return null
  return score[1] === 'cp'
    ? { cp: Number(score[2]), mate: null }
    : { cp: null, mate: Number(score[2]) }
}

async function analyze(fen: string, depth: number, moveUci?: string) {
  const engine = await enginePromise
  return new Promise<EngineScore>((resolve, reject) => {
    let latestScore: EngineScore | null = null
    const timeout = setTimeout(() => {
      engine.listener = undefined
      reject(new Error('Stockfish backend analysis timed out.'))
    }, 120_000)

    engine.listener = (line) => {
      const score = parseScore(line)
      if (score) latestScore = score
      if (line.startsWith('bestmove')) {
        clearTimeout(timeout)
        engine.listener = undefined
        if (latestScore) resolve(latestScore)
        else reject(new Error('Stockfish returned no score.'))
      }
    }

    engine.sendCommand(`position fen ${fen}`)
    engine.sendCommand(`go depth ${depth}${moveUci ? ` searchmoves ${moveUci}` : ''}`)
  })
}

function queuedAnalyze(fen: string, depth: number, moveUci?: string) {
  if (pendingAnalyses >= maxPendingAnalyses) throw new RequestError(429, 'The analysis queue is full. Please try again shortly.')
  pendingAnalyses += 1
  const task = requestQueue.then(() => analyze(fen, depth, moveUci))
  requestQueue = task.catch(() => undefined)
  return task.finally(() => { pendingAnalyses -= 1 })
}

function validAnalysisRequest(body: AnalyzeRequest): body is AnalyzeRequest & { fen: string; depth: number } {
  if (typeof body.fen !== 'string' || body.fen.length > 100 || /[\r\n]/.test(body.fen)) return false
  if (typeof body.depth !== 'number' || !Number.isInteger(body.depth) || body.depth < 12 || body.depth > maxDepth) return false
  if (body.moveUci !== undefined && (typeof body.moveUci !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(body.moveUci))) return false
  try {
    new Chess(body.fen)
    return true
  } catch {
    return false
  }
}

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
}

function serveApp(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
  const requested = resolve(publicDirectory, `.${pathname === '/' ? '/index.html' : pathname}`)
  const file = requested.startsWith(`${publicDirectory}${sep}`) && existsSync(requested) && statSync(requested).isFile()
    ? requested
    : resolve(publicDirectory, 'index.html')

  if (!existsSync(file)) {
    response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('Application build not found.')
    return
  }

  response.writeHead(200, { 'Content-Type': contentTypes[extname(file)] ?? 'application/octet-stream' })
  if (request.method === 'HEAD') response.end()
  else createReadStream(file).pipe(response)
}

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
    })
    response.end()
    return
  }

  if (request.method === 'GET' && request.url === '/api/auth/me') {
    sendJson(response, 200, { user: currentUser(request) })
    return
  }

  if (request.method === 'POST' && (request.url === '/api/auth/register' || request.url === '/api/auth/login')) {
    try {
      const action = request.url.endsWith('/register') ? 'register' : 'login'
      const limit = action === 'register' ? 5 : 20
      const windowMs = action === 'register' ? 60 * 60 * 1000 : 15 * 60 * 1000
      if (!allowRequest(`auth:${action}:${clientAddress(request)}`, limit, windowMs)) {
        sendJson(response, 429, { error: 'Too many authentication attempts. Please try again later.' })
        return
      }
      const body = await readJson(request)
      const username = typeof body.username === 'string' ? body.username.trim() : ''
      const password = typeof body.password === 'string' ? body.password : ''
      if (!/^[a-zA-Z0-9_-]{3,32}$/.test(username)) throw new Error('Username must be 3-32 letters, numbers, underscores, or hyphens.')
      if (password.length < 8) throw new Error('Password must be at least 8 characters.')

      let user: User
      if (request.url.endsWith('/register')) {
        const existing = database.prepare('SELECT id FROM users WHERE username = ?').get(username)
        if (existing) throw new Error('That username is already registered.')
        const id = randomUUID()
        const salt = randomBytes(16).toString('hex')
        database.prepare('INSERT INTO users (id, username, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)').run(id, username, hashPassword(password, salt), salt, new Date().toISOString())
        user = { id, username, xp: 0, elo: initialRating, role: 'user' }
      } else {
        const record = database.prepare('SELECT id, username, password_hash, password_salt, xp, elo, role, disabled_at FROM users WHERE username = ?').get(username) as (User & { password_hash: string; password_salt: string; disabled_at: string | null }) | undefined
        if (!record) throw new Error('Invalid username or password.')
        const actual = Buffer.from(hashPassword(password, record.password_salt), 'hex')
        const expected = Buffer.from(record.password_hash, 'hex')
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('Invalid username or password.')
        if (record.disabled_at) throw new RequestError(403, 'This account has been disabled.')
        user = { id: record.id, username: record.username, xp: record.xp, elo: record.elo, role: record.role }
      }

      const token = randomBytes(32).toString('hex')
      database.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(hashToken(token), user.id, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString())
      setSessionCookie(response, token)
      sendJson(response, 200, { user })
    } catch (error) {
      sendJson(response, error instanceof RequestError ? error.status : 400, { error: error instanceof Error ? error.message : 'Authentication failed.' })
    }
    return
  }

  // Password resets are approved by an admin: a user asks here, an admin creates a
  // one-time link (valid 24 h) and passes it on, and the user sets a new password
  // with it. Responses never reveal whether a username exists.
  if (request.method === 'POST' && request.url === '/api/auth/forgot') {
    try {
      if (!allowRequest(`auth:forgot:${clientAddress(request)}`, 5, 60 * 60 * 1000)) throw new RequestError(429, 'Too many reset requests. Please try again later.')
      const body = await readJson(request)
      const username = typeof body.username === 'string' ? body.username.trim() : ''
      const user = username ? database.prepare('SELECT id, username FROM users WHERE username = ? AND disabled_at IS NULL').get(username) as { id: string; username: string } | undefined : undefined
      const pending = user ? database.prepare('SELECT 1 FROM password_reset_requests WHERE user_id = ? AND resolved_at IS NULL').get(user.id) : undefined
      if (user && !pending) {
        database.prepare('INSERT INTO password_reset_requests (id, user_id, requested_at) VALUES (?, ?, ?)').run(randomUUID(), user.id, new Date().toISOString())
        const admins = database.prepare("SELECT id FROM users WHERE role = 'admin' AND disabled_at IS NULL").all() as Array<{ id: string }>
        for (const admin of admins) sendToUser(admin.id, 'password_reset_request', { username: user.username })
      }
      sendJson(response, 200, { ok: true })
    } catch (error) {
      sendJson(response, error instanceof RequestError ? error.status : 400, { error: error instanceof Error ? error.message : 'The request failed.' })
    }
    return
  }

  if (request.method === 'POST' && (request.url === '/api/auth/reset/check' || request.url === '/api/auth/reset')) {
    try {
      if (!allowRequest(`auth:reset:${clientAddress(request)}`, 30, 15 * 60 * 1000)) throw new RequestError(429, 'Too many attempts. Please try again later.')
      const body = await readJson(request)
      const user = userForResetToken(body.token)
      if (!user) throw new RequestError(400, 'This reset link is invalid, already used, or expired. Ask an admin for a new one.')
      if (user.disabledAt) throw new RequestError(403, 'This account has been disabled.')
      if (request.url === '/api/auth/reset/check') {
        sendJson(response, 200, { username: user.username })
        return
      }
      const password = typeof body.password === 'string' ? body.password : ''
      if (password.length < minPasswordLength) throw new RequestError(400, `Password must be at least ${minPasswordLength} characters.`)
      const salt = randomBytes(16).toString('hex')
      const now = new Date().toISOString()
      database.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?').run(hashPassword(password, salt), salt, user.id)
      database.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE token_hash = ?').run(now, hashToken(body.token as string))
      database.prepare('UPDATE password_reset_requests SET resolved_at = ? WHERE user_id = ? AND resolved_at IS NULL').run(now, user.id)
      // Sign out everywhere: whoever had the old password loses access.
      database.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id)
      disconnectUser(user.id)
      sendJson(response, 200, { ok: true, username: user.username })
    } catch (error) {
      sendJson(response, error instanceof RequestError ? error.status : 400, { error: error instanceof Error ? error.message : 'The password reset failed.' })
    }
    return
  }

  if (request.method === 'POST' && request.url === '/api/auth/logout') {
    const token = parseCookies(request).session
    if (token) {
      database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token))
      disconnectSession(hashToken(token))
    }
    clearSessionCookie(response)
    sendJson(response, 200, { ok: true })
    return
  }

  if (request.method === 'GET' && request.url === '/api/events') {
    const token = parseCookies(request).session
    const user = token ? userForTokenHash(hashToken(token)) : null
    if (!token || !user) {
      sendJson(response, 401, { error: 'Authentication required.' })
      return
    }
    openEventStream(request, response, { id: user.id, username: user.username, elo: user.elo }, hashToken(token))
    return
  }

  if (request.method === 'GET' && request.url === '/api/stats') {
    const user = currentUser(request)
    if (!user) {
      sendJson(response, 401, { error: 'Authentication required.' })
      return
    }
    // hasReview: the moves were saved, so the analysis page can open the session;
    // a challenge's row reads them from the challenge.
    const rows = database.prepare("SELECT id, game_id AS gameId, game_title AS gameTitle, side, attempted_moves AS attemptedMoves, correct_moves AS correctMoves, deviations, learner_accuracy AS learnerAccuracy, original_accuracy AS originalAccuracy, average_cpl AS averageCpl, time_control AS timeControl, end_reason AS endReason, completed_at AS completedAt, review IS NOT NULL OR id LIKE 'challenge-%' AS hasReview FROM training_sessions WHERE user_id = ? ORDER BY completed_at DESC").all(user.id) as Array<Record<string, unknown>>
    sendJson(response, 200, rows.map((row) => ({ ...row, hasReview: row.hasReview === 1 })))
    return
  }

  const reviewMatch = request.method === 'GET' ? request.url?.match(/^\/api\/stats\/([^/]+)\/review$/) : null
  if (reviewMatch) {
    const user = currentUser(request)
    if (!user) {
      sendJson(response, 401, { error: 'Authentication required.' })
      return
    }
    const row = database.prepare('SELECT game_title AS gameTitle, side, completed_at AS completedAt, time_control AS timeControl, learner_accuracy AS learnerAccuracy, review FROM training_sessions WHERE id = ? AND user_id = ?').get(decodeURIComponent(reviewMatch[1]), user.id) as { review: string | null } | undefined
    if (!row?.review) {
      sendJson(response, 404, { error: 'The moves of this session were not saved.' })
      return
    }
    const { review, ...session } = row
    sendJson(response, 200, { ...session, ...JSON.parse(review) })
    return
  }

  if (request.method === 'GET' && request.url === '/api/ratings') {
    const user = currentUser(request)
    if (!user) {
      sendJson(response, 401, { error: 'Authentication required.' })
      return
    }
    const rows = database.prepare('SELECT id, challenge_id AS challengeId, rating_before AS ratingBefore, rating_after AS ratingAfter, delta, rank, players, created_at AS createdAt FROM rating_events WHERE user_id = ? ORDER BY created_at DESC').all(user.id)
    sendJson(response, 200, rows)
    return
  }

  if (request.method === 'GET' && request.url === '/api/leaderboard') {
    const user = currentUser(request)
    if (!user) {
      sendJson(response, 401, { error: 'Authentication required.' })
      return
    }
    const rows = database.prepare(`
      SELECT users.username AS username, users.xp AS xp, users.elo AS elo,
        (SELECT COUNT(*) FROM rating_events WHERE rating_events.user_id = users.id) AS ratedGames,
        AVG(training_sessions.learner_accuracy) AS averageAccuracy
      FROM users
      LEFT JOIN training_sessions
        ON training_sessions.user_id = users.id AND training_sessions.learner_accuracy IS NOT NULL
      WHERE users.disabled_at IS NULL
      GROUP BY users.id
      ORDER BY users.xp DESC, username COLLATE NOCASE ASC
    `).all()
    sendJson(response, 200, rows)
    return
  }

  if (request.method === 'POST' && request.url === '/api/stats') {
    const user = currentUser(request)
    if (!user) {
      sendJson(response, 401, { error: 'Authentication required.' })
      return
    }
    try {
      const body = await readJson(request, maxStatsBytes)
      const sessionId = String(body.id)
      const correctMoves = Number(body.correctMoves) || 0
      const deviations = Number(body.deviations) || 0
      const attemptedMoves = Number(body.attemptedMoves) || 0
      const timeControl = typeof body.timeControl === 'string' && /^\d{1,3}\+\d{1,2}$/.test(body.timeControl) ? body.timeControl : null
      const endReason = body.endReason === 'timeout' ? 'timeout' : 'completed'
      database.prepare('INSERT OR REPLACE INTO training_sessions (id, user_id, game_id, game_title, side, attempted_moves, correct_moves, deviations, learner_accuracy, original_accuracy, average_cpl, time_control, end_reason, completed_at, review) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(sessionId, user.id, String(body.gameId), String(body.gameTitle), String(body.side), attemptedMoves, correctMoves, deviations, (body.learnerAccuracy as number | null) ?? null, (body.originalAccuracy as number | null) ?? null, (body.averageCpl as number | null) ?? null, timeControl, endReason, String(body.completedAt), parseTrainingReview(body.review))
      const { xpGained, totalXp } = awardXp(user.id, sessionId, correctMoves, deviations, attemptedMoves, endReason === 'completed')
      awardBadge(user.id, 'first-game')
      sendJson(response, 200, { ok: true, xpGained, totalXp })
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : 'Could not save statistics.' })
    }
    return
  }

  if (request.method === 'GET' && request.url === '/api/games') {
    const rows = database.prepare('SELECT id, title, white, black, event, date, result, ply_count FROM games ORDER BY imported_at DESC').all() as Record<string, unknown>[]
    sendJson(response, 200, rows.map(gameMetadata))
    return
  }

  const gameMatch = request.url?.match(/^\/api\/games\/([^/]+)$/)
  if (request.method === 'GET' && gameMatch) {
    const row = database.prepare('SELECT id, title, white, black, event, date, result, ply_count, pgn FROM games WHERE id = ?').get(gameMatch[1]) as Record<string, unknown> | undefined
    if (!row) {
      sendJson(response, 404, { error: 'Game not found.' })
      return
    }
    sendJson(response, 200, { ...gameMetadata(row), pgn: row.pgn })
    return
  }

  if (request.method === 'DELETE' && gameMatch) {
    if (!requireAdmin(request, response)) return
    // Training history keeps its own game_title copy, so past sessions stay readable.
    const deleted = database.prepare('DELETE FROM games WHERE id = ?').run(gameMatch[1])
    if (deleted.changes === 0) sendJson(response, 404, { error: 'Game not found.' })
    else sendJson(response, 200, { ok: true })
    return
  }

  if (request.method === 'GET' && request.url === '/api/admin/users') {
    if (!requireAdmin(request, response)) return
    const rows = database.prepare(`
      SELECT users.id, users.username, users.role, users.xp, users.elo, users.created_at AS createdAt, users.disabled_at AS disabledAt,
        COUNT(training_sessions.id) AS sessions, MAX(training_sessions.completed_at) AS lastTrainedAt
      FROM users
      LEFT JOIN training_sessions ON training_sessions.user_id = users.id
      GROUP BY users.id
      ORDER BY users.created_at ASC
    `).all() as Array<{ username: string }>
    sendJson(response, 200, rows.map((row) => ({ ...row, locked: isLockedAdmin(row.username) })))
    return
  }

  if (request.method === 'GET' && request.url === '/api/admin/password-resets') {
    if (!requireAdmin(request, response)) return
    const rows = database.prepare(`
      SELECT password_reset_requests.id, users.id AS userId, users.username, password_reset_requests.requested_at AS requestedAt
      FROM password_reset_requests JOIN users ON users.id = password_reset_requests.user_id
      WHERE password_reset_requests.resolved_at IS NULL
      ORDER BY password_reset_requests.requested_at
    `).all()
    sendJson(response, 200, rows)
    return
  }

  const resetDismissMatch = request.url?.match(/^\/api\/admin\/password-resets\/([0-9a-f-]{36})\/dismiss$/)
  if (request.method === 'POST' && resetDismissMatch) {
    if (!requireAdmin(request, response)) return
    database.prepare('UPDATE password_reset_requests SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL').run(new Date().toISOString(), resetDismissMatch[1])
    sendJson(response, 200, { ok: true })
    return
  }

  const adminUserMatch = request.url?.match(/^\/api\/admin\/users\/([^/]+)(?:\/(disable|enable|role|reset-link))?$/)
  if (adminUserMatch && (request.method === 'POST' || request.method === 'DELETE')) {
    const admin = requireAdmin(request, response)
    if (!admin) return
    try {
      const [, targetId, action] = adminUserMatch
      if ((request.method === 'DELETE') !== (action === undefined)) throw new RequestError(405, 'Method not allowed.')
      const target = database.prepare('SELECT id, username FROM users WHERE id = ?').get(targetId) as { id: string; username: string } | undefined
      if (!target) throw new RequestError(404, 'User not found.')
      // The acting admin is always active and untouchable here, so at least one admin always remains.
      if (target.id === admin.id) throw new RequestError(400, 'You cannot change your own account.')
      if (isLockedAdmin(target.username)) throw new RequestError(400, `${target.username} is an admin set by ADMIN_USERNAMES and cannot be changed here.`)

      if (action === 'reset-link') {
        const disabled = database.prepare('SELECT disabled_at FROM users WHERE id = ?').get(target.id) as { disabled_at: string | null }
        if (disabled.disabled_at) throw new RequestError(409, 'Enable the account before resetting its password.')
        // Only the newest link works; the token itself is returned once and stored hashed.
        const token = randomBytes(32).toString('hex')
        const now = new Date()
        const expiresAt = new Date(now.getTime() + resetLinkTtlMs).toISOString()
        database.prepare('DELETE FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL').run(target.id)
        database.prepare('INSERT INTO password_reset_tokens (token_hash, user_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').run(hashToken(token), target.id, admin.id, now.toISOString(), expiresAt)
        database.prepare('UPDATE password_reset_requests SET resolved_at = ? WHERE user_id = ? AND resolved_at IS NULL').run(now.toISOString(), target.id)
        sendJson(response, 200, { token, username: target.username, expiresAt })
        return
      }
      if (request.method === 'DELETE') {
        // Sessions, training history and XP events cascade via foreign keys.
        handleUserRemoved(target.id)
        database.prepare('DELETE FROM users WHERE id = ?').run(target.id)
        disconnectUser(target.id)
      } else if (action === 'disable') {
        handleUserRemoved(target.id)
        database.prepare('UPDATE users SET disabled_at = ? WHERE id = ? AND disabled_at IS NULL').run(new Date().toISOString(), target.id)
        database.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id)
        disconnectUser(target.id)
      } else if (action === 'enable') {
        database.prepare('UPDATE users SET disabled_at = NULL WHERE id = ?').run(target.id)
      } else {
        const body = await readJson(request)
        if (body.role !== 'user' && body.role !== 'admin') throw new RequestError(400, 'Role must be "user" or "admin".')
        database.prepare('UPDATE users SET role = ? WHERE id = ?').run(body.role, target.id)
      }
      sendJson(response, 200, { ok: true })
    } catch (error) {
      sendJson(response, error instanceof RequestError ? error.status : 400, { error: error instanceof Error ? error.message : 'User update failed.' })
    }
    return
  }

  if (request.method === 'POST' && request.url === '/api/games/import') {
    const user = requireAdmin(request, response)
    if (!user) return
    if (!allowRequest(`import:${user.id}`, 6, 60 * 60 * 1000)) {
      sendJson(response, 429, { error: 'Too many imports. Please try again later.' })
      return
    }
    try {
      sendJson(response, 202, await startImport(database, request, user.id))
    } catch (error) {
      sendJson(response, error instanceof RequestError ? error.status : 400, { error: error instanceof Error ? error.message : 'PGN import failed.' })
    }
    return
  }

  const importJobMatch = request.url?.match(/^\/api\/games\/import\/([0-9a-f-]{36})$/)
  if (request.method === 'GET' && importJobMatch) {
    if (!requireAdmin(request, response)) return
    const job = importJob(importJobMatch[1])
    if (job) sendJson(response, 200, job)
    else sendJson(response, 404, { error: 'Import not found.' })
    return
  }

  if (request.method === 'POST' && request.url === '/api/analyze') {
    const user = currentUser(request)
    if (!user) {
      sendJson(response, 401, { error: 'Authentication required.' })
      return
    }
    if (!allowRequest(`analyze:${user.id}`, 120, 10 * 60 * 1000)) {
      sendJson(response, 429, { error: 'Too many analysis requests. Please try again later.' })
      return
    }
    try {
      const body = await readJson(request) as AnalyzeRequest
      if (!validAnalysisRequest(body)) {
        sendJson(response, 400, { error: `fen and depth (12-${maxDepth}) are required.` })
        return
      }

      const score = await queuedAnalyze(body.fen, body.depth, body.moveUci)
      sendJson(response, 200, score)
    } catch (error) {
      sendJson(response, error instanceof RequestError ? error.status : 500, { error: error instanceof Error ? error.message : 'Engine analysis failed.' })
    }
    return
  }

  if (request.url?.startsWith('/api/badges') && await handleBadgeRequest(request, response, currentUser(request))) return

  if (request.url?.startsWith('/api/challenges')) {
    await handleChallengeRequest(request, response, currentUser(request))
    return
  }

  if (request.url?.startsWith('/api/')) {
    sendJson(response, 404, { error: 'Not found.' })
    return
  }

  if (request.method === 'GET' || request.method === 'HEAD') {
    serveApp(request, response)
  } else {
    response.writeHead(405, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ error: 'Method not allowed.' }))
  }
})

initChallenges({ database, awardXp })
initBadges({ database })
startHeartbeat((tokenHash) => userForTokenHash(tokenHash) !== null)

server.listen(port, '0.0.0.0', () => {
  console.error(`Chess Training listening on port ${port}`)
})
