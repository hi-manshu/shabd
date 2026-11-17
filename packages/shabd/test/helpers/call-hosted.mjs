/**
 * Runs a function written by `shabd build --adapter <host>` the way its host
 * would, and prints what it answered, as JSON.
 *
 *     node --disallow-code-generation-from-strings call-hosted.mjs <host> <function file> <folder of static files> <route>
 *
 * The flag is what Cloudflare Workers enforce: no `eval`, no `new Function`.
 * A function that needs either fails here as it would there.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [host, file, assets, route] = process.argv.slice(2)
const origin = 'https://docs.example'

/** The static files of the deployed site, as the host would serve them. */
const serve = async (input) => {
  const { pathname } = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  try {
    return new Response(await readFile(path.join(assets, pathname)), { status: 200 })
  } catch {
    return new Response('not found', { status: 404 })
  }
}
// Vercel and Netlify functions fetch the site they are deployed with.
globalThis.fetch = serve

const module = await import(pathToFileURL(file).href)
const handle =
  host === 'cloudflare'
    ? (request) => module.default.fetch(request, { ASSETS: { fetch: serve } })
    : (request) => module.default(request, {})

const rpc = async (method, params) => {
  const response = await handle(
    new Request(`${origin}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  )
  return { status: response.status, body: await response.json() }
}

const result = {
  initialize: await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } }),
  tools: await rpc('tools/list', {}),
  search: await rpc('tools/call', { name: 'search_docs', arguments: { query: 'pelicans', limit: 3 } }),
  read: await rpc('tools/call', { name: 'read_page', arguments: { path: '/guide/setup' } }),
  get: await handle(new Request(`${origin}${route}`)).then((response) => response.status),
  // Only a Worker sees requests for other paths, and it has to pass them on to the static files.
  elsewhere: host === 'cloudflare' ? await handle(new Request(`${origin}/llms.txt`)).then((response) => response.status) : null,
  config: module.config ?? null,
}
console.log(JSON.stringify(result))
