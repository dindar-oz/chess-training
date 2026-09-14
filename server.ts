import { createServer } from 'node:http'
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { extname, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Chess } from 'chess.js'
import initStockfish from 'stockfish'

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
const maxJsonBytes = 64 * 1024
const maxPgnBytes = 2 * 1024 * 1024
const maxGamesPerImport = 100
const maxPendingAnalyses = 4
const dataDirectory = process.env.DATA_DIR ?? 'data'
const publicDirectory = resolve(process.cwd(), 'dist')
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
  )
`)
try {
  database.exec('ALTER TABLE games ADD COLUMN fingerprint TEXT')
  database.exec('CREATE UNIQUE INDEX IF NOT EXISTS games_fingerprint_unique ON games (fingerprint)')
} catch {
  // Existing databases already have the fingerprint column or index.
}
const enginePromise = initStockfish('lite-single') as Promise<Engine>
let requestQueue: Promise<unknown> = Promise.resolve()
let pendingAnalyses = 0
const rateLimits = new Map<string, { count: number; resetAt: number }>()

type User = { id: string; username: string }

class RequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
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

function currentUser(request: import('node:http').IncomingMessage): User | null {
  const token = parseCookies(request).session
  if (!token) return null
  const row = database.prepare('SELECT users.id, users.username FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?').get(hashToken(token), new Date().toISOString()) as User | undefined
  return row ?? null
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

function allowRequest(key: string, limit: number, windowMs: number) {
  const now = Date.now()
  const current = rateLimits.get(key)
  if (!current || current.resetAt <= now) {
    rateLimits.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (current.count >= limit) return false
  current.count += 1
  return true
}

async function readJson(request: import('node:http').IncomingMessage, maxBytes = maxJsonBytes) {
  let rawBody = ''
  let byteCount = 0
  for await (const chunk of request) {
    byteCount += Buffer.byteLength(chunk)
    if (byteCount > maxBytes) throw new RequestError(413, 'Request body is too large.')
    rawBody += chunk
  }
  return JSON.parse(rawBody) as Record<string, unknown>
}

function pgnHeader(pgn: string, name: string, fallback: string) {
  return pgn.match(new RegExp(`^\\[${name} "([^"]*)"\\]`, 'm'))?.[1] ?? fallback
}

