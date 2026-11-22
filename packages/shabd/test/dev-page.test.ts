/** The page the dev server answers with: Shabd's document, and what the dev server adds to it. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { createServer, type ViteDevServer } from 'vite'
import { afterEach, describe, expect, it } from 'vitest'
import { createContext } from '../src/node/context.js'
import { shabd } from '../src/node/vite/plugin.js'
import { KEYWORD_SEARCH, WORK } from './helpers/build.js'

describe('the page the dev server answers with', () => {
  let dir: string
  let server: ViteDevServer | undefined

  /** Start a site on a port of its own, and give back where it listens. */
  const start = async (site: string) => {
    await mkdir(WORK, { recursive: true })
    dir = await mkdtemp(path.join(WORK, 'dev-page-'))
    const files = {
      'shabd.config.yaml': `site:\n  title: Docs\n  url: https://docs.example.com\n  favicon: /favicon.svg\n${site}  head:\n    - { tag: link, attrs: { rel: preconnect, href: /fonts/list.css } }\n${KEYWORD_SEARCH}  feed: true\n`,
      'content/index.md': '# Home\n',
      'content/guide.md': '# Guide\n',
      'public/favicon.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
    }
    for (const [name, contents] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(dir, name)), { recursive: true })
      await writeFile(path.join(dir, name), contents)
    }
    const context = await createContext(dir, { dev: true })
    server = await createServer({
      configFile: false,
      root: dir,
      logLevel: 'silent',
      plugins: [shabd({ context })],
      server: { watch: null, host: '127.0.0.1', port: 0 },
      optimizeDeps: { noDiscovery: true, include: [] },
    })
    await server.listen()
    return `http://127.0.0.1:${(server.httpServer!.address() as AddressInfo).port}`
  }
  afterEach(async () => {
    await server?.close()
    server = undefined
    await rm(dir, { recursive: true, force: true })
  })

  /** Every address the page's tags name. */
  const addresses = async (url: string) => {
    const html = await (await fetch(url, { headers: { accept: 'text/html' } })).text()
    return { html, named: [...html.matchAll(/\s(?:src|href)="([^"]*)"/g)].map((match) => match[1]!) }
  }

  it('names everything once under the base, on a site that has one', async () => {
    const origin = await start('  base: /docs/\n')
    const { html, named } = await addresses(`${origin}/docs/guide`)

    // The base was once there twice: the entry was not found, and the page stayed empty.
    expect(named.filter((address) => address.includes('/docs/docs/'))).toEqual([])
    // Shabd's own tags, and the site's.
    expect(named).toContain('/docs/favicon.svg')
    expect(named).toContain('/docs/rss.xml')
    expect(named).toContain('/docs/llms.txt')
    expect(named).toContain('/docs/fonts/list.css')
    expect(named).toContain('https://docs.example.com/docs/guide')
    // What the dev server adds: its client, React's preamble, and the app.
    expect(named).toContain('/docs/@vite/client')
    expect(html).toContain('/docs/@react-refresh')
    const entry = named.find((address) => address.endsWith('/entry-client.tsx'))
    expect(entry).toMatch(/^\/docs\/@fs\//)

    // The server has what the page asks for.
    const script = await fetch(`${origin}${entry}`)
    expect(script.status).toBe(200)
    expect(script.headers.get('content-type')).toContain('javascript')
    // The preamble is before the app, which needs it.
    expect(html.indexOf('@react-refresh')).toBeLessThan(html.indexOf('entry-client.tsx'))
    expect(html).toContain('<div id="app"></div>')
  })

  it('names the same without a base', async () => {
    const origin = await start('')
    const { html, named } = await addresses(`${origin}/guide`)
    expect(named).toContain('/favicon.svg')
    expect(named).toContain('/@vite/client')
    expect(html).toContain('/@react-refresh')
    const entry = named.find((address) => address.endsWith('/entry-client.tsx'))
    expect(entry).toMatch(/^\/@fs\//)
    expect((await fetch(`${origin}${entry}`)).status).toBe(200)
  })
})
