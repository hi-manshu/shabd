/** `openapi:` in the config: the pages of a description as pages of the site. */
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createServer, type ViteDevServer } from 'vite'
import { afterEach, describe, expect, it } from 'vitest'
import { collectProblems } from '../src/node/check.js'
import { resolveConfig } from '../src/node/config/load.js'
import { compilePage, createContext } from '../src/node/context.js'
import { renderLlmsTxt } from '../src/node/llms/llms-txt.js'
import { shabd } from '../src/node/vite/plugin.js'
import type { SidebarNode } from '../src/shared/types.js'
import { KEYWORD_SEARCH, temporaryBuilds, WORK } from './helpers/build.js'
import { failure, temporarySites } from './helpers/site.js'

const site = temporarySites()
const build = temporaryBuilds()

const PETSTORE = `openapi: 3.1.0
info:
  title: Petstore
  version: 1.0.0
  description: Pets, and {{name}} in braces.
servers:
  - url: https://api.petstore.example/v1
tags:
  - name: Pets
  - name: Store
paths:
  /pets:
    get:
      operationId: listPets
      summary: List pets
      tags: [Pets]
      responses:
        '200': { description: The pets. }
    post:
      operationId: addPet
      summary: Add a pet
      tags: [Pets]
      requestBody:
        content:
          application/json:
            schema: { type: object, properties: { name: { type: string } } }
      responses:
        '201': { description: Made. }
  /orders:
    get:
      operationId: listOrders
      summary: List orders
      tags: [Store]
      responses:
        '200': { description: The orders. }
  /health:
    get:
      summary: Health
      responses:
        '200': { description: Up. }
`

const CONFIG = 'site:\n  title: Docs\nopenapi:\n  spec: ./petstore.yaml\n'
const SITE = { 'shabd.config.yaml': CONFIG, 'petstore.yaml': PETSTORE, 'content/index.md': '# Home\n', 'content/guide/intro.md': '# Intro\n' }

/** Compact rendering of a sidebar, for readable assertions. */
function outline(nodes: SidebarNode[], depth = 0): string[] {
  return nodes.flatMap((node) => {
    const pad = '  '.repeat(depth)
    if (node.type === 'group') return [`${pad}${node.label} (${node.kind})`, ...outline(node.items, depth + 1)]
    return [`${pad}${node.label} → ${node.type === 'page' ? node.path : node.href}`]
  })
}

describe('openapi in the config', () => {
  const load = (yaml: string) => resolveConfig('/site', '/site/shabd.config.yaml', yaml)

  it('names one description or several, each with the address its pages go at', async () => {
    const dir = await site({ ...SITE, 'orders.json': '{}' })
    const one = resolveConfig(dir, path.join(dir, 'shabd.config.yaml'), CONFIG)
    expect(one.openapi).toEqual([{ spec: path.join(dir, 'petstore.yaml'), prefix: '/api', try: false }])
    // Where the pages are written: in the site folder, and not under node_modules.
    expect(one.generatedDir).toBe(path.join(dir, '.shabd', 'openapi'))

    const several = resolveConfig(
      dir,
      path.join(dir, 'shabd.config.yaml'),
      'site:\n  title: Docs\nopenapi:\n  - { spec: petstore.yaml, path: /reference/pets/, try: true }\n  - { spec: ./orders.json, path: /reference/orders }\n',
    )
    expect(several.openapi).toEqual([
      { spec: path.join(dir, 'petstore.yaml'), prefix: '/reference/pets', try: true },
      { spec: path.join(dir, 'orders.json'), prefix: '/reference/orders', try: false },
    ])
    expect(resolveConfig(dir, path.join(dir, 'shabd.config.yaml'), 'site:\n  title: Docs\n').openapi).toEqual([])
  })

  it('reports a description that is not there, and addresses that are the same or one inside the other, where they are written', () => {
    const missing = failure(() => load('site:\n  title: Docs\nopenapi:\n  spec: ./nowhere.yaml\n'))
    expect(missing.issues[0]).toMatchObject({ path: ['openapi', 'spec'], line: 4 })
    expect(missing.issues[0]?.message).toContain('File not found: ./nowhere.yaml')

    const listed = failure(() => load('site:\n  title: Docs\nopenapi:\n  - spec: shabd.config.yaml\n  - spec: ./nowhere.yaml\n'))
    expect(listed.issues.map((issue) => [issue.path.join('.'), issue.line])).toContainEqual(['openapi.1.spec', 5])

    const twice = failure(() =>
      load('site:\n  title: Docs\nopenapi:\n  - { spec: a.yaml, path: /api }\n  - { spec: b.yaml, path: /api/ }\n  - { spec: c.yaml, path: /api/v2 }\n'),
    )
    const said = twice.issues.map((issue) => issue.message).join('\n')
    expect(said).toContain('Two descriptions have their pages at /api.')
    expect(said).toContain('/api/v2 and /api are one inside the other')

    const address = failure(() => load('site:\n  title: Docs\nopenapi:\n  spec: a.yaml\n  path: api\n'))
    expect(address.issues[0]).toMatchObject({ path: ['openapi', 'path'], line: 5 })
    expect(address.issues[0]?.message).toContain('starting with a slash')
  })
})

