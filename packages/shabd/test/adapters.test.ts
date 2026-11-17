/**
 * What `shabd build --adapter <name>` writes, checked on real builds of a
 * small site, and each host's function loaded and called the way that host
 * calls it, with the official MCP client at the other end.
 *
 * The hosts themselves are not here. Nothing in this file runs on
 * Cloudflare, Vercel or Netlify, or in a tool that stands in for one.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Endpoint, type ReadSiteFile } from '../src/node/adapters/function/endpoint.js'
import { addressesOf, isLiteralSource, isLiteralTarget, wireAddress } from '../src/node/adapters/shared.js'
import { vercelRuntime } from '../src/node/adapters/vercel.js'
import { build as runBuild } from '../src/node/build/build.js'
import { main } from '../src/node/cli.js'
import { resolveConfig } from '../src/node/config/load.js'
import { VERSION } from '../src/shared/version.js'
import { temporaryBuilds, type BuiltSite } from './helpers/build.js'
import { failure } from './helpers/site.js'
import { loadWorkerLike } from './helpers/worker-like.js'

const build = temporaryBuilds()

/* ───────────────────────────── the site ─────────────────────────────── */

const REDIRECTS = 'redirects:\n  /old: /guide/install#with-npm\n  /blog: https://example.com/blog?from=docs\n'

/** A site of two pages. `site` goes under `site:`, `features` under `features:`, `rest` after them. */
const site = (options: { site?: string; features?: string; rest?: string; files?: Record<string, string> } = {}) => ({
  'shabd.config.yaml':
    `site:\n  title: Acme Docs\n  description: How to use Acme.\n  url: https://docs.acme.test\n${options.site ?? ''}` +
    `features:\n  search: { semantic: false }\n${options.features ?? ''}${options.rest ?? REDIRECTS}`,
  'content/index.md': '# Acme\n\nStart here.\n',
  'content/guide/install.md':
    '---\ntitle: Installation\ndescription: Install the CLI.\n---\n\n## With npm\n\nRun npm install acme to add the command line tool.\n',
  ...options.files,
})

const at = (built: BuiltSite, file: string) => path.join(built.dir, file)
const readAt = (built: BuiltSite, file: string) => readFileSync(at(built, file), 'utf8')
const jsonAt = (built: BuiltSite, file: string) => JSON.parse(readAt(built, file)) as Record<string, unknown>

/** Build again in the same folder, as a second `shabd build` would. */
async function rebuild(built: BuiltSite, options: Parameters<typeof runBuild>[1]): Promise<void> {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  try {
    await runBuild(built.dir, { semantic: false, ...options })
  } finally {
    log.mockRestore()
  }
}

/* ───────────────────────── calling a function ───────────────────────── */

const text = (result: { content?: unknown }) =>
  (result.content as { type: string; text: string }[]).map((part) => part.text).join('\n')

const clients: Client[] = []
const servers: { close(): Promise<void> }[] = []
afterAll(async () => {
  await Promise.all(clients.map((client) => client.close().catch(() => {})))
  await Promise.all(servers.map((server) => server.close()))
})

/** The official client, connected to something that answers a `Request` with a `Response`. */
async function connect(
  answer: (request: Request) => Promise<Response>,
  address = 'https://docs.acme.test/mcp',
  headers: Record<string, string> = {},
): Promise<Client> {
  const client = new Client({ name: 'shabd-test', version: '0.0.0' })
  clients.push(client)
  await client.connect(
    new StreamableHTTPClientTransport(new URL(address), {
      requestInit: { headers },
      fetch: (input, init) => answer(new Request(input as string | URL, init)),
    }),
  )
  return client
}

/** The four things every host's function must do, asked through the client. */
async function expectDocs(client: Client): Promise<void> {
  expect(client.getServerVersion()).toMatchObject({ name: 'acme-docs-docs', title: 'Acme Docs documentation' })
  const { tools } = await client.listTools()
  expect(tools.map((tool) => tool.name).sort()).toEqual(['list_pages', 'read_page', 'search_docs'])
  const found = await client.callTool({ name: 'search_docs', arguments: { query: 'command line tool' } })
  expect(text(found)).toContain('Installation > With npm')
  expect(text(found)).toContain('path: /guide/install#with-npm')
  const page = await client.callTool({ name: 'read_page', arguments: { path: '/guide/install' } })
  expect(text(page)).toContain('Run npm install acme')
}

const post = (address: string, method = 'tools/list') =>
  new Request(address, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: {} }),
  })

/** The file a host serves for an address: the file itself, or the index of the folder. */
function fileFor(root: string, pathname: string): string | undefined {
  const file = path.join(root, decodeURIComponent(pathname))
  if (!existsSync(file)) return undefined
  if (!statSync(file).isDirectory()) return file
  const index = path.join(file, 'index.html')
  return existsSync(index) ? index : undefined
}

/**
 * What Cloudflare passes a Worker as `env.ASSETS`: the files of a folder,
 * by the path of the address asked for. `mount` is the path the folder is
 * served from (`assets.base_path`).
 */
function assetsOf(root: string, mount = '') {
  const asked: string[] = []
  const gone = new Set<string>()
  return {
    asked,
    /** Addresses to answer 404 for, as if the file were not there. */
    gone,
    async fetch(input: Request | URL | string): Promise<Response> {
      const { pathname } = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      asked.push(pathname)
      const inside = pathname === mount || pathname.startsWith(`${mount}/`)
      const file = inside && !gone.has(pathname) ? fileFor(root, pathname.slice(mount.length)) : undefined
      return file ? new Response(readFileSync(file)) : new Response('Not found, says the static site', { status: 404 })
    },
  }
}

