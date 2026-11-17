import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, normalizePath, type Plugin, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createContext, type ShabdContext } from '../src/node/context.js'
import { shabd } from '../src/node/vite/plugin.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(here, '..', '..', '..', 'e2e', 'site')
// Inside the repository, so that the site finds React and the other packages it needs.
const TMP = path.join(here, '.tmp')
const ROUTES = '\0virtual:shabd/routes'
const DATA = '\0virtual:shabd/data'

let scratch: string
let context: ShabdContext
let server: ViteDevServer

/** While set, the requests for these modules stop half way: after their text was made, before Vite keeps it. */
let gate: { ids: Set<string>; missing: Set<string>; open: Promise<void>; reached: () => void } | undefined

const holdsRequests: Plugin = {
  name: 'test:hold-requests',
  async transform(_code, id) {
    const held = gate
    if (!held?.ids.has(id)) return null
    held.missing.delete(id)
    if (held.missing.size === 0) held.reached()
    await held.open
    return null
  },
}

/** Hold the next requests for these modules. `reached` settles when a request for each has got that far. */
function hold(...ids: string[]) {
  let release!: () => void
  let reached!: () => void
  const open = new Promise<void>((resolve) => (release = resolve))
  const arrived = new Promise<void>((resolve) => (reached = resolve))
  gate = { ids: new Set(ids), missing: new Set(ids), open, reached }
  return {
    reached: arrived,
    release() {
      gate = undefined
      release()
    },
  }
}

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

async function until(done: () => boolean): Promise<void> {
  for (let waited = 0; waited < 5000 && !done(); waited += 5) await tick(5)
  if (!done()) throw new Error('The dev server did not follow the change.')
  // The module is sent again in the same step as the page list changes; one turn later it has been.
  await tick()
}

/** What the browser gets when it asks for a module now. */
async function request(id: string): Promise<string> {
  const result = await server.environments.client.transformRequest(id)
  if (!result) throw new Error(`Nothing was served for ${id}.`)
  return result.code
}

const fileOf = (id: string) => path.join(context.config.contentDir, ...id.split('/'))

/** A page appears on disk, and the dev server is told as its file watcher would tell it. */
async function addPage(id: string): Promise<void> {
  await writeFile(fileOf(id), `---\ntitle: ${id}\n---\n\nText.\n`)
  server.watcher.emit('add', normalizePath(fileOf(id)))
  await until(() => context.store.byId(id) !== undefined)
}

async function removePage(id: string): Promise<void> {
  await rm(fileOf(id))
  server.watcher.emit('unlink', normalizePath(fileOf(id)))
  await until(() => context.store.byId(id) === undefined)
}

beforeAll(async () => {
  await mkdir(TMP, { recursive: true })
  scratch = await mkdtemp(path.join(TMP, 'hot-'))
  const root = path.join(scratch, 'site')
  await cp(FIXTURE, root, { recursive: true })
  context = await createContext(root, { dev: true })
  server = await createServer({
    configFile: false,
    root,
    logLevel: 'silent',
    plugins: [shabd({ context }), holdsRequests],
    // The test says what changed. A watcher would say it a second time, whenever it got to it.
    server: { watch: null },
  })
  // The modules are in Vite's graph, with a result it has kept, as after a page was opened.
  await request(ROUTES)
  await request(DATA)
})

afterAll(async () => {
  gate = undefined
  await server?.close()
  await rm(scratch, { recursive: true, force: true })
})

describe('the page list in dev', () => {
  it('follows a page that is added and one that is removed', async () => {
    await addPage('guide/plain.md')
    expect(await request(ROUTES)).toContain('"/guide/plain"')
    expect(await request(DATA)).toContain('"/guide/plain"')

    await removePage('guide/plain.md')
    expect(await request(ROUTES)).not.toContain('"/guide/plain"')
    expect(await request(DATA)).not.toContain('"/guide/plain"')
  })

  it('does not keep a list that was being written while a page was added', async () => {
    await addPage('guide/first.md')
    // The browser asks for the list. The request has read the pages and is not finished.
    const held = hold(ROUTES, DATA)
    const early = Promise.all([request(ROUTES), request(DATA)])
    await held.reached

    await addPage('guide/second.md')
    held.release()
    const [routes, data] = await early
    expect(routes).toContain('"/guide/first"')
    expect(data).toContain('"/guide/first"')

    // What is asked for after the second page was added has the second page.
    expect(await request(ROUTES)).toContain('"/guide/second"')
    expect(await request(DATA)).toContain('"/guide/second"')
  })

  it('answers a request that arrives while an older one is still being written with the list as it is', async () => {
    await addPage('guide/third.md')
    const held = hold(ROUTES, DATA)
    const early = Promise.all([request(ROUTES), request(DATA)])
    await held.reached

    await addPage('guide/fourth.md')
    const late = Promise.all([request(ROUTES), request(DATA)])
    // Let the later requests get as far as they go on their own before anything is let through.
    await tick(20)
    held.release()
    await early
    const [routes, data] = await late
    expect(routes).toContain('"/guide/fourth"')
    expect(data).toContain('"/guide/fourth"')
  })

  it('numbers what it sends, so that the browser can tell which of two answers is the newer', async () => {
    const number = (code: string) => Number(/export const revision = (\d+)/.exec(code)?.[1])
    const before = [number(await request(ROUTES)), number(await request(DATA))]
    await addPage('guide/fifth.md')
    const after = [number(await request(ROUTES)), number(await request(DATA))]
    expect(after[0]).toBeGreaterThan(before[0]!)
    expect(after[1]).toBeGreaterThan(before[1]!)
  })
})
