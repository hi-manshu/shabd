/** `features.offline`: the service worker a build writes, what it keeps, and how it answers. */
import vm from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setUpOffline } from '../src/client/app/offline.js'
import { isHashed, serviceWorker } from '../src/node/build/offline.js'
import { resolveConfig } from '../src/node/config/load.js'
import type { SiteData } from '../src/shared/types.js'
import { KEYWORD_SEARCH, temporaryBuilds } from './helpers/build.js'

const build = temporaryBuilds()

const SITE = {
  'shabd.config.yaml': `site:\n  title: Docs\n  url: https://docs.example\nfeatures:\n  offline: true\n  feed: true\n  search: { semantic: false }\n`,
  'content/index.md': '# Home\n\n```ts\nconst a = 1\n```\n',
  'content/guide/install.md': '---\ntitle: Install\ndate: 2026-11-01\n---\n\nRun it.\n',
  'public/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
}

/** What the worker's file says it keeps. */
const kept = (worker: string) => ({
  files: JSON.parse(/^const FILES = (\[.*\])$/m.exec(worker)![1]!) as string[],
  version: /^const VERSION = "([0-9a-f]{12})"$/m.exec(worker)![1]!,
  base: JSON.parse(/^const BASE = (".*")$/m.exec(worker)![1]!) as string,
})

describe('features.offline', () => {
  it('is off until a site asks for it', () => {
    const load = (yaml: string) => resolveConfig('/site', '/site/shabd.config.yaml', yaml).config.features.offline
    expect(load('site:\n  title: Docs\n')).toEqual({ enabled: false })
    expect(load('site:\n  title: Docs\nfeatures:\n  offline: true\n')).toEqual({ enabled: true })
  })

  it('tells a file named after its contents from one that can change under its name', () => {
    expect(isHashed('assets/app-B3xq9K2a.js')).toBe(true)
    expect(isHashed('_shabd/palettes.0b24503b.css')).toBe(true)
    expect(isHashed('guide/install/index.html')).toBe(false)
    expect(isHashed('_shabd/search-index.json')).toBe(false)
    expect(isHashed('logo.svg')).toBe(false)
  })
})

