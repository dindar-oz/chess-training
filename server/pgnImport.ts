import { createHash, randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { DatabaseSync } from 'node:sqlite'
import { Chess } from 'chess.js'
import { RequestError } from './http.ts'
import { sendToUser } from './realtime.ts'

// Admin PGN imports of up to 50 MB. Parsing ~20,000 games takes minutes on a small
// App Service plan, longer than Azure's 230 s request timeout, so the request only
// receives the file; games are then imported in the background in small batches,
// yielding between batches so other requests (and challenge clocks) keep running.
// Progress goes to the admin as `import_progress` events and via polling.

export const maxPgnBytes = 50 * 1024 * 1024
export const maxLibrarySize = 20_000
// Work in slices of about this long before yielding, so a move in a running
// challenge never waits much longer than this for the server.
const sliceMs = 40
const maxInvalidSamples = 5
const keptJobs = 10

export type ImportJob = {
  id: string
  userId: string
  status: 'processing' | 'complete' | 'failed'
  totalGames: number
  processed: number
  imported: number
  duplicates: number
  invalid: number
  // Games not imported because the library reached maxLibrarySize.
  skippedFull: number
  invalidSamples: string[]
  error: string | null
  startedAt: string
  finishedAt: string | null
}

type GameRecord = {
  id: string
  title: string
  white: string
  black: string
  event: string
  date: string
  result: string
  ply_count: number
  pgn: string
  fingerprint: string
  imported_at: string
}

const jobs = new Map<string, ImportJob>()
let activeJobId: string | null = null

function pgnHeader(pgn: string, name: string, fallback: string) {
  return pgn.match(new RegExp(`^\\[${name} "([^"]*)"\\]`, 'm'))?.[1] ?? fallback
}

function parseGame(pgn: string): GameRecord {
  const chess = new Chess()
  chess.loadPgn(pgn)
  const moves = chess.history({ verbose: true })
  if (moves.length === 0) throw new Error('no moves')
  const white = pgnHeader(pgn, 'White', 'Unknown White')
  const black = pgnHeader(pgn, 'Black', 'Unknown Black')
  const event = pgnHeader(pgn, 'Event', 'Imported game')
  const date = pgnHeader(pgn, 'Date', 'Unknown date')
  const result = pgnHeader(pgn, 'Result', '*')
  const fingerprint = createHash('sha256').update(`${white}|${black}|${event}|${date}|${result}|${moves.map((move) => move.lan).join(' ')}`).digest('hex')
  return { id: randomUUID(), title: `${white} vs ${black}`, white, black, event, date, result, ply_count: moves.length, pgn, fingerprint, imported_at: new Date().toISOString() }
}

const yieldToEventLoop = () => new Promise((resolve) => setImmediate(resolve))

// Games start at an [Event "..."] header line, as in standard PGN collections.
// Scans line by line in time slices so a 50 MB file doesn't block the server.
async function splitPgnGames(text: string) {
  const games: string[] = []
  const eventHeader = /^\[Event\s+".*"\]\s*$/
  let gameStart = 0
  let lineStart = 0
  let sliceStart = performance.now()
  while (lineStart < text.length) {
    const newline = text.indexOf('\n', lineStart)
    const lineEnd = newline === -1 ? text.length : newline
    if (text.startsWith('[Event', lineStart) && eventHeader.test(text.slice(lineStart, lineEnd).replace(/\r$/, ''))) {
      const game = text.slice(gameStart, lineStart).trim()
      if (game) games.push(game)
      gameStart = lineStart
    }
    lineStart = lineEnd + 1
    if (performance.now() - sliceStart > sliceMs) {
      await yieldToEventLoop()
      sliceStart = performance.now()
    }
  }
  const last = text.slice(gameStart).trim()
  if (last) games.push(last)
  return games
}

function describeParseError(error: unknown) {
  const message = error instanceof Error ? error.message.split('\n')[0] : ''
  if (message === 'no moves') return 'no moves'
  if (message.startsWith('Invalid move')) return message.slice(0, 80)
  return 'not valid PGN'
}

async function receiveText(request: IncomingMessage) {
  const chunks: Buffer[] = []
  let byteCount = 0
  for await (const chunk of request) {
    byteCount += (chunk as Buffer).length
    if (byteCount > maxPgnBytes) throw new RequestError(413, `PGN uploads are limited to ${maxPgnBytes / 1024 / 1024} MB.`)
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function publicJob(job: ImportJob) {
  const { userId: _userId, ...rest } = job
  return rest
}

function report(job: ImportJob) {
  sendToUser(job.userId, 'import_progress', publicJob(job))
}

// Each batch is written in one synchronous transaction (no awaits inside), so no
// other request's writes can interleave with it on the shared connection.
function insertBatch(database: DatabaseSync, job: ImportJob, records: GameRecord[], libraryCount: number) {
  const findDuplicate = database.prepare('SELECT 1 FROM games WHERE fingerprint = ?')
  const insert = database.prepare('INSERT INTO games (id, title, white, black, event, date, result, ply_count, pgn, fingerprint, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  database.exec('BEGIN')
  try {
    for (const record of records) {
      if (findDuplicate.get(record.fingerprint)) {
        job.duplicates += 1
      } else if (libraryCount >= maxLibrarySize) {
        job.skippedFull += 1
      } else {
        insert.run(record.id, record.title, record.white, record.black, record.event, record.date, record.result, record.ply_count, record.pgn, record.fingerprint, record.imported_at)
        job.imported += 1
        libraryCount += 1
      }
    }
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
  return libraryCount
}

async function runJob(database: DatabaseSync, job: ImportJob, games: string[]) {
  let libraryCount = (database.prepare('SELECT COUNT(*) AS count FROM games').get() as { count: number }).count
  let next = 0
  while (next < games.length) {
    if (libraryCount >= maxLibrarySize) {
      // Nothing more can fit; don't spend minutes parsing the rest.
      job.skippedFull += games.length - next
      job.processed = games.length
      break
    }
    // Parse for one time slice, then write what was parsed and yield.
    const sliceStart = performance.now()
    const records: GameRecord[] = []
    while (next < games.length && performance.now() - sliceStart < sliceMs) {
      const pgn = games[next]
      next += 1
      try {
        records.push(parseGame(pgn))
      } catch (error) {
        job.invalid += 1
        if (job.invalidSamples.length < maxInvalidSamples) {
          job.invalidSamples.push(`Game ${next} (${pgnHeader(pgn, 'White', '?')} vs ${pgnHeader(pgn, 'Black', '?')}): ${describeParseError(error)}`)
        }
      }
    }
    libraryCount = insertBatch(database, job, records, libraryCount)
    job.processed = next
    report(job)
    await yieldToEventLoop()
  }
}

// Receives the upload, then returns the job right away while games import in the background.
export async function startImport(database: DatabaseSync, request: IncomingMessage, userId: string) {
  if (activeJobId) throw new RequestError(409, 'Another import is still running. Please wait for it to finish.')
  const games = await splitPgnGames(await receiveText(request))
  if (games.length === 0) throw new RequestError(400, 'No PGN games were found in the upload.')
  if (activeJobId) throw new RequestError(409, 'Another import is still running. Please wait for it to finish.')

  const job: ImportJob = { id: randomUUID(), userId, status: 'processing', totalGames: games.length, processed: 0, imported: 0, duplicates: 0, invalid: 0, skippedFull: 0, invalidSamples: [], error: null, startedAt: new Date().toISOString(), finishedAt: null }
  jobs.set(job.id, job)
  for (const oldId of [...jobs.keys()].slice(0, Math.max(0, jobs.size - keptJobs))) jobs.delete(oldId)
  activeJobId = job.id
  void runJob(database, job, games)
    .then(() => { job.status = 'complete' })
    .catch((error: unknown) => {
      job.status = 'failed'
      job.error = error instanceof Error ? error.message : 'The import failed.'
    })
    .finally(() => {
      job.finishedAt = new Date().toISOString()
      activeJobId = null
      report(job)
    })
  return publicJob(job)
}

export function importJob(jobId: string) {
  const job = jobs.get(jobId)
  return job ? publicJob(job) : null
}
