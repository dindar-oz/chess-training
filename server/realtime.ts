import type { IncomingMessage, ServerResponse } from 'node:http'

// Server-Sent Events hub. Each logged-in browser tab holds one GET /api/events
// stream; a user is "online" while at least one of their streams is open.
// Everything is in memory, so this assumes a single server process.

export type OnlineUser = { id: string; username: string; elo: number }

type Connection = { response: ServerResponse; tokenHash: string; user: OnlineUser }

export const maxConnectionsPerUser = 5
// Sent first on every stream, so a page loaded from an older build notices after
// a deploy (the restart makes every page reconnect).
let helloPayload: { build: string | null } = { build: null }

export function setAppBuild(build: string | null) {
  helloPayload = { build }
}
const heartbeatMs = 25_000
const connections = new Map<string, Set<Connection>>()

function write(connection: Connection, payload: string) {
  if (connection.response.writableEnded || connection.response.destroyed) return
  connection.response.write(payload)
}

// All events use the default SSE "message" type with a { type, data } body, so the
// client needs one listener no matter how many event types exist.
function frame(type: string, data: unknown) {
  return `data: ${JSON.stringify({ type, data })}\n\n`
}

export function onlineUsers(): OnlineUser[] {
  return [...connections.values()]
    .map((userConnections) => [...userConnections][0].user)
    .sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: 'base' }))
}

export function isOnline(userId: string) {
  return connections.has(userId)
}

export function sendToUser(userId: string, type: string, data: unknown) {
  const payload = frame(type, data)
  for (const connection of connections.get(userId) ?? []) write(connection, payload)
}

export function broadcast(type: string, data: unknown) {
  const payload = frame(type, data)
  for (const userConnections of connections.values()) {
    for (const connection of userConnections) write(connection, payload)
  }
}

function broadcastPresence() {
  broadcast('presence', { users: onlineUsers() })
}

function removeConnection(connection: Connection) {
  const userConnections = connections.get(connection.user.id)
  if (!userConnections?.delete(connection)) return
  if (userConnections.size === 0) {
    connections.delete(connection.user.id)
    broadcastPresence()
  }
}

// Returns false (after responding 429) when the user already has too many tabs open.
export function openEventStream(request: IncomingMessage, response: ServerResponse, user: OnlineUser, tokenHash: string) {
  const userConnections = connections.get(user.id) ?? new Set<Connection>()
  if (userConnections.size >= maxConnectionsPerUser) {
    response.writeHead(429, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ error: 'Too many open tabs. Close one and try again.' }))
    return false
  }
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Stops nginx-style reverse proxies from buffering the stream.
    'X-Accel-Buffering': 'no',
  })
  const connection: Connection = { response, tokenHash, user }
  const firstConnection = userConnections.size === 0
  userConnections.add(connection)
  connections.set(user.id, userConnections)
  // Tell the browser to wait 3s before its own automatic reconnect attempts.
  response.write('retry: 3000\n\n')
  write(connection, frame('hello', helloPayload))
  if (firstConnection) broadcastPresence()
  else write(connection, frame('presence', { users: onlineUsers() }))
  request.on('close', () => removeConnection(connection))
  return true
}

// Keeps presence details (such as ELO after a challenge) current for everyone.
export function updateOnlineUser(userId: string, changes: Partial<Omit<OnlineUser, 'id'>>) {
  const userConnections = connections.get(userId)
  if (!userConnections) return
  for (const connection of userConnections) connection.user = { ...connection.user, ...changes }
  broadcastPresence()
}

function closeWhere(matches: (connection: Connection) => boolean) {
  for (const userConnections of [...connections.values()]) {
    for (const connection of [...userConnections]) {
      if (!matches(connection)) continue
      connection.response.end()
      removeConnection(connection)
    }
  }
}

export function disconnectUser(userId: string) {
  closeWhere((connection) => connection.user.id === userId)
}

export function disconnectSession(tokenHash: string) {
  closeWhere((connection) => connection.tokenHash === tokenHash)
}

// Keeps idle proxies from dropping streams, and closes streams whose session has
// expired or been revoked since they opened (the browser's reconnect then gets a 401).
export function startHeartbeat(isSessionValid: (tokenHash: string) => boolean) {
  const timer = setInterval(() => {
    closeWhere((connection) => !isSessionValid(connection.tokenHash))
    for (const userConnections of connections.values()) {
      for (const connection of userConnections) write(connection, ': ping\n\n')
    }
  }, heartbeatMs)
  timer.unref()
}