/**
 * A host on this machine: it serves the files of a folder, and calls a
 * function for the addresses given, as Vercel calls one (with Node's
 * request and response).
 */
async function host(root: string, functions: Record<string, (req: IncomingMessage, res: ServerResponse) => unknown> = {}) {
  const requests: { path: string; cookie: string | undefined; authorization: string | undefined }[] = []
  const server = createServer((req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost')
    requests.push({ path: pathname, cookie: req.headers.cookie, authorization: req.headers.authorization })
    const run = functions[pathname]
    if (run) return void run(req, res)
    const file = fileFor(root, pathname)
    res.statusCode = file ? 200 : 404
    res.end(file ? readFileSync(file) : 'Not found, says the static site')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const hosted = {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
  servers.push(hosted)
  return hosted
}

/** A written function file is one module: nothing to import, nothing of Node's to resolve. */
function expectSelfContained(code: string): void {
  expect(code).not.toMatch(/^\s*import\s/m)
  expect(code).not.toMatch(/\bimport\(/)
  expect(code).not.toMatch(/["'`]node:/)
  expect(code).toMatch(/^var __shabd_function=/m)
  expect(code).toMatch(/^export default __shabd_function;$/m)
  expect(code).toContain(`Written by shabd ${VERSION}`)
  // The SDK, the handler and Zod, minified: a few hundred kilobytes, the same for every site.
  expect(code.length).toBeGreaterThan(150_000)
  expect(code.length).toBeLessThan(1_000_000)
}

let loads = 0
/**
 * Load a written function as the module it is. Node loads the file as it
 * was written: vitest.config.ts keeps the test runner from compiling what
 * tests build. Every call loads it afresh, as a host does when it starts
 * the function, so nothing fetched before is kept.
 */
const load = async <T>(file: string): Promise<T> =>
  (await import(/* @vite-ignore */ `${pathToFileURL(file).href}?load=${++loads}`)) as T

/* ─────────────────────────── choosing one ───────────────────────────── */

describe('shabd build --adapter', () => {
  it('writes nothing for a host when no adapter is asked for', async () => {
    const built = await build(site())
    for (const file of ['_worker.js', '_routes.json', '_redirects', '.assetsignore']) expect(built.has(file), file).toBe(false)
    expect(existsSync(at(built, '.vercel'))).toBe(false)
    expect(existsSync(at(built, '.netlify'))).toBe(false)
  })

  it('refuses a name that is not an adapter, and lists the ones there are', async () => {
    await expect(build(site(), { adapter: 'heroku' as never })).rejects.toThrow(
      'Unknown adapter "heroku". The adapters are: cloudflare, vercel, netlify',
    )

    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit')
    }) as never)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(main(['build', '.', '--adapter', 'heroku'])).rejects.toThrow('exit')
      expect(exit).toHaveBeenCalledWith(1)
      expect(String(error.mock.calls[0]?.[0])).toContain('Unknown adapter "heroku". The adapters are: cloudflare, vercel, netlify')
    } finally {
      exit.mockRestore()
      error.mockRestore()
    }
  })

  it('names the adapters in the help', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await main(['--help'])
      expect(String(log.mock.calls[0]?.[0])).toContain('--adapter <host>  Build for a host as well: cloudflare, vercel, netlify')
    } finally {
      log.mockRestore()
    }
  })

  it('takes the adapter from the config, and the command line over the config', async () => {
    const fromConfig = await build(site({ rest: `${REDIRECTS}build:\n  adapter: netlify\n` }))
    expect(existsSync(at(fromConfig, '.netlify/v1/functions/shabd-mcp.mjs'))).toBe(true)
    expect(fromConfig.output).toContain('netlify: .netlify/v1/functions/shabd-mcp.mjs, .netlify/v1/config.json')

    const overridden = await build(site({ rest: `${REDIRECTS}build:\n  adapter: netlify\n` }), { adapter: 'cloudflare' })
    expect(overridden.has('_worker.js')).toBe(true)
    expect(existsSync(at(overridden, '.netlify'))).toBe(false)

    const wrong = failure(() => resolveConfig('/site', '/site/shabd.config.yaml', 'site:\n  title: Docs\nbuild:\n  adapter: heroku\n'))
    expect(wrong.issues[0]).toMatchObject({ path: ['build', 'adapter'], line: 4 })
    expect(wrong.issues[0]?.message).toContain('"cloudflare"|"vercel"|"netlify"')
  })
})

/* ───────────────────────── redirects for a host ─────────────────────── */

