/** Bridges between Node's HTTP objects and the web-standard Request/Response used by Shabd's handlers. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'

export function toWebRequest(req: IncomingMessage): Request {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item)
    else if (value !== undefined) headers.set(name, value)
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
  return new Request(url, {
    method: req.method ?? 'GET',
    headers,
    ...(hasBody ? { body: Readable.toWeb(req) as unknown as ReadableStream, duplex: 'half' } : {}),
  } as RequestInit)
}

export async function sendWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status
  response.headers.forEach((value, name) => res.setHeader(name, value))
  if (!response.body) {
    res.end()
    return
  }
  await pipeline(Readable.fromWeb(response.body as unknown as NodeReadableStream), res)
}

export function sendText(res: ServerResponse, body: string | Uint8Array, contentType: string, status = 200): void {
  res.statusCode = status
  res.setHeader('Content-Type', contentType)
  res.setHeader('Cache-Control', 'no-cache')
  res.end(body)
}

export function sendJson(res: ServerResponse, value: unknown, status = 200): void {
  sendText(res, JSON.stringify(value), 'application/json; charset=utf-8', status)
}

/** Read a request body as bytes, refusing bodies over `limit` bytes. */
export async function readBytes(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > limit) throw Object.assign(new Error('Request body too large'), { status: 413 })
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

/** Read a request body as text, refusing bodies over `limit` bytes. */
export async function readBody(req: IncomingMessage, limit = 2 * 1024 * 1024): Promise<string> {
  return (await readBytes(req, limit)).toString('utf8')
}