describe('a build of a site kept for reading offline', () => {
  it('writes a worker that names every file a reader needs, and none that only a program reads', async () => {
    const built = await build(SITE)
    expect(built.output).toMatch(/offline: \d+ files, \d+\.\d MB, fetched by a reader's browser after a first visit/)
    const worker = await built.read('shabd-sw.js')
    // It is a script on its own, and it is read by the browser as it stands.
    expect(() => new vm.Script(worker)).not.toThrow()
    expect(worker).not.toMatch(/^\s*(?:import|export)\b/m)

    const { files, base } = kept(worker)
    expect(base).toBe('/')
    for (const file of ['index.html', 'guide/install/index.html', '404.html', '_shabd/offline.html', '_shabd/search-index.json', 'logo.svg']) {
      expect(files, file).toContain(file)
    }
    expect(files.some((file) => /^assets\/.+\.js$/.test(file))).toBe(true)
    expect(files.some((file) => /^assets\/.+\.css$/.test(file))).toBe(true)
    // What agents, crawlers and feed readers read, a reader's browser has no use for. And not the worker itself.
    for (const file of ['index.md', 'guide/install.md', 'llms.txt', 'llms-full.txt', '_shabd/docs.json', 'sitemap.xml', 'robots.txt', 'rss.xml', 'shabd-sw.js']) {
      expect(built.has(file), file).toBe(true)
      expect(files, file).not.toContain(file)
    }
    // Every file it names is there to be fetched: one that is not would stop the worker from installing.
    for (const file of files) expect(built.has(file), file).toBe(true)
    expect(files).toEqual([...files].sort())

    // What a page loads only when a reader gets to it is not fetched ahead. The compiler of a live sandbox
    // is such a thing: it is in the build, the largest script there, and not in the list.
    const { readdir, stat } = await import('node:fs/promises')
    const bundled = await readdir(`${built.dir}/dist/assets`)
    const left = bundled.filter((name) => name.endsWith('.js') && !files.includes(`assets/${name}`))
    expect(left.length).toBeGreaterThan(0)
    const sizes = await Promise.all(left.map(async (name) => (await stat(`${built.dir}/dist/assets/${name}`)).size))
    expect(Math.max(...sizes)).toBeGreaterThan(100_000)
    // The search dialog and its worker are one step from every page, and are.
    expect(files.some((file) => /^assets\/SearchDialog-/.test(file))).toBe(true)
    expect(files.some((file) => /^assets\/worker-/.test(file))).toBe(true)

    // The page for an address there is no copy of: in the site's own styles, and with nothing to run.
    const page = await built.read('_shabd/offline.html')
    expect(page).toContain('There is no connection')
    expect(page).toMatch(/<link rel="stylesheet" href="\/assets\/[^"]+\.css">/)
    expect(page).not.toContain('<script type="module"')
    expect(page).toContain('<meta name="robots" content="noindex">')
    // That the app registers the worker, and that a browser then reads the site without a connection,
    // is tried in a browser: e2e/offline.spec.ts.
  })

  it('gives the copy a version that changes when a page does, and not when nothing has', async () => {
    const built = await build(SITE)
    const first = kept(await built.read('shabd-sw.js')).version
    await built.rebuild()
    expect(kept(await built.read('shabd-sw.js')).version).toBe(first)

    const { writeFile } = await import('node:fs/promises')
    await writeFile(`${built.dir}/content/guide/install.md`, '---\ntitle: Install\ndate: 2026-11-01\n---\n\nRun it twice.\n')
    await built.rebuild()
    expect(kept(await built.read('shabd-sw.js')).version).not.toBe(first)
  })

  it('answers for the folder the site is served from, and writes nothing when the feature is off', async () => {
    const under = await build({ ...SITE, 'shabd.config.yaml': SITE['shabd.config.yaml'].replace('title: Docs\n', 'title: Docs\n  base: /docs/\n') })
    const { base, files } = kept(await under.read('shabd-sw.js'))
    expect(base).toBe('/docs/')
    // Named from the folder the worker is in, whatever that folder is called on the host.
    expect(files).toContain('guide/install/index.html')
    expect(await under.read('_shabd/offline.html')).toContain('<a href="/docs/"')

    const without = await build({ ...SITE, 'shabd.config.yaml': `site:\n  title: Docs\n${KEYWORD_SEARCH}` })
    expect(without.has('shabd-sw.js')).toBe(false)
    expect(without.has('_shabd/offline.html')).toBe(false)
  })
})

describe('the app, in a reader\'s browser', () => {
  afterEach(() => vi.unstubAllGlobals())

  const site = (enabled: boolean) => ({ site: { base: '/docs/' }, features: { offline: { enabled } } }) as unknown as SiteData

  /** As much of a browser as the app touches: workers, the copies they keep, and whether the page has loaded. */
  function browser(options: { loaded?: boolean; script?: string; caches?: string[] } = {}) {
    const unregister = vi.fn(async () => true)
    const registration = options.script ? { active: { scriptURL: options.script }, unregister } : undefined
    const serviceWorker = { register: vi.fn(async () => ({})), getRegistration: vi.fn(async () => registration) }
    const waiting: (() => void)[] = []
    const stores = new Set(options.caches ?? [])
    vi.stubGlobal('navigator', { serviceWorker })
    vi.stubGlobal('document', { readyState: options.loaded === false ? 'loading' : 'complete' })
    vi.stubGlobal('window', { addEventListener: (_type: string, listener: () => void) => waiting.push(listener) })
    vi.stubGlobal('caches', { keys: async () => [...stores], delete: async (name: string) => stores.delete(name) })
    return { serviceWorker, unregister, stores, load: () => waiting.forEach((listener) => listener()) }
  }
  const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('registers the worker for the folder the site is in, once the page has loaded', () => {
    const late = browser({ loaded: false })
    setUpOffline(site(true), false)
    // The page comes first: the worker fetches the whole site.
    expect(late.serviceWorker.register).not.toHaveBeenCalled()
    late.load()
    expect(late.serviceWorker.register).toHaveBeenCalledWith('/docs/shabd-sw.js', { scope: '/docs/' })

    const loaded = browser()
    setUpOffline(site(true), false)
    expect(loaded.serviceWorker.register).toHaveBeenCalledTimes(1)
  })

  it('takes the worker away, and its copies, on a site that no longer keeps itself', async () => {
    const { serviceWorker, unregister, stores } = browser({
      script: 'https://docs.example/docs/shabd-sw.js',
      caches: ['shabd:/docs/:aaaaaaaaaaaa', 'shabd:/other/:aaaaaaaaaaaa', 'transformers-cache'],
    })
    setUpOffline(site(false), false)
    await settled()
    expect(serviceWorker.register).not.toHaveBeenCalled()
    expect(serviceWorker.getRegistration).toHaveBeenCalledWith('/docs/')
    expect(unregister).toHaveBeenCalledTimes(1)
    // This site's copies are gone. Another site's on the same host, and what is not Shabd's, are as they were.
    expect([...stores].sort()).toEqual(['shabd:/other/:aaaaaaaaaaaa', 'transformers-cache'])
  })

  it('leaves alone a worker that is not its own', async () => {
    const { unregister, stores } = browser({ script: 'https://docs.example/docs/sw.js', caches: ['workbox-precache'] })
    setUpOffline(site(false), false)
    await settled()
    expect(unregister).not.toHaveBeenCalled()
    expect([...stores]).toEqual(['workbox-precache'])
  })

  it('does nothing while shabd dev runs, or in a browser that has no workers', async () => {
    const { serviceWorker } = browser({ script: 'https://docs.example/docs/shabd-sw.js' })
    setUpOffline(site(true), true)
    setUpOffline(site(false), true)
    await settled()
    expect(serviceWorker.register).not.toHaveBeenCalled()
    expect(serviceWorker.getRegistration).not.toHaveBeenCalled()

    vi.stubGlobal('navigator', {})
    expect(() => setUpOffline(site(true), false)).not.toThrow()
  })
})

describe('the worker', () => {
  const FILES = ['404.html', '_shabd/offline.html', '_shabd/search-index.json', 'assets/app-B3xq9K2a.js', 'guide/install/index.html', 'index.html']
  const ORIGIN = 'https://docs.example'

  /** A browser, as much of one as the worker touches: caches, a network that can be cut, and the events it listens for. */
  function browser(base = '/', version = 'aaaaaaaaaaaa') {
    const stores = new Map<string, Map<string, Response>>()
    const network = { online: true, asked: [] as string[], serves: new Map<string, string>() }
    const listeners = new Map<string, (event: unknown) => void>()
    const absolute = (input: string | Request) => new URL(typeof input === 'string' ? input : input.url, ORIGIN).href
    const fetch = async (input: string | Request) => {
      const url = absolute(input)
      network.asked.push(url)
      if (!network.online) throw new TypeError('Failed to fetch')
      const body = network.serves.get(url)
      // As a host answers: with what the answer varies by. A copy has to be found whatever that says.
      return body === undefined ? new Response('not found', { status: 404 }) : new Response(body, { headers: { 'content-type': 'text/html', vary: 'Origin, Accept-Encoding' } })
    }
    const caches = {
      open: async (name: string) => {
        if (!stores.has(name)) stores.set(name, new Map())
        const store = stores.get(name)!
        return {
          addAll: async (requests: Request[]) => {
            const responses = await Promise.all(requests.map((request) => fetch(request)))
            if (responses.some((response) => !response.ok)) throw new TypeError('a file could not be fetched')
            requests.forEach((request, index) => store.set(absolute(request), responses[index]!))
          },
          // A copy whose answer varies is only found by a request that says to ignore that, as in a browser
          // where the request that is matched does not carry the headers of the one that was kept.
          match: async (input: string | Request, options?: { ignoreVary?: boolean }) => {
            const copy = store.get(absolute(input))
            return copy && (options?.ignoreVary || !copy.headers.has('vary')) ? copy.clone() : undefined
          },
          put: async (input: string | { url: string }, response: Response) => void store.set(absolute(typeof input === 'string' ? input : input.url), response),
        }
      },
      keys: async () => [...stores.keys()],
      delete: async (name: string) => stores.delete(name),
    }
    const self = {
      location: new URL(`${base}shabd-sw.js`, ORIGIN),
      addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    }
    for (const file of FILES) network.serves.set(`${ORIGIN}${base}${file}`, `the file ${file}`)
    /** A request as a worker makes one: an address without a host is on the worker's own. */
    class WorkerRequest extends Request {
      constructor(input: string | Request, init?: RequestInit) {
        super(typeof input === 'string' ? new URL(input, ORIGIN).href : input, init)
      }
    }
    vm.runInNewContext(serviceWorker(base, { files: FILES, bytes: 0, version }), { self, caches, fetch, Request: WorkerRequest, Response, URL })

    /** Send the worker an event it waits on, and wait with it. */
    const settle = async (type: string) => {
      let waited: Promise<unknown> = Promise.resolve()
      listeners.get(type)!({ waitUntil: (promise: Promise<unknown>) => (waited = promise) })
      await waited
    }
    /** Ask for an address. Undefined when the worker leaves the request to the browser. */
    const ask = async (address: string, init: { method?: string; mode?: string } = {}) => {
      let answered: Promise<Response> | undefined
      const request = { url: new URL(address, ORIGIN).href, method: init.method ?? 'GET', mode: init.mode ?? 'cors' }
      listeners.get('fetch')!({ request, respondWith: (response: Promise<Response>) => (answered = response) })
      return answered
    }
    return { stores, network, settle, ask }
  }

  it('fetches every file when it is installed, past the browser\'s own cache, and keeps them under this build\'s name', async () => {
    const { stores, network, settle } = browser()
    await settle('install')
    expect([...stores.keys()]).toEqual(['shabd:/:aaaaaaaaaaaa'])
    expect([...stores.get('shabd:/:aaaaaaaaaaaa')!.keys()].sort()).toEqual(FILES.map((file) => `${ORIGIN}/${file}`))
    expect(network.asked).toHaveLength(FILES.length)
  })

  it('does not install when a file it names cannot be fetched, so that half a site is never taken for a whole one', async () => {
    const { network, settle } = browser()
    network.serves.delete(`${ORIGIN}/guide/install/index.html`)
    await expect(settle('install')).rejects.toThrow()
  })

  it('deletes the copies of earlier builds of this site, and leaves another site\'s alone', async () => {
    const { stores, settle } = browser('/docs/', 'bbbbbbbbbbbb')
    stores.set('shabd:/docs/:aaaaaaaaaaaa', new Map())
    stores.set('shabd:/other/:aaaaaaaaaaaa', new Map())
    stores.set('transformers-cache', new Map())
    await settle('install')
    await settle('activate')
    expect([...stores.keys()].sort()).toEqual(['shabd:/docs/:bbbbbbbbbbbb', 'shabd:/other/:aaaaaaaaaaaa', 'transformers-cache'])
  })

  it('asks the network for a page first, and answers from its copy when the network does not', async () => {
    const { network, settle, ask } = browser()
    await settle('install')
    network.serves.set(`${ORIGIN}/guide/install/index.html`, 'published since')
    network.asked.length = 0

    // With a connection: what is published now, at whichever of its addresses is asked for.
    expect(await (await ask('/guide/install', { mode: 'navigate' }))!.text()).toBe('not found')
    network.serves.set(`${ORIGIN}/guide/install`, 'published since')
    expect(await (await ask('/guide/install', { mode: 'navigate' }))!.text()).toBe('published since')

    // Without one: the copy, for the address with a slash, without one, or with the file's name.
    network.online = false
    for (const address of ['/guide/install', '/guide/install/', '/guide/install/index.html', '/guide/install?tab=2']) {
      expect(await (await ask(address, { mode: 'navigate' }))!.text(), address).toBe('the file guide/install/index.html')
    }
    expect(await (await ask('/', { mode: 'navigate' }))!.text()).toBe('the file index.html')
    expect(await (await ask('/_shabd/search-index.json'))!.text()).toBe('the file _shabd/search-index.json')
  })

  it('answers a file named after its contents from its copy, without asking the network', async () => {
    const { network, settle, ask } = browser()
    await settle('install')
    network.asked.length = 0
    expect(await (await ask('/assets/app-B3xq9K2a.js'))!.text()).toBe('the file assets/app-B3xq9K2a.js')
    expect(network.asked).toEqual([])
  })

  it('keeps a file named after its contents from the first time it is asked for, when it was not fetched ahead', async () => {
    const { network, settle, ask } = browser()
    await settle('install')
    // The library that draws diagrams, say: megabytes that only the pages with a diagram load.
    network.serves.set(`${ORIGIN}/assets/mermaid-gM1ax966.js`, 'the diagram library')
    network.serves.set(`${ORIGIN}/guide/later.png`, 'a picture')
    expect(await (await ask('/assets/mermaid-gM1ax966.js'))!.text()).toBe('the diagram library')
    expect(await (await ask('/guide/later.png'))!.text()).toBe('a picture')

    network.online = false
    network.asked.length = 0
    // Kept, and answered without the network from now on.
    expect(await (await ask('/assets/mermaid-gM1ax966.js'))!.text()).toBe('the diagram library')
    expect(network.asked).toEqual([])
    // A file that can change under its name is not kept this way: the copy is one build, whole.
    expect((await ask('/guide/later.png'))!.type).toBe('error')
    // Nor is an answer that says the file is not there.
    network.online = true
    expect((await ask('/assets/gone-00000000.js'))!.status).toBe(404)
    network.online = false
    expect((await ask('/assets/gone-00000000.js'))!.type).toBe('error')
  })

  it('says so, without a connection, when it has no copy of the page that was asked for', async () => {
    const { network, settle, ask } = browser()
    await settle('install')
    network.online = false
    const page = (await ask('/guide/nowhere', { mode: 'navigate' }))!
    expect(page.status).toBe(503)
    expect(await page.text()).toBe('the file _shabd/offline.html')
    // Anything that is not a page fails as it would without the worker: as a request that got no answer.
    expect((await ask('/guide/nowhere.png'))!.type).toBe('error')
  })

  it('leaves alone what is not this site\'s to answer: another host, another folder, anything but reading', async () => {
    const { settle, ask } = browser('/docs/')
    await settle('install')
    expect(await ask('https://api.example/v1/items')).toBeUndefined()
    expect(await ask('/other/index.html')).toBeUndefined()
    expect(await ask('/docs/guide/install', { method: 'POST' })).toBeUndefined()
    expect(await ask('/docs/guide/install', { mode: 'navigate' })).toBeDefined()
  })
})