describe('redirects for a host', () => {
  it('names every address a page that moved may be asked for at, today\'s first', () => {
    expect(addressesOf('/old', { base: '/', urls: 'clean' })).toEqual(['/old', '/old/', '/old.html'])
    expect(addressesOf('/old', { base: '/docs/', urls: 'slash' })).toEqual(['/docs/old/', '/docs/old', '/docs/old.html'])
    expect(addressesOf('/guide/old', { base: '/docs/', urls: 'html' })).toEqual([
      '/docs/guide/old.html',
      '/docs/guide/old',
      '/docs/guide/old/',
    ])
    // The home page is the folder the site is served from, with and without its slash.
    expect(addressesOf('/', { base: '/', urls: 'clean' })).toEqual(['/'])
    expect(addressesOf('/', { base: '/docs/', urls: 'html' })).toEqual(['/docs/', '/docs'])
  })

  it('writes an address the way it is sent, and keeps escapes that are already there', () => {
    expect(wireAddress('/guide/über-uns#größe')).toBe('/guide/%C3%BCber-uns#gr%C3%B6%C3%9Fe')
    expect(wireAddress('/guide/%C3%BCber?a=b c')).toBe('/guide/%C3%BCber?a=b%20c')
    expect(wireAddress('https://example.com/blog?from=docs')).toBe('https://example.com/blog?from=docs')
    expect(addressesOf('/über', { base: '/', urls: 'clean' })[0]).toBe('/%C3%BCber')
  })

  it('knows an address that a host would read as a pattern', () => {
    expect(isLiteralSource('/old/page.html')).toBe(true)
    expect(isLiteralSource('/files/*')).toBe(false)
    expect(isLiteralSource('/user/:name')).toBe(false)
    // The colon of a scheme and of a port is not a placeholder; one in the path is.
    expect(isLiteralTarget('https://example.com:8443/blog')).toBe(true)
    expect(isLiteralTarget('https://example.com/user/:name')).toBe(false)
    expect(isLiteralTarget('/guide/install#with-npm')).toBe(true)
  })
})

/* ─────────────────────────────── Cloudflare ─────────────────────────── */

type Worker = { fetch(request: Request, env: { ASSETS?: unknown }): Promise<Response> }

/** The Worker a build wrote, started afresh. */
const workerOf = async (built: BuiltSite) => (await load<{ default: Worker }>(at(built, 'dist/_worker.js'))).default

