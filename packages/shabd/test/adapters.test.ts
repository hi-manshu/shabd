import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ADAPTERS, isAdapter, type AdapterName } from '../src/node/build/adapters.js'
import { build } from '../src/node/build/build.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(here, '..', '..', '..', 'e2e', 'site')
const CALL = path.join(here, 'helpers', 'call-hosted.mjs')
// Inside the repository, so that the site finds React and the other packages a build needs.
const TMP = path.join(here, '.tmp')
let scratch: string

beforeAll(async () => {
  await mkdir(TMP, { recursive: true })
  scratch = await mkdtemp(path.join(TMP, 'adapters-'))
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterAll(() => rm(scratch, { recursive: true, force: true }))

/** A copy of the browser tests' site, built with an adapter. */
async function built(adapter: AdapterName, base = '/'): Promise<string> {
  const root = path.join(scratch, `${adapter}${base.replace(/\//g, '-')}`)
  await cp(FIXTURE, root, { recursive: true })
  if (base !== '/') {
    const file = path.join(root, 'shabd.config.yaml')
    await writeFile(file, (await readFile(file, 'utf8')).replace('  title: Fixture\n', `  title: Fixture\n  base: ${base}\n`))
  }
  await build(root, { semantic: false, adapter })
  return root
}

interface Answer {
  initialize: { status: number; body: { result: { serverInfo: { name: string } } } }
  tools: { status: number; body: { result: { tools: { name: string }[] } } }
  search: { status: number; body: { result: { content: { text: string }[] } } }
  read: { status: number; body: { result: { content: { text: string }[] } } }
  get: number
  elsewhere: number | null
  config: { path: string } | null
}

/** Run the function as its host would, where code may not be generated from strings. */
function ask(host: AdapterName, file: string, assets: string, route = '/mcp'): Answer {
  const done = spawnSync(process.execPath, ['--disallow-code-generation-from-strings', CALL, host, file, assets, route], { encoding: 'utf8' })
  if (done.status !== 0) throw new Error(`The ${host} function failed:\n${done.stderr}`)
  return JSON.parse(done.stdout) as Answer
}

function expectDocs(answer: Answer) {
  expect(answer.initialize.status).toBe(200)
  expect(answer.initialize.body.result.serverInfo.name).toBe('fixture-docs')
  expect(answer.tools.body.result.tools.map((tool) => tool.name).sort()).toEqual(['list_pages', 'read_page', 'search_docs'])
  // The fixture mentions pelicans once, on the setup page.
  expect(answer.search.body.result.content[0]!.text).toContain('/guide/setup')
  expect(answer.read.body.result.content[0]!.text).toContain('Setting up')
  // The endpoint keeps no session: anything but POST is refused, and says so.
  expect(answer.get).toBe(405)
}

/** One module, with nothing left to resolve where it runs. */
async function expectSelfContained(file: string) {
  const code = await readFile(file, 'utf8')
  expect(code).not.toMatch(/^\s*import\s[^;]*from\s*["'][^"']+["']/m)
  expect(code).not.toMatch(/from\s*["']node:/)
  expect(code.length).toBeGreaterThan(50_000)
}

describe('shabd build --adapter', () => {
  it('knows its hosts', () => {
    expect([...ADAPTERS]).toEqual(['cloudflare', 'vercel', 'netlify'])
    expect(isAdapter('vercel')).toBe(true)
    expect(isAdapter('heroku')).toBe(false)
  })

  it('writes a Worker for Cloudflare Pages that answers /mcp and passes everything else on', async () => {
    const root = await built('cloudflare')
    const dist = path.join(root, 'dist')
    const worker = path.join(dist, '_worker.js')
    await expectSelfContained(worker)
    expect(JSON.parse(await readFile(path.join(dist, '_routes.json'), 'utf8'))).toEqual({ version: 1, include: ['/mcp'], exclude: [] })

    const answer = ask('cloudflare', worker, dist)
    expectDocs(answer)
    expect(answer.elsewhere).toBe(200)
  }, 120_000)

  it('writes a Build Output for Vercel: the site under static, the function beside it', async () => {
    const root = await built('vercel')
    const output = path.join(root, '.vercel', 'output')
    expect(JSON.parse(await readFile(path.join(output, 'config.json'), 'utf8'))).toEqual({ version: 3 })
    expect(existsSync(path.join(output, 'static', 'index.html'))).toBe(true)
    expect(existsSync(path.join(output, 'static', '_shabd', 'docs.json'))).toBe(true)
    const func = path.join(output, 'functions', 'mcp.func')
    expect(JSON.parse(await readFile(path.join(func, '.vc-config.json'), 'utf8'))).toEqual({ runtime: 'edge', entrypoint: 'index.js' })
    await expectSelfContained(path.join(func, 'index.js'))

    expectDocs(ask('vercel', path.join(func, 'index.js'), path.join(output, 'static')))
  }, 120_000)

  it('writes an edge function for Netlify, with its path as a literal', async () => {
    const root = await built('netlify')
    const file = path.join(root, '.netlify', 'v1', 'edge-functions', 'shabd-mcp.js')
    await expectSelfContained(file)
    // Netlify reads this line from the file's text.
    expect(await readFile(file, 'utf8')).toMatch(/\nexport const config = \{ path: "\/mcp" \};\n$/)

    const answer = ask('netlify', file, path.join(root, 'dist'))
    expectDocs(answer)
    expect(answer.config).toEqual({ path: '/mcp' })
  }, 120_000)

  it('follows the sub-path a site is served from', async () => {
    const root = await built('vercel', '/docs/')
    const output = path.join(root, '.vercel', 'output')
    expect(existsSync(path.join(output, 'static', 'docs', 'index.html'))).toBe(true)
    const func = path.join(output, 'functions', 'docs', 'mcp.func', 'index.js')
    expectDocs(ask('vercel', func, path.join(output, 'static'), '/docs/mcp'))

    const cloudflare = await built('cloudflare', '/docs/')
    expect(JSON.parse(await readFile(path.join(cloudflare, 'dist', '_routes.json'), 'utf8')).include).toEqual(['/docs/mcp'])
  }, 180_000)
})
