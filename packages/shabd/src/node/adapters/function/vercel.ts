/**
 * The function that `shabd build --adapter vercel` writes to
 * `.vercel/output/functions/`.
 *
 * A function in Vercel's Build Output API that runs on Node.js is called
 * with Node's own request and response objects, as in Vercel's example:
 *
 *   https://vercel.com/docs/build-output-api/primitives#serverless-function-configuration
 *   https://github.com/vercel/examples/tree/main/build-output-api/serverless-functions
 *
 * So this file turns one into a web `Request` and writes a web `Response`
 * back. It imports nothing from Node to do that: the request is read as the
 * stream of chunks it is, and the response is written in one piece, which
 * the endpoint's plain JSON answers allow.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Endpoint, readFromSite, type EndpointSite } from './endpoint.js'

const first = (value: string | string[] | undefined): string | undefined =>
  (Array.isArray(value) ? value[0] : value)?.split(',')[0]?.trim() || undefined

async function toRequest(req: IncomingMessage): Promise<Request> {
  // Vercel passes the address the reader asked for in these headers. Without them (a test, another proxy)
  // the connection itself says.
  const encrypted = (req.socket as { encrypted?: boolean } | undefined)?.encrypted === true
  const protocol = first(req.headers['x-forwarded-proto']) ?? (encrypted ? 'https' : 'http')
  const host = first(req.headers['x-forwarded-host']) ?? req.headers.host ?? 'localhost'
  const method = req.method ?? 'GET'

  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item)
    else if (value !== undefined) headers.set(name, value)
  }

  let body: Uint8Array | undefined
  if (method !== 'GET' && method !== 'HEAD') {
    const chunks: Uint8Array[] = []
    let length = 0
    for await (const chunk of req as AsyncIterable<Uint8Array>) {
      chunks.push(chunk)
      length += chunk.length
    }
    body = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      body.set(chunk, offset)
      offset += chunk.length
    }
  }

  return new Request(new URL(req.url ?? '/', `${protocol}://${host}`), {
    method,
    headers,
    ...(body ? { body } : {}),
  })
}

async function send(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status
  response.headers.forEach((value, name) => res.setHeader(name, value))
  res.end(new Uint8Array(await response.arrayBuffer()))
}

export function vercelFunction(site: EndpointSite) {
  const endpoint = new Endpoint(site)
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const request = await toRequest(req)
    if (!endpoint.owns(new URL(request.url).pathname)) return send(res, endpoint.notFound())
    const { read, from } = readFromSite(request)
    return send(res, await endpoint.respond(request, read, from))
  }
}