describe('the Cloudflare adapter', () => {
  let built: BuiltSite

  beforeAll(async () => {
    built = await build(
      site({
        files: {
          'public/_redirects': '/promo/* /offers/:splat 302\n/press /about 301\n',
          'public/.assetsignore': 'notes.txt\n',
        },
      }),
      { adapter: 'cloudflare' },
    )
  })

  it('writes the Worker, which addresses call it, the redirects, and what not to publish', async () => {
    expect(built.output).toContain('cloudflare: dist/_worker.js, dist/_routes.json, dist/.assetsignore, dist/_redirects')

    expectSelfContained(await built.read('_worker.js'))
    expect(await built.read('_worker.js')).toMatch(/^\/\/ The MCP endpoint of this site, as a Cloudflare Worker\.\n/)
    expect(typeof (await workerOf(built)).fetch).toBe('function')

    // Only the MCP route runs the Worker on Pages. Every other request stays a static one.
    expect(JSON.parse(await built.read('_routes.json'))).toEqual({ version: 1, include: ['/mcp'], exclude: [] })

    // Shabd's rules, today's form of each address first, then the site's own file as it was.
    expect(await built.read('_redirects')).toBe(
      '# The redirects of shabd.config.yaml, written by `shabd build --adapter cloudflare`.\n' +
        '/old /guide/install#with-npm 301\n' +
        '/blog https://example.com/blog?from=docs 301\n' +
        '/old/ /guide/install#with-npm 301\n' +
        '/blog/ https://example.com/blog?from=docs 301\n' +
        '/old.html /guide/install#with-npm 301\n' +
        '/blog.html https://example.com/blog?from=docs 301\n' +
        '\n/promo/* /offers/:splat 302\n/press /about 301\n',
    )
    expect(await built.read('.assetsignore')).toBe('notes.txt\n_worker.js\n_routes.json\n')

    // The pages that send the reader on are still there, for a host that does not read the rules.
    expect(await built.read('old/index.html')).toContain('content="0; url=/guide/install#with-npm"')
  })

  it('answers the MCP route from the site\'s own files, fetched once, the index only for a search', async () => {
    const worker = await workerOf(built)
    const assets = assetsOf(at(built, 'dist'))
    const env = { ASSETS: assets }
    const client = await connect((request) => worker.fetch(request, env))

    await client.listTools()
    await client.callTool({ name: 'list_pages', arguments: {} })
    expect(assets.asked).toEqual(['/_shabd/docs.json'])

    await expectDocs(client)
    await client.callTool({ name: 'search_docs', arguments: { query: 'acme' } })
    expect(assets.asked).toEqual(['/_shabd/docs.json', '/_shabd/search-index.json'])
  })

  it('hands a request for any other address to the static site, as it came', async () => {
    const worker = await workerOf(built)
    const assets = assetsOf(at(built, 'dist'))
    const seen: (Request | URL | string)[] = []
    const env = { ASSETS: { fetch: (input: Request | URL | string) => (seen.push(input), assets.fetch(input)) } }

    const page = new Request('https://docs.acme.test/guide/install/')
    const served = await worker.fetch(page, env)
    expect(seen[0]).toBe(page)
    expect(served.status).toBe(200)
    expect(await served.text()).toContain('<h1 class="sb-page-title">Installation</h1>')

    const missing = await worker.fetch(new Request('https://docs.acme.test/guide/nothing'), env)
    expect(missing.status).toBe(404)
    expect(await missing.text()).toBe('Not found, says the static site')
    // Near the route is not the route.
    expect((await worker.fetch(post('https://docs.acme.test/mcp/'), env)).status).toBe(404)
    expect(assets.asked).not.toContain('/_shabd/docs.json')
  })

  it('answers what the handler answers to a request that is not a POST', async () => {
    const worker = await workerOf(built)
    const env = { ASSETS: assetsOf(at(built, 'dist')) }
    const get = await worker.fetch(new Request('https://docs.acme.test/mcp'), env)
    expect(get.status).toBe(405)
    expect(get.headers.get('allow')).toBe('POST, OPTIONS')
    const preflight = await worker.fetch(
      new Request('https://docs.acme.test/mcp', { method: 'OPTIONS', headers: { origin: 'https://app.example' } }),
      env,
    )
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*')
    // Neither needed the site's files.
    expect(env.ASSETS.asked).toEqual([])
  })

  it('says what is wrong when the site\'s files cannot be read, and tries again the next time', async () => {
    const fresh = await workerOf(built)
    const assets = assetsOf(at(built, 'dist'))
    const env = { ASSETS: assets }

    assets.gone.add('/_shabd/docs.json')
    const failed = await fresh.fetch(post('https://docs.acme.test/mcp'), env)
    expect(failed.status).toBe(500)
    expect(((await failed.json()) as { error: { message: string } }).error.message).toBe(
      'The MCP endpoint could not read /_shabd/docs.json: the site answered 404.',
    )

    assets.gone.clear()
    assets.gone.add('/_shabd/search-index.json')
    const client = await connect((request) => fresh.fetch(request, env))
    const search = await client.callTool({ name: 'search_docs', arguments: { query: 'acme' } })
    expect(search.isError).toBe(true)
    expect(text(search)).toContain('could not read /_shabd/search-index.json: the site answered 404')
    // Reading pages does not need the index.
    expect(text(await client.callTool({ name: 'read_page', arguments: { path: '/' } }))).toContain('Start here.')

    assets.gone.clear()
    await expectDocs(client)

    const unbound = await fresh.fetch(new Request('https://docs.acme.test/guide/install'), {})
    expect(unbound.status).toBe(500)
    expect(await unbound.text()).toContain('has no ASSETS binding')
  })

  it('runs where a Worker runs: without Node\'s globals, and without making code from strings', async () => {
    const realm = loadWorkerLike<Worker>(await built.read('_worker.js'), '__shabd_function', at(built, 'dist/_worker.js'))
    expect(realm.probe('[typeof process, typeof Buffer, typeof global, typeof require, typeof setImmediate]')).toEqual(
      Array(5).fill('undefined'),
    )
    expect(() => realm.probe('new Function("return 1")')).toThrow(/Code generation from strings disallowed/)

    const assets = assetsOf(at(built, 'dist'))
    const client = await connect((request) => realm.loaded.fetch(request, { ASSETS: assets }))
    await expectDocs(client)
    expect(text(await client.callTool({ name: 'list_pages', arguments: {} }))).toBe(
      '- /: Acme\n- /guide/install: Installation. Install the CLI.',
    )
  })

  it('writes addresses with the site\'s base and in its style, and asks for its files under the base', async () => {
    const based = await build(site({ site: '  base: /docs/\n  urls: html\n' }), { adapter: 'cloudflare' })
    expect(JSON.parse(await based.read('_routes.json'))).toEqual({ version: 1, include: ['/docs/mcp'], exclude: [] })
    expect(await based.read('_redirects')).toBe(
      '# The redirects of shabd.config.yaml, written by `shabd build --adapter cloudflare`.\n' +
        '/docs/old.html /docs/guide/install.html#with-npm 301\n' +
        '/docs/blog.html https://example.com/blog?from=docs 301\n' +
        '/docs/old /docs/guide/install.html#with-npm 301\n' +
        '/docs/blog https://example.com/blog?from=docs 301\n' +
        '/docs/old/ /docs/guide/install.html#with-npm 301\n' +
        '/docs/blog/ https://example.com/blog?from=docs 301\n',
    )
    expect(based.output).toContain('Cloudflare Workers serves dist/ from there when "base_path" under "assets"')
    expect(based.output).toContain('is "/docs". Cloudflare Pages documents no such setting')

    // As Workers serves it with `assets.base_path`: dist/ under /docs, and nothing outside it.
    const assets = assetsOf(at(based, 'dist'), '/docs')
    const worker = await workerOf(based)
    const client = await connect((request) => worker.fetch(request, { ASSETS: assets }), 'https://acme.test/docs/mcp')
    await expectDocs(client)
    expect(assets.asked).toEqual(['/docs/_shabd/docs.json', '/docs/_shabd/search-index.json'])
    // Without the base it is not the route.
    expect((await worker.fetch(post('https://acme.test/mcp'), { ASSETS: assets })).status).toBe(404)
  })

  it('writes the redirects alone for a site without an MCP endpoint, and nothing for one with neither', async () => {
    const redirectsOnly = await build(site({ features: '  mcp: false\n' }), { adapter: 'cloudflare' })
    expect(redirectsOnly.output).toContain('cloudflare: dist/_redirects')
    expect(redirectsOnly.has('_redirects')).toBe(true)
    for (const file of ['_worker.js', '_routes.json', '.assetsignore']) expect(redirectsOnly.has(file), file).toBe(false)

    const neither = await build(site({ features: '  mcp: false\n', rest: '' }), { adapter: 'cloudflare' })
    expect(neither.output).toContain('cloudflare: nothing to write. The site has no MCP endpoint and no redirects')
    expect(neither.has('_redirects')).toBe(false)
  })

  it('stops when the site has a Worker of its own, which it would have written over', async () => {
    const mine = { 'public/_worker.js': 'export default { fetch: () => new Response("mine") }\n' }
    await expect(build(site({ files: mine }), { adapter: 'cloudflare' })).rejects.toThrow(
      'The cloudflare adapter writes _worker.js into dist/, and the site has public/_worker.js of its own',
    )
    // Without an endpoint there is no Worker to write, and the site's own is left where it is.
    const kept = await build(site({ features: '  mcp: false\n', files: mine }), { adapter: 'cloudflare' })
    expect(await kept.read('_worker.js')).toBe(mine['public/_worker.js'])
  })

  it('leaves out what Cloudflare would not take, and says so', async () => {
    // 700 redirects are 2,100 rules. Cloudflare reads 2,000 plain ones.
    const many = Array.from({ length: 700 }, (_, i) => `  /was/${i}: /guide/install\n`).join('')
    const full = await build(site({ rest: `redirects:\n${many}  /profile: https://example.com/user/:name\n` }), {
      adapter: 'cloudflare',
    })
    const rules = (await full.read('_redirects')).split('\n').filter((line) => line && !line.startsWith('#'))
    expect(rules).toHaveLength(2000)
    // Today's form of all 700 is in, and so is the next form: what is left out are 100 of the third.
    expect(rules[0]).toBe('/was/0 /guide/install 301')
    expect(rules[699]).toBe('/was/699 /guide/install 301')
    expect(rules).toContain('/was/699/ /guide/install 301')
    expect(rules).toContain('/was/599.html /guide/install 301')
    expect(rules).not.toContain('/was/600.html /guide/install 301')
    expect(full.output).toContain('Cloudflare reads 2000 plain rules from _redirects, and this site has 2100. 100 rules are left out')
    // `:name` is a placeholder to Cloudflare, so that address is left to its page.
    expect(rules.some((rule) => rule.startsWith('/profile'))).toBe(false)
    expect(full.output).toContain('1 redirect could not be written as a rule for Cloudflare')
    expect(await full.read('profile/index.html')).toContain('url=https://example.com/user/:name')
  })
})