describe('a site with a description', () => {
  it('has the pages of the description among its own, at the address the config gives', async () => {
    const dir = await site({ ...SITE, 'shabd.config.yaml': `${CONFIG}vars:\n  name: SUBSTITUTED\n` })
    const context = await createContext(dir, { dev: false })
    const { store } = context
    expect(store.pages().map((page) => page.path)).toEqual([
      '/',
      '/api',
      '/api/get-health',
      '/api/pets/add-pet',
      '/api/pets/list-pets',
      '/api/store/list-orders',
      '/guide/intro',
    ])

    const listed = store.byPath('/api/pets/list-pets')!
    expect(listed).toMatchObject({ id: 'api/pets/list-pets.md', title: 'List pets', generated: 'petstore.yaml', format: 'md' })
    expect(listed.file).toBe(path.join(dir, '.shabd', 'openapi', 'api', 'pets', 'list-pets.md'))
    expect(listed.frontmatter).toMatchObject({ layout: 'api', editLink: false, api: { method: 'GET', path: '/pets', try: false } })
    // A page written by hand is not marked.
    expect(store.byPath('/guide/intro')?.generated).toBeUndefined()
    expect(store.owns(listed.file)).toBe(true)
    expect(store.idOf(listed.file)).toBe('api/pets/list-pets.md')
    expect(store.byFile(listed.file)).toBe(listed)

    // The description is somebody else's text: the site's variables are not filled into it.
    const overview = store.byPath('/api')!
    expect(overview.title).toBe('Petstore')
    expect(overview.source).not.toContain('SUBSTITUTED')
    expect(overview.notes).toEqual([])

    // They compile and are checked like any page, and the browser is told which ones they are.
    expect((await compilePage(context, listed)).code).toContain('Responses')
    expect(await collectProblems(context)).toEqual({ problems: [], detailed: [] })
    const data = store.siteData({ dev: false })
    expect(data.pages['/api/pets/list-pets']).toMatchObject({ id: 'api/pets/list-pets.md', generated: true })
    expect(data.pages['/guide/intro']).not.toHaveProperty('generated')
    // And so are llms.txt and everything else that reads pages.
    expect(renderLlmsTxt(context)).toContain('[List pets](/api/pets/list-pets.md)')
  })

  it('lists them in the sidebar as the description has them: the overview, then each tag in its order', async () => {
    // With no sidebar.yaml, the API is a part of the site like a folder, called what its description calls it.
    const generated = await createContext(await site(SITE), { dev: false })
    expect(outline(generated.store.sidebar.sidebar)).toEqual([
      'Guide (category)',
      '  Intro → /guide/intro',
      'Petstore (category)',
      '  Petstore → /api',
      '  Pets (folder)',
      // In the order the description has them, not by name.
      '    List pets → /api/pets/list-pets',
      '    Add a pet → /api/pets/add-pet',
      '  Store (folder)',
      '    List orders → /api/store/list-orders',
      '  Other (folder)',
      '    Health → /api/get-health',
    ])
    expect(generated.store.sidebar.unlisted).toEqual([])

    // Under a heading of the site's own, and with a page the site keeps in the same folder after the API's.
    const mixed = await createContext(
      await site({
        ...SITE,
        'sidebar.yaml': '- category: Reference\n  autogenerate: api\n- category: Guide\n  items: [guide/intro]\n',
        'content/api/changelog.md': '# Changelog\n',
      }),
      { dev: false },
    )
    expect(outline(mixed.store.sidebar.sidebar)).toEqual([
      'Reference (category)',
      '  Petstore → /api',
      '  Pets (folder)',
      '    List pets → /api/pets/list-pets',
      '    Add a pet → /api/pets/add-pet',
      '  Store (folder)',
      '    List orders → /api/store/list-orders',
      '  Other (folder)',
      '    Health → /api/get-health',
      '  Changelog → /api/changelog',
      'Guide (category)',
      '  Intro → /guide/intro',
    ])
    expect(mixed.store.sidebar.warnings).toEqual([])

    // A sidebar of its own, on a site with several.
    const parts = await createContext(
      await site({ ...SITE, 'sidebar.yaml': '/api/:\n  - category: API\n    autogenerate: api\n/:\n  - guide/intro\n' }),
      { dev: false },
    )
    expect(outline(parts.store.sidebar.sidebar)).toEqual(['Intro → /guide/intro'])
    expect(parts.store.sidebar.sections.map((section) => [section.prefix, outline(section.sidebar)[0]])).toEqual([['/api', 'API (category)']])
    expect(outline(parts.store.sidebar.sections[0]!.sidebar)).toContain('    Add a pet → /api/pets/add-pet')
  })

  it('lists the operations of a description without tags under the API itself, with no folder between', async () => {
    const untagged = PETSTORE.replace(/^tags:\n  - name: Pets\n  - name: Store\n/m, '').replace(/^      tags: \[\w+\]\n/gm, '')
    const context = await createContext(await site({ ...SITE, 'petstore.yaml': untagged }), { dev: false })
    expect(outline(context.store.sidebar.sidebar).slice(2)).toEqual([
      'Petstore (category)',
      '  Petstore → /api',
      '  List pets → /api/list-pets',
      '  Add a pet → /api/add-pet',
      '  List orders → /api/list-orders',
      '  Health → /api/get-health',
    ])
  })

  it('offers each request to be tried when the config asks for it', async () => {
    const dir = await site({ ...SITE, 'shabd.config.yaml': 'site:\n  title: Docs\nopenapi:\n  spec: petstore.yaml\n  path: /pets-api\n  try: true\n' })
    const { store } = await createContext(dir, { dev: false })
    expect(store.byPath('/pets-api/pets/add-pet')?.frontmatter.api).toMatchObject({
      method: 'POST',
      try: true,
      baseUrl: 'https://api.petstore.example/v1',
      // The form starts from the example of the body, as a value.
      body: { name: expect.any(String) },
    })
    // A request that carries nothing has nothing to start from.
    expect(store.byPath('/pets-api/pets/list-pets')?.frontmatter.api).not.toHaveProperty('body')
    expect(store.byPath('/api')).toBeUndefined()

    // Without `try`, a page says nothing of a body: nothing would read it.
    const plain = await createContext(await site(SITE), { dev: false })
    expect(plain.store.byPath('/api/pets/add-pet')?.frontmatter.api).not.toHaveProperty('body')
  })

  it('stops on a description that cannot be read, with the line that is wrong', async () => {
    const swagger = await site({ ...SITE, 'petstore.yaml': 'swagger: "2.0"\ninfo:\n  title: Old\n' })
    const refused = await createContext(swagger, { dev: false }).then(
      () => undefined,
      (error: unknown) => error as { file: string; issues: { message: string; line?: number }[] },
    )
    expect(refused?.file).toBe(path.join(swagger, 'petstore.yaml'))
    expect(refused?.issues[0]?.line).toBe(1)
    expect(refused?.issues[0]?.message).toMatch(/convert/i)
    // Nothing was written for it.
    expect(existsSync(path.join(swagger, '.shabd', 'openapi'))).toBe(false)
  })

  it('reports what a description holds that its pages cannot show, and counts what is past the first few', async () => {
    const callbacks = Array.from({ length: 20 }, (_, index) => `  /hooks/${index}:\n    post:\n      summary: Hook ${index}\n      callbacks:\n        done: {}\n      responses:\n        '200': { description: Fine. }\n`).join('')
    const dir = await site({ ...SITE, 'petstore.yaml': PETSTORE + callbacks })
    const context = await createContext(dir, { dev: false })
    const { problems } = await collectProblems(context)
    const notes = problems.filter((problem) => problem.rule === 'openapi')
    expect(notes.every((note) => note.level === 'note' && note.file === 'petstore.yaml')).toBe(true)
    expect(notes).toHaveLength(13)
    expect(notes[0]?.message).toMatch(/callback/i)
    expect(notes.at(-1)?.message).toBe('8 more parts of this description could not be shown either.')
    expect(context.store.apis[0]?.notes).toHaveLength(20)
  })

  it('writes a page again only when its text has changed, and takes away the pages of what is gone', async () => {
    const dir = await site(SITE)
    const context = await createContext(dir, { dev: false })
    const file = (slug: string) => path.join(dir, '.shabd', 'openapi', 'api', `${slug}.md`)
    const written = async (slug: string) => (await stat(file(slug))).mtimeMs
    const before = { listed: await written('pets/list-pets'), added: await written('pets/add-pet') }

    // One summary changes, one operation goes and one is new.
    await new Promise((resolve) => setTimeout(resolve, 20))
    await writeFile(
      path.join(dir, 'petstore.yaml'),
      PETSTORE.replace('summary: Add a pet', 'summary: Add one pet')
        .replace(/  \/health:[\s\S]*$/, '')
        .concat("  /pets/{id}:\n    get:\n      operationId: getPet\n      summary: Get a pet\n      tags: [Pets]\n      responses:\n        '200': { description: The pet. }\n"),
    )
    const { added, changed, removed } = await context.store.regenerate()
    expect(added.map((page) => page.path)).toEqual(['/api/pets/get-pet'])
    // The overview lists every operation, so it changed too.
    expect(changed.map((page) => page.path).sort()).toEqual(['/api', '/api/pets/add-pet'])
    expect(removed.map((page) => page.path)).toEqual(['/api/get-health'])

    expect(await written('pets/list-pets')).toBe(before.listed)
    expect(await written('pets/add-pet')).toBeGreaterThan(before.added)
    expect(existsSync(file('get-health'))).toBe(false)
    expect(context.store.byPath('/api/get-health')).toBeUndefined()
    expect(context.store.byPath('/api/pets/add-pet')?.title).toBe('Add one pet')
    expect(outline(context.store.sidebar.sidebar)).toContain('    Get a pet → /api/pets/get-pet')

    // A site that no longer names a description loses its pages the next time it is read.
    await writeFile(path.join(dir, 'shabd.config.yaml'), 'site:\n  title: Docs\n')
    const without = await createContext(dir, { dev: false })
    expect(without.store.pages().map((page) => page.path)).toEqual(['/', '/guide/intro'])
    expect(existsSync(file('pets/list-pets'))).toBe(false)
  })

  it('says so when a page of the site has the address of a page of the API', async () => {
    const dir = await site({ ...SITE, 'content/api/index.md': '# Our API\n' })
    await expect(createContext(dir, { dev: false })).rejects.toThrow(/Two pages map to the same URL \/api/)
  })
})