function savePgn(pgn: string) {
  const chess = new Chess()
  chess.loadPgn(pgn)
  const white = pgnHeader(pgn, 'White', 'Unknown White')
  const black = pgnHeader(pgn, 'Black', 'Unknown Black')
  const event = pgnHeader(pgn, 'Event', 'Imported game')
  const date = pgnHeader(pgn, 'Date', 'Unknown date')
  const result = pgnHeader(pgn, 'Result', '*')
  const moves = chess.history({ verbose: true }).map((move) => move.lan()).join(' ')
  const fingerprint = createHash('sha256').update(`${white}|${black}|${event}|${date}|${result}|${moves}`).digest('hex')
  const record = {
    id: randomUUID(),
    title: `${white} vs ${black}`,
    white,
    black,
    event,
    date,
    result,
    ply_count: chess.history().length,
    pgn,
    fingerprint,
    imported_at: new Date().toISOString(),
  }
  const existing = database.prepare('SELECT id, title, white, black, event, date, result, ply_count, pgn FROM games WHERE fingerprint = ?').get(fingerprint) as Record<string, unknown> | undefined
  if (existing) return { ...existing, duplicate: true }
  database.prepare('INSERT INTO games (id, title, white, black, event, date, result, ply_count, pgn, fingerprint, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(record.id, record.title, record.white, record.black, record.event, record.date, record.result, record.ply_count, record.pgn, record.fingerprint, record.imported_at)
  return record
}

function gameMetadata(row: Record<string, unknown>) {
  return { id: row.id, title: row.title, white: row.white, black: row.black, event: row.event, date: row.date, result: row.result, plyCount: row.ply_count }
}

async function importPgnStream(request: import('node:http').IncomingMessage) {
  const decoder = new TextDecoder()
  let textBuffer = ''
  let currentGame = ''
  let byteCount = 0
  const imported: ReturnType<typeof savePgn>[] = []
  const flush = () => {
    const pgn = currentGame.trim()
    if (!pgn) return
    if (imported.length >= maxGamesPerImport) throw new RequestError(413, `A single import can contain at most ${maxGamesPerImport} games.`)
    imported.push(savePgn(pgn))
    currentGame = ''
  }

  for await (const chunk of request) {
    byteCount += Buffer.byteLength(chunk)
    if (byteCount > maxPgnBytes) throw new RequestError(413, 'PGN uploads are limited to 2 MB.')
    textBuffer += decoder.decode(chunk as Buffer, { stream: true })
    const lines = textBuffer.split(/\r?\n/)
    textBuffer = lines.pop() ?? ''
    for (const line of lines) {
      if (/^\[Event\s+".*"\]\s*$/.test(line) && currentGame.trim()) flush()
      currentGame += `${line}\n`
    }
  }
  textBuffer += decoder.decode()
  if (textBuffer) currentGame += textBuffer
  flush()
  return imported
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

function validAnalysisRequest(body: AnalyzeRequest) {
  if (typeof body.fen !== 'string' || body.fen.length > 100 || /[\r\n]/.test(body.fen)) return false
  if (!Number.isInteger(body.depth) || body.depth < 12 || body.depth > maxDepth) return false
  if (body.moveUci !== undefined && (typeof body.moveUci !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(body.moveUci))) return false
  try {
    new Chess(body.fen)
    return true
  } catch {
    return false
  }
}

function sendJson(response: import('node:http').ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  })
  response.end(JSON.stringify(body))
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
        user = { id, username }
      } else {
        const record = database.prepare('SELECT id, username, password_hash, password_salt FROM users WHERE username = ?').get(username) as (User & { password_hash: string; password_salt: string }) | undefined
        if (!record) throw new Error('Invalid username or password.')
        const actual = Buffer.from(hashPassword(password, record.password_salt), 'hex')
        const expected = Buffer.from(record.password_hash, 'hex')
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('Invalid username or password.')
        user = { id: record.id, username: record.username }
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

  if (request.method === 'POST' && request.url === '/api/auth/logout') {
    const token = parseCookies(request).session
    if (token) database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token))
    clearSessionCookie(response)
    sendJson(response, 200, { ok: true })
    return
  }

  if (request.method === 'GET' && request.url === '/api/stats') {
    const user = currentUser(request)
    if (!user) {
      sendJson(response, 401, { error: 'Authentication required.' })
      return
    }
    const rows = database.prepare('SELECT id, game_id AS gameId, game_title AS gameTitle, side, attempted_moves AS attemptedMoves, correct_moves AS correctMoves, deviations, learner_accuracy AS learnerAccuracy, original_accuracy AS originalAccuracy, average_cpl AS averageCpl, completed_at AS completedAt FROM training_sessions WHERE user_id = ? ORDER BY completed_at DESC').all(user.id)
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
      const body = await readJson(request)
      database.prepare('INSERT OR REPLACE INTO training_sessions (id, user_id, game_id, game_title, side, attempted_moves, correct_moves, deviations, learner_accuracy, original_accuracy, average_cpl, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(body.id, user.id, body.gameId, body.gameTitle, body.side, body.attemptedMoves, body.correctMoves, body.deviations, body.learnerAccuracy ?? null, body.originalAccuracy ?? null, body.averageCpl ?? null, body.completedAt)
      sendJson(response, 200, { ok: true })
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

  if (request.method === 'POST' && request.url === '/api/games/import') {
    const user = currentUser(request)
    if (!user) {
      sendJson(response, 401, { error: 'Authentication required.' })
      return
    }
    if (!allowRequest(`import:${user.id}`, 6, 60 * 60 * 1000)) {
      sendJson(response, 429, { error: 'Too many imports. Please try again later.' })
      return
    }
    try {
      const imported = await importPgnStream(request)
      const duplicates = imported.filter((game) => 'duplicate' in game).length
      sendJson(response, 200, { imported: imported.filter((game) => !('duplicate' in game)).map(gameMetadata), duplicates })
    } catch (error) {
      sendJson(response, error instanceof RequestError ? error.status : 400, { error: error instanceof Error ? error.message : 'PGN import failed.' })
    }
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

server.listen(port, '0.0.0.0', () => {
  console.error(`Chess Training listening on port ${port}`)
})