/* ──────────────────────────────── Vercel ────────────────────────────── */

type NodeFunction = (req: IncomingMessage, res: ServerResponse) => Promise<void>

/** What Vercel does with `routes` before it looks for a file: the first rule that matches answers. */
function vercelRedirect(config: Record<string, unknown>, pathname: string): { status: number; location: string } | undefined {
  for (const route of config.routes as { src?: string; handle?: string; status?: number; headers?: { Location: string } }[]) {
    if (route.handle) return undefined
    if (route.src && new RegExp(route.src).test(pathname) && route.headers) {
      return { status: route.status ?? 0, location: route.headers.Location }
    }
  }
  return undefined
}

describe('the Vercel adapter', () => {
  let built: BuiltSite

  beforeAll(async () => {
    built = await build(site(), { adapter: 'vercel' })
  })

  it('writes the whole deployment to .vercel/output: routes, a copy of the site, and the function', async () => {
    expect(built.output).toContain('vercel: .vercel/output/config.json, .vercel/output/static/, .vercel/output/functions/mcp.func/')

    expect(jsonAt(built, '.vercel/output/config.json')).toEqual({
      version: 3,
      routes: [
        { src: '^(?:/old|/old/|/old\\.html)$', status: 301, headers: { Location: '/guide/install#with-npm' } },
        { src: '^(?:/blog|/blog/|/blog\\.html)$', status: 301, headers: { Location: 'https://example.com/blog?from=docs' } },
        { handle: 'filesystem' },
        { src: '.*', status: 404, dest: '/404.html' },
      ],
      framework: { slug: 'shabd', version: VERSION },
    })

    // Every file of dist/, at the same path.
    for (const file of ['index.html', 'guide/install/index.html', 'old/index.html', '404.html', '_shabd/docs.json', '_shabd/search-index.json', 'llms.txt']) {
      expect(readAt(built, `.vercel/output/static/${file}`), file).toBe(await built.read(file))
    }

    expect(jsonAt(built, '.vercel/output/functions/mcp.func/.vc-config.json')).toEqual({
      runtime: vercelRuntime(),
      handler: 'index.mjs',
      launcherType: 'Nodejs',
      shouldAddHelpers: false,
    })
    const code = readAt(built, '.vercel/output/functions/mcp.func/index.mjs')
    expectSelfContained(code)
    expect(code).toMatch(/^\/\/ The MCP endpoint of this site, as a Vercel function\.\n/)
  })

  it('runs the function on the Node.js the build ran on, if Vercel has it', () => {
    expect(vercelRuntime('22.16.0')).toBe('nodejs22.x')
    expect(vercelRuntime('24.1.0')).toBe('nodejs24.x')
    expect(vercelRuntime('26.0.0')).toBe('nodejs26.x')
    // Vercel offers the even versions, and Shabd needs 22.
    expect(vercelRuntime('25.2.0')).toBe('nodejs24.x')
    expect(vercelRuntime('20.11.0')).toBe('nodejs22.x')
    expect(vercelRuntime()).toBe(`nodejs${Math.max(22, Number(process.versions.node.split('.')[0]) & ~1)}.x`)
  })

  it('redirects every form of an address that has moved, before any file is looked for', () => {
    const config = jsonAt(built, '.vercel/output/config.json')
    for (const address of ['/old', '/old/', '/old.html']) {
      expect(vercelRedirect(config, address), address).toEqual({ status: 301, location: '/guide/install#with-npm' })
    }
    expect(vercelRedirect(config, '/blog')).toEqual({ status: 301, location: 'https://example.com/blog?from=docs' })
    for (const address of ['/older', '/old/er', '/an/old', '/oldxhtml', '/guide/install', '/mcp']) {
      expect(vercelRedirect(config, address), address).toBeUndefined()
    }
  })

  it('answers the MCP route when called as Vercel calls a Node.js function, reading the site over HTTP', async () => {
    const { default: handler } = await load<{ default: NodeFunction }>(at(built, '.vercel/output/functions/mcp.func/index.mjs'))
    // Vercel serves static/ and calls the function at its own address. The second address stands for a
    // rule that sent the function a request it should not have.
    const vercel = await host(at(built, '.vercel/output/static'), { '/mcp': handler, '/elsewhere': handler })

    const client = await connect((request) => fetch(request), `${vercel.origin}/mcp`, { cookie: 'session=abc' })
    await expectDocs(client)
    await client.callTool({ name: 'search_docs', arguments: { query: 'acme' } })

    // The two files came from the address the request came to, once each, with the caller's cookie.
    const files = vercel.requests.filter((request) => request.path.startsWith('/_shabd/'))
    expect(files).toEqual([
      { path: '/_shabd/docs.json', cookie: 'session=abc', authorization: undefined },
      { path: '/_shabd/search-index.json', cookie: 'session=abc', authorization: undefined },
    ])

    const get = await fetch(`${vercel.origin}/mcp`)
    expect(get.status).toBe(405)
    expect(get.headers.get('allow')).toBe('POST, OPTIONS')

    const elsewhere = await fetch(post(`${vercel.origin}/elsewhere`))
    expect(elsewhere.status).toBe(404)
    expect(((await elsewhere.json()) as { error: { message: string } }).error.message).toBe(
      'Not found. The MCP endpoint is at /mcp.',
    )
  })

  it('says what is wrong when the site answers the function with something else than its files', async () => {
    const { default: handler } = await load<{ default: NodeFunction }>(at(built, '.vercel/output/functions/mcp.func/index.mjs'))
    // A deployment behind a login answers every request with its login page, the function's own included.
    const vercel = await host(at(built, '.vercel/output/static'), {
      '/mcp': handler,
      '/_shabd/docs.json': (_req, res) => res.end('<!doctype html><title>Log in</title>'),
    })
    const failed = await fetch(post(`${vercel.origin}/mcp`))
    expect(failed.status).toBe(500)
    expect(((await failed.json()) as { error: { message: string } }).error.message).toBe(
      'The MCP endpoint could not read /_shabd/docs.json: what the site sent is not JSON. A site behind a login sends its login page.',
    )
  })

  it('takes the address of the request from the headers Vercel sets', async () => {
    const { default: handler } = await load<{ default: NodeFunction }>(at(built, '.vercel/output/functions/mcp.func/index.mjs'))
    const site = await host(at(built, '.vercel/output/static'))
    // A proxy in front, as Vercel's is: the function sees its own address in the forwarded headers.
    const proxy = await host(at(built, 'dist'), {
      '/mcp': (req, res) => {
        req.headers['x-forwarded-host'] = new URL(site.origin).host
        req.headers['x-forwarded-proto'] = 'http'
        req.headers.host = 'internal.invalid'
        return handler(req, res)
      },
    })
    const client = await connect((request) => fetch(request), `${proxy.origin}/mcp`)
    await expectDocs(client)
    expect(site.requests.map((request) => request.path)).toEqual(['/_shabd/docs.json', '/_shabd/search-index.json'])
    expect(proxy.requests.some((request) => request.path.startsWith('/_shabd/'))).toBe(false)
  })

  it('puts the site, the function and the 404 page under the site\'s base', async () => {
    const based = await build(site({ site: '  base: /docs/\n  urls: slash\n' }), { adapter: 'vercel' })
    expect(jsonAt(based, '.vercel/output/config.json').routes).toEqual([
      { src: '^(?:/docs/old/|/docs/old|/docs/old\\.html)$', status: 301, headers: { Location: '/docs/guide/install/#with-npm' } },
      { src: '^(?:/docs/blog/|/docs/blog|/docs/blog\\.html)$', status: 301, headers: { Location: 'https://example.com/blog?from=docs' } },
      { handle: 'filesystem' },
      { src: '.*', status: 404, dest: '/docs/404.html' },
    ])
    expect(existsSync(at(based, '.vercel/output/static/index.html'))).toBe(false)
    expect(readAt(based, '.vercel/output/static/docs/guide/install/index.html')).toBe(await based.read('guide/install/index.html'))
    expect(existsSync(at(based, '.vercel/output/functions/docs/mcp.func/.vc-config.json'))).toBe(true)

    const { default: handler } = await load<{ default: NodeFunction }>(at(based, '.vercel/output/functions/docs/mcp.func/index.mjs'))
    const vercel = await host(at(based, '.vercel/output/static'), { '/docs/mcp': handler, '/mcp': handler })
    const client = await connect((request) => fetch(request), `${vercel.origin}/docs/mcp`)
    await expectDocs(client)
    expect(vercel.requests.filter((request) => request.path.includes('_shabd')).map((request) => request.path)).toEqual([
      '/docs/_shabd/docs.json',
      '/docs/_shabd/search-index.json',
    ])
    expect((await fetch(post(`${vercel.origin}/mcp`))).status).toBe(404)
  })

  it('leaves nothing of an earlier build in .vercel/output, and writes no function for a site without the endpoint', async () => {
    const again = await build(site(), { adapter: 'vercel' })
    writeFileSync(at(again, '.vercel/output/static/left-over.html'), 'from an earlier build')
    writeFileSync(at(again, '.vercel/project.json'), '{"projectId":"kept"}')
    writeFileSync(at(again, 'shabd.config.yaml'), site({ features: '  mcp: false\n', rest: '' })['shabd.config.yaml'])
    await rebuild(again, { adapter: 'vercel' })

    expect(existsSync(at(again, '.vercel/output/static/left-over.html'))).toBe(false)
    expect(existsSync(at(again, '.vercel/output/functions'))).toBe(false)
    expect(existsSync(at(again, '.vercel/output/static/_shabd/docs.json'))).toBe(false)
    expect(jsonAt(again, '.vercel/output/config.json').routes).toEqual([
      { handle: 'filesystem' },
      { src: '.*', status: 404, dest: '/404.html' },
    ])
    // What is not the build's output is not the build's to remove.
    expect(readAt(again, '.vercel/project.json')).toBe('{"projectId":"kept"}')
  })

  it('escapes what Vercel would read as part of a pattern', async () => {
    const odd = await build(site({ rest: 'redirects:\n  /a+b(1): /guide/install\n  /cost: https://example.com/?price=$1\n' }), {
      adapter: 'vercel',
    })
    const config = jsonAt(odd, '.vercel/output/config.json')
    expect(vercelRedirect(config, '/a+b(1)')).toEqual({ status: 301, location: '/guide/install' })
    expect(vercelRedirect(config, '/aab(1)')).toBeUndefined()
    // A dollar sign and a digit would be filled in with what the pattern matched.
    expect(vercelRedirect(config, '/cost')).toEqual({ status: 301, location: 'https://example.com/?price=%241' })
  })
})