describe('a built site with a description', () => {
  it('has a page for each operation, without a link to edit it, and holds them in what it writes for search and for agents', async () => {
    const built = await build({
      ...SITE,
      'shabd.config.yaml': `site:\n  title: Docs\n  url: https://docs.example\n  repo: https://github.com/example/docs\nopenapi:\n  spec: petstore.yaml\n  try: true\n${KEYWORD_SEARCH}`,
    })
    const page = await built.read('api/pets/add-pet/index.html')
    expect(page).toContain('<span class="sb-api-method">POST</span>')
    expect(page).toContain('>Try it</button>')
    // There is no file of the page in the repository to send a reader to.
    expect(page).not.toContain('Edit this page')
    expect(await built.read('guide/intro/index.html')).toContain('Edit this page')
    // The sidebar of every page has the API in the description's order.
    expect(page.indexOf('>List pets<')).toBeLessThan(page.indexOf('>Add a pet<'))

    expect(await built.read('llms.txt')).toContain('- [Add a pet](https://docs.example/api/pets/add-pet.md)')
    expect(await built.read('api/pets/add-pet.md')).toContain('curl --request POST')
    expect(await built.read('_shabd/search-index.json')).toContain('/api/pets/add-pet')
    expect(await built.read('sitemap.xml')).toContain('<loc>https://docs.example/api/store/list-orders</loc>')
  })
})

