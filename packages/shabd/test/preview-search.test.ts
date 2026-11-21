/**
 * `shabd preview` answering `search_docs` over HTTP from a real build: by
 * meaning where the build has vectors, by keyword where the endpoint is
 * kept to that.
 *
 * The embedding model is replaced by a stand-in for this file, so nothing
 * is downloaded. e2e/semantic.spec.ts asks the same of the real model.
 */
import { readFile, utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { preview } from '../src/node/build/preview.js'
import { embeddingInput } from '../src/node/search/chunk.js'
import { quantize, type SearchIndexFile } from '../src/shared/search-core.js'
import { KEYWORD_SEARCH, temporaryBuilds, type BuiltSite } from './helpers/build.js'

/** Two directions: text about putting a site online, and text about anything else. */
const stand = vi.hoisted(() => {
  const ONLINE = ['host', 'hosting', 'upload', 'publish', 'online', 'deploy', 'website']
  const vectorOf = (text: string): Float32Array => {
    const words = text.toLowerCase().match(/[a-z]+/g) ?? []
    const online = words.filter((word) => ONLINE.includes(word)).length
    return new Float32Array(online ? [1, 0] : [0, 0])
  }
  return { vectorOf, loads: [] as string[] }
})

vi.mock('../src/node/search/embed.js', async (original) => ({
  ...(await original<typeof import('../src/node/search/embed.js')>()),
  loadEmbedder: async (model: string) => {
    stand.loads.push(model)
    return { model, dims: 2, embed: async (texts: string[]) => texts.map(stand.vectorOf) }
  },
}))

const build = temporaryBuilds()
const servers: { close(): Promise<void> }[] = []
afterAll(() => Promise.all(servers.map((server) => server.close())))

const CONFIG = 'site:\n  title: Acme Docs\n'
const site = {
  'shabd.config.yaml': `${CONFIG}${KEYWORD_SEARCH}`,
  'content/index.md': '# Acme\n\nStart here.\n',
  'content/guide/hosting.md': '---\ntitle: Going live\n---\n\n## Hosting\n\nUpload the dist folder to any static file host.\n',
}

/** No word of this is in the site. Only its meaning leads to the page on hosting. */
const BY_MEANING = 'where can I publish my website online'

/**
 * A build as `shabd build` leaves it when the model is there: the index
 * names the model, and the vectors lie beside it. The test's build ran
 * without one, so the two are added by hand, from the stand-in.
 */
async function withVectors(built: BuiltSite, config: string): Promise<void> {
  const file = path.join(built.dir, 'dist/_shabd/search-index.json')
  const index = JSON.parse(await readFile(file, 'utf8')) as SearchIndexFile
  const vectors = new Int8Array(index.docs.length * 2)
  index.docs.forEach((doc, i) => vectors.set(quantize(stand.vectorOf(embeddingInput(doc))), i * 2))
  await writeFile(file, JSON.stringify({ ...index, semantic: { model: 'stand-in/model', dims: 2 } }))
  await writeFile(path.join(built.dir, 'dist/_shabd/search-vectors.bin'), vectors)
  // `shabd preview` reads the config when it starts.
  await writeFile(path.join(built.dir, 'shabd.config.yaml'), config)
}

async function serve(built: BuiltSite) {
  const server = await preview(built.dir, { port: 0 })
  servers.push(server)
  const endpoint = `${server.resolvedUrls?.local[0]}mcp`
  const call = async (method: string, params: unknown) => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    return (await response.json()) as { result: { content: { text: string }[]; serverInfo: { title: string } } }
  }
  return {
    search: async (query: string) =>
      (await call('tools/call', { name: 'search_docs', arguments: { query } })).result.content[0]!.text,
    title: async () =>
      (
        await call('initialize', {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 't', version: '0' },
        })
      ).result.serverInfo.title,
  }
}

describe('search_docs through `shabd preview`', () => {
  it('ranks by meaning when the build wrote vectors, with the model loaded by the first search', async () => {
    const built = await build(site)
    await withVectors(built, CONFIG)
    const endpoint = await serve(built)

    expect(await endpoint.title()).toBe('Acme Docs documentation')
    expect(stand.loads).toEqual([])

    expect(await endpoint.search(BY_MEANING)).toContain('1. Going live > Hosting\n   path: /guide/hosting#hosting')
    expect(await endpoint.search('upload')).toContain('Going live > Hosting')
    expect(await endpoint.search('qqzzxx')).toContain('No results')
    expect(stand.loads).toEqual(['stand-in/model'])
  })

  it('is by keyword for a build without vectors, and where features.mcp.semantic is off', async () => {
    const before = stand.loads.length

    const keywords = await build(site)
    const plain = await serve(keywords)
    expect(await plain.search(BY_MEANING)).toContain('No results')
    expect(await plain.search('upload')).toContain('Going live > Hosting')

    // The vectors are there. What keeps the endpoint from them is the config, read when the server starts.
    const vectors = await build(site)
    await withVectors(vectors, `${CONFIG}features:\n  mcp: { semantic: false }\n`)
    const kept = await serve(vectors)
    expect(await kept.search(BY_MEANING)).toContain('No results')
    expect(await kept.search('upload')).toContain('Going live > Hosting')

    await writeFile(path.join(vectors.dir, 'shabd.config.yaml'), `${CONFIG}${KEYWORD_SEARCH}`)
    expect(await (await serve(vectors)).search(BY_MEANING)).toContain('No results')

    expect(stand.loads).toHaveLength(before)
  })

  it('serves a new build without being started again', async () => {
    const built = await build(site)
    const endpoint = await serve(built)
    expect(await endpoint.title()).toBe('Acme Docs documentation')

    const file = path.join(built.dir, 'dist/_shabd/docs.json')
    const docs = JSON.parse(await readFile(file, 'utf8')) as { name: string }
    await writeFile(file, JSON.stringify({ ...docs, name: 'Acme Docs, rebuilt' }))
    // A build takes longer than the clock's smallest step; this test does not.
    const later = new Date(Date.now() + 5_000)
    await utimes(file, later, later)
    expect(await endpoint.title()).toBe('Acme Docs, rebuilt documentation')
  })
})