/* ──────────────────────────────── Netlify ───────────────────────────── */

type WebFunction = (request: Request, context: unknown) => Promise<Response>
type NetlifyModule = { default: WebFunction; config: { path: string | string[]; name: string; generator: string } }

describe('the Netlify adapter', () => {
  let built: BuiltSite

  beforeAll(async () => {
    built = await build(site(), { adapter: 'netlify' })
  })

  it('writes the function with the address it is called for, and the redirects as forced rules', async () => {
    expect(built.output).toContain('netlify: .netlify/v1/functions/shabd-mcp.mjs, .netlify/v1/config.json')
    // Nothing goes into dist/, which Netlify publishes as it is.
    expect(built.has('_redirects')).toBe(false)

    const code = readAt(built, '.netlify/v1/functions/shabd-mcp.mjs')
    expectSelfContained(code)
    expect(code).toMatch(/^\/\/ The MCP endpoint of this site, as a Netlify function\.\n/)
    // Netlify reads `config` from the text of the file, so it has to be there in plain values.
    expect(code.endsWith(
      'export default __shabd_function;\n' +
        'export const config = {\n' +
        '  path: "/mcp",\n' +
        '  name: "Shabd MCP endpoint",\n' +
        `  generator: "shabd@${VERSION}",\n` +
        '};\n',
    )).toBe(true)
    const module = await load<NetlifyModule>(at(built, '.netlify/v1/functions/shabd-mcp.mjs'))
    expect(module.config).toEqual({ path: '/mcp', name: 'Shabd MCP endpoint', generator: `shabd@${VERSION}` })
    expect(typeof module.default).toBe('function')

    // One rule covers an address with and without its slash. Each is forced: a page stands at the address.
    expect(jsonAt(built, '.netlify/v1/config.json')).toEqual({
      redirects: [
        { from: '/old', to: '/guide/install#with-npm', status: 301, force: true },
        { from: '/old.html', to: '/guide/install#with-npm', status: 301, force: true },
        { from: '/blog', to: 'https://example.com/blog?from=docs', status: 301, force: true },
        { from: '/blog.html', to: 'https://example.com/blog?from=docs', status: 301, force: true },
      ],
    })
  })

  it('answers the MCP route when called as Netlify calls a function, reading the site over HTTP', async () => {
    const { default: handler } = await load<NetlifyModule>(at(built, '.netlify/v1/functions/shabd-mcp.mjs'))
    // Netlify publishes dist/ and passes the function a web Request for the address the reader asked for.
    const netlify = await host(at(built, 'dist'))
    const context = { params: {}, site: { url: netlify.origin } }

    const client = await connect((request) => handler(request, context), `${netlify.origin}/mcp`, { authorization: 'Basic abc' })
    await expectDocs(client)
    await client.callTool({ name: 'search_docs', arguments: { query: 'acme' } })
    // The two files came from the address the request came to, once each, with what the caller sent to be let in.
    expect(netlify.requests).toEqual([
      { path: '/_shabd/docs.json', cookie: undefined, authorization: 'Basic abc' },
      { path: '/_shabd/search-index.json', cookie: undefined, authorization: 'Basic abc' },
    ])

    const get = await handler(new Request(`${netlify.origin}/mcp`), context)
    expect(get.status).toBe(405)
    const elsewhere = await handler(post(`${netlify.origin}/guide/install`), context)
    expect(elsewhere.status).toBe(404)
    expect(((await elsewhere.json()) as { error: { message: string } }).error.message).toBe(
      'Not found. The MCP endpoint is at /mcp.',
    )
  })

  it('reports a site that answers its own function with something else than the file', async () => {
    const { default: handler } = await load<NetlifyModule>(`${at(built, '.netlify/v1/functions/shabd-mcp.mjs')}`)
    // A site behind a login answers every request with its login page.
    const login = await host(at(built, 'dist'), {
      '/_shabd/docs.json': (_req, res) => res.end('<!doctype html><title>Log in</title>'),
    })
    const failed = await handler(post(`${login.origin}/mcp`), {})
    expect(failed.status).toBe(500)
    expect(((await failed.json()) as { error: { message: string } }).error.message).toBe(
      'The MCP endpoint could not read /_shabd/docs.json: what the site sent is not JSON. A site behind a login sends its login page.',
    )

    // Nothing answers at this address any more.
    const closed = await host(at(built, 'dist'))
    await closed.close()
    const unreachable = await handler(post(`${closed.origin}/mcp`), {})
    expect(unreachable.status).toBe(500)
    expect(((await unreachable.json()) as { error: { message: string } }).error.message).toContain(
      'The MCP endpoint could not fetch /_shabd/docs.json from the site:',
    )
  })

  it('serves dist/ under the site\'s base, and calls the function with and without the base in front', async () => {
    const based = await build(site({ site: '  base: /docs/\n' }), { adapter: 'netlify' })
    expect(jsonAt(based, '.netlify/v1/config.json')).toEqual({
      redirects: [
        { from: '/docs/old', to: '/docs/guide/install#with-npm', status: 301, force: true },
        { from: '/docs/old.html', to: '/docs/guide/install#with-npm', status: 301, force: true },
        { from: '/docs/blog', to: 'https://example.com/blog?from=docs', status: 301, force: true },
        { from: '/docs/blog.html', to: 'https://example.com/blog?from=docs', status: 301, force: true },
        // Last, so that the redirects above it are seen first.
        { from: '/docs/*', to: '/:splat', status: 200, force: true },
      ],
    })

    const module = await load<NetlifyModule>(at(based, '.netlify/v1/functions/shabd-mcp.mjs'))
    expect(module.config.path).toEqual(['/docs/mcp', '/mcp'])
    const netlify = await host(at(based, 'dist'))
    for (const address of ['/docs/mcp', '/mcp']) {
      const client = await connect((request) => module.default(request, {}), `${netlify.origin}${address}`)
      await expectDocs(client)
    }
    // dist/ is published at the root whatever the base, so that is where the files are asked for.
    expect(new Set(netlify.requests.map((request) => request.path))).toEqual(new Set(['/_shabd/docs.json', '/_shabd/search-index.json']))
  })

  it('removes what an earlier build wrote when the site no longer has it', async () => {
    const again = await build(site(), { adapter: 'netlify' })
    writeFileSync(at(again, '.netlify/state.json'), '{"siteId":"kept"}')
    writeFileSync(at(again, 'shabd.config.yaml'), site({ features: '  mcp: false\n', rest: '' })['shabd.config.yaml'])
    await rebuild(again, { adapter: 'netlify' })

    expect(existsSync(at(again, '.netlify/v1/functions/shabd-mcp.mjs'))).toBe(false)
    expect(existsSync(at(again, '.netlify/v1/config.json'))).toBe(false)
    expect(readAt(again, '.netlify/state.json')).toBe('{"siteId":"kept"}')
  })
})

