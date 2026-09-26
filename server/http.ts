import type { IncomingMessage, ServerResponse } from 'node:http'

export const maxJsonBytes = 64 * 1024

export class RequestError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  })
  response.end(JSON.stringify(body))
}

export function sendError(response: ServerResponse, error: unknown, fallbackMessage: string, fallbackStatus = 400) {
  sendJson(response, error instanceof RequestError ? error.status : fallbackStatus, { error: error instanceof Error ? error.message : fallbackMessage })
}

export async function readJson(request: IncomingMessage, maxBytes = maxJsonBytes) {
  let rawBody = ''
  let byteCount = 0
  for await (const chunk of request) {
    byteCount += Buffer.byteLength(chunk)
    if (byteCount > maxBytes) throw new RequestError(413, 'Request body is too large.')
    rawBody += chunk
  }
  try {
    return JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    throw new RequestError(400, 'Request body must be valid JSON.')
  }
}

const rateLimits = new Map<string, { count: number; resetAt: number }>()

export function allowRequest(key: string, limit: number, windowMs: number) {
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