describe('the dev server and a description', () => {
  let dir: string
  let server: ViteDevServer | undefined
  afterEach(async () => {
    await server?.close()
    server = undefined
    await rm(dir, { recursive: true, force: true })
  })

  it('makes the pages again when the description changes, and keeps them when it cannot be read', async () => {
    await mkdir(WORK, { recursive: true })
    dir = await mkdtemp(path.join(WORK, 'openapi-'))
    for (const [name, contents] of Object.entries(SITE)) {
      await mkdir(path.dirname(path.join(dir, name)), { recursive: true })
      await writeFile(path.join(dir, name), contents)
    }
    const context = await createContext(dir, { dev: true })
    server = await createServer({
      configFile: false,
      root: dir,
      logLevel: 'silent',
      plugins: [shabd({ context })],
      // A change is what the test reports, and nothing else.
      server: { watch: null },
      optimizeDeps: { noDiscovery: true, include: [] },
    })
    const spec = path.join(dir, 'petstore.yaml')
    const save = async (text: string) => {
      await writeFile(spec, text)
      server!.watcher.emit('change', spec)
    }
    const titles = () => context.store.pages().map((page) => page.title)

    await save(PETSTORE.replace('summary: List pets', 'summary: Every pet'))
    await expect.poll(titles).toContain('Every pet')
    expect(await readFile(path.join(dir, '.shabd', 'openapi', 'api', 'pets', 'list-pets.md'), 'utf8')).toContain('title: Every pet')

    // Half-typed: the pages there were stay, and come up to date when the description can be read again.
    await save(`${PETSTORE}\n  not: [closed\n`)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(titles()).toContain('Every pet')
    await save(PETSTORE.replace('summary: List pets', 'summary: All the pets'))
    await expect.poll(titles).toContain('All the pets')
    expect(titles()).not.toContain('Every pet')
  })
})