/* ────────────────────────────── the function ────────────────────────── */

describe('the function on a host', () => {
  const docsOf = (name: string) =>
    JSON.stringify({
      version: 1,
      name,
      description: '',
      pages: [{ path: '/', title: name, description: '', url: `https://${name}.test/index.md`, markdown: `# ${name}\n` }],
    })
  const where = { routes: ['/mcp'], docs: '/_shabd/docs.json', index: '/_shabd/search-index.json' }
  const nameOf = async (response: Response) =>
    ((await response.json()) as { result: { serverInfo: { title: string } } }).result.serverInfo.title
  const initialize = () =>
    new Request('https://docs.acme.test/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } },
      }),
    })

  it('keeps the files of one address apart from those of another', async () => {
    const endpoint = new Endpoint(where)
    const reads: string[] = []
    const reader =
      (name: string): ReadSiteFile =>
      async () => (reads.push(name), new Response(docsOf(name)))

    expect(await nameOf(await endpoint.respond(initialize(), reader('one'), 'https://one.test'))).toBe('one documentation')
    expect(await nameOf(await endpoint.respond(initialize(), reader('two'), 'https://two.test'))).toBe('two documentation')
    // A second request for an address is answered from what the first fetched, whoever asks.
    expect(await nameOf(await endpoint.respond(initialize(), reader('other'), 'https://one.test'))).toBe('one documentation')
    expect(reads).toEqual(['one', 'two'])
  })

  it('keeps the files of a few addresses, not of every name a request can claim', async () => {
    const endpoint = new Endpoint(where)
    let reads = 0
    const read: ReadSiteFile = async () => (reads++, new Response(docsOf('site')))
    for (let i = 0; i < 6; i++) await endpoint.respond(initialize(), read, `https://name-${i}.test`)
    expect(reads).toBe(6)
    // The newest four are kept; the first has made room and is fetched again.
    await endpoint.respond(initialize(), read, 'https://name-5.test')
    expect(reads).toBe(6)
    await endpoint.respond(initialize(), read, 'https://name-0.test')
    expect(reads).toBe(7)
  })

  it('fetches the files once for requests that arrive together', async () => {
    const endpoint = new Endpoint(where)
    let reads = 0
    const read: ReadSiteFile = async () => {
      reads++
      await new Promise((resolve) => setTimeout(resolve, 20))
      return new Response(docsOf('site'))
    }
    const answers = await Promise.all([1, 2, 3].map(() => endpoint.respond(initialize(), read)))
    expect(answers.map((response) => response.status)).toEqual([200, 200, 200])
    expect(reads).toBe(1)
  })
})
