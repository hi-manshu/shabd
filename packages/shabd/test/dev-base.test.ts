import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hideBase, restoreBase } from '../src/node/vite/dev-html.js'
import { shabd } from '../src/node/vite/plugin.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(here, '..', '..', '..', 'e2e', 'site')
// Inside the repository, so that the site finds React and the other packages it needs.
const TMP = path.join(here, '.tmp')

let scratch: string
let server: ViteDevServer
let origin: string

const page = (route: string) => fetch(`${origin}${route}`, { headers: { accept: 'text/html' } })

beforeAll(async () => {
  await mkdir(TMP, { recursive: true })
  scratch = await mkdtemp(path.join(TMP, 'base-'))
  const root = path.join(scratch, 'site')
  await cp(FIXTURE, root, { recursive: true })
  // The site as a project page on GitHub Pages has it: under a folder of the host.
  const file = path.join(root, 'shabd.config.yaml')
  await writeFile(file, (await readFile(file, 'utf8')).replace('  title: Fixture\n', '  title: Fixture\n  base: /docs/\n'))
  server = await createServer({
    configFile: false,
    root,
    logLevel: 'silent',
    plugins: [shabd({ root })],
    // Whichever port is free.
    server: { port: 0, host: '127.0.0.1', watch: null },
  })
  await server.listen()
  origin = `http://127.0.0.1:${(server.httpServer!.address() as AddressInfo).port}`
})

afterAll(async () => {
  await server?.close()
  await rm(scratch, { recursive: true, force: true })
})

describe('shabd dev for a site with a base', () => {
  it('writes each address of the page under the base once, and serves what they name', async () => {
    const response = await page('/docs/guide/intro')
    expect(response.status).toBe(200)
    const html = await response.text()

    // Before, Vite put the base in front of addresses that had it: /docs/docs/favicon.svg.
    expect(html).not.toContain('/docs/docs/')
    expect(html).not.toContain('shabd-base.invalid')

    const addresses = [...html.matchAll(/\s(?:src|href)="(\/[^"/][^"]*)"/g)].map((match) => match[1]!)
    const entry = addresses.find((address) => address.endsWith('/entry-client.tsx'))
    expect(entry).toMatch(/^\/docs\/@fs\//)
    expect(addresses).toContain('/docs/favicon.svg')
    expect(addresses).toContain('/docs/@vite/client')
    for (const address of addresses) {
      expect(address.startsWith('/docs/'), address).toBe(true)
      expect((await fetch(`${origin}${address}`)).status, address).toBe(200)
    }
  })

  it('serves the modules the page starts from', async () => {
    const data = await fetch(`${origin}/docs/@id/__x00__virtual:shabd/data`)
    expect(data.status).toBe(200)
    expect(await data.text()).toContain('"base":"/docs/"')
    const routes = await (await fetch(`${origin}/docs/@id/__x00__virtual:shabd/routes`)).text()
    expect(routes).toContain('"/guide/intro"')
  })

  it('answers 404 for an address that is not a page, with the app to show it', async () => {
    const response = await page('/docs/no/such/page')
    expect(response.status).toBe(404)
    expect(await response.text()).toContain('/docs/@fs/')
  })
})

describe('hiding the base from Vite', () => {
  const html = '<link rel="icon" href="/docs/favicon.svg">\n<a href=\'/docs/\'>Home</a>\n<script type="module" src="/docs/@fs/app.tsx"></script>\n<p>/docs/ in text</p>'

  it('changes only attributes that start with the base, and gives back what it was given', () => {
    const hidden = hideBase(html, '/docs/')
    expect(hidden).not.toMatch(/=["']\/docs\//)
    expect(hidden).toContain('<p>/docs/ in text</p>')
    expect(restoreBase(hidden, '/docs/')).toBe(html)
  })

  it('reads the base as text, whatever characters it has', () => {
    const odd = '<link href="/a.b+c/x.css"><link href="/aXb+c/x.css">'
    const hidden = hideBase(odd, '/a.b+c/')
    expect(hidden).toContain('href="/aXb+c/x.css"')
    expect(restoreBase(hidden, '/a.b+c/')).toBe(odd)
  })

  it('leaves a site at the root alone', () => {
    expect(hideBase(html, '/')).toBe(html)
    expect(restoreBase(html, '/')).toBe(html)
  })
})
