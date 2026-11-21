/**
 * How the MCP endpoint searches where a Node process serves it: by keyword
 * and, with the embedding model at hand, by meaning.
 *
 * No model is loaded here. A stand-in turns text into vectors, so these
 * tests need no download. The real model is run by e2e/semantic.spec.ts.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createContext, type ShabdContext } from '../src/node/context.js'
import { createMcpHandler } from '../src/node/mcp/http.js'
import { liveDocs } from '../src/node/mcp/live.js'
import { staticDocsFrom, type DocsFile } from '../src/node/mcp/source.js'
import { latestStaticDocs, staticDocs } from '../src/node/mcp/static.js'
import { localDocs } from '../src/node/mcp/stdio.js'
import { embeddingInput } from '../src/node/search/chunk.js'
import type { Embedder } from '../src/node/search/embed.js'
import { SearchService } from '../src/node/search/service.js'
import { quantize, type SearchDoc, type SearchHit, type SearchIndexFile } from '../src/shared/search-core.js'
import { temporarySites } from './helpers/site.js'

const site = temporarySites()

/* ───────────────────────── a stand-in for the model ─────────────────── */

/**
 * Text becomes one direction for each topic it mentions. Two texts on one
 * topic are close without a word in common, which is what the real model
 * is for. Text on no topic is close to nothing.
 */
const TOPICS = [
  ['host', 'hosting', 'upload', 'publish', 'online', 'deploy', 'website'],
  ['colour', 'colours', 'accent', 'theme', 'paint'],
  ['install', 'installer', 'npm'],
]

function vectorOf(text: string): Float32Array {
  const vector = new Float32Array(TOPICS.length)
  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    const topic = TOPICS.findIndex((words) => words.includes(word))
    if (topic !== -1) vector[topic]! += 1
  }
  const length = Math.hypot(...vector)
  return length ? vector.map((value) => value / length) : vector
}

/** A model loader that counts what it is asked for. */
function standIn(embedder: Partial<Embedder> | null | Error = {}) {
  const asked = { loads: 0, models: [] as string[], roots: [] as string[], queries: [] as string[] }
  return {
    asked,
    load: async (model: string, root: string): Promise<Embedder | null> => {
      asked.loads++
      asked.models.push(model)
      asked.roots.push(root)
      if (embedder instanceof Error) throw embedder
      if (embedder === null) return null
      return {
        model,
        dims: TOPICS.length,
        embed: async (texts) => {
          if (texts.length === 1) asked.queries.push(texts[0]!)
          return texts.map(vectorOf)
        },
        ...embedder,
      }
    },
  }
}

/** No word of this is in the site. Only its meaning leads to the page on hosting. */
const BY_MEANING = 'where can I publish my website online'

const where = (hits: SearchHit[]) => hits.map((hit) => `${hit.doc.title} > ${hit.doc.heading}`)

/* ───────────────────────────── a build ──────────────────────────────── */

const SECTIONS: SearchDoc[] = [
  { path: '/guide/hosting', anchor: 'hosting', title: 'Going live', heading: 'Hosting', text: 'Upload the dist folder to any static file host.' },
  { path: '/guide/theme', anchor: 'colours', title: 'Theme', heading: 'Colours', text: 'Set the accent colour in the theme section.' },
  { path: '/guide/install', anchor: 'install', title: 'Setting up', heading: 'Install', text: 'Run the installer, then start the dev server.' },
]

const DOCS: DocsFile = {
  version: 1,
  name: 'Acme Docs',
  description: '',
  pages: SECTIONS.map((section) => ({
    path: section.path,
    title: section.title,
    description: '',
    url: `https://docs.acme.test${section.path}.md`,
    markdown: `# ${section.title}\n\n## ${section.heading}\n\n${section.text}\n`,
  })),
}

const vectorsOf = (sections: SearchDoc[]) => {
  const bytes = new Int8Array(sections.length * TOPICS.length)
  sections.forEach((section, index) => bytes.set(quantize(vectorOf(embeddingInput(section))), index * TOPICS.length))
  return bytes
}

/** The three files of a build in a folder of their own: what `shabd build` leaves in dist/_shabd. */
async function built(options: { semantic?: SearchIndexFile['semantic']; vectors?: Int8Array | null } = {}): Promise<string> {
  const index: SearchIndexFile = {
    version: 1,
    docs: SECTIONS,
    semantic: options.semantic === undefined ? { model: 'stand-in/model', dims: TOPICS.length } : options.semantic,
  }
  const dist = await site({
    '_shabd/docs.json': JSON.stringify(DOCS),
    '_shabd/search-index.json': JSON.stringify(index),
  })
  const vectors = options.vectors === undefined ? vectorsOf(SECTIONS) : options.vectors
  if (vectors) await writeFile(path.join(dist, '_shabd/search-vectors.bin'), vectors)
  return dist
}

describe('search through the endpoint of a build', () => {
  it('is by keyword when it is not asked for more', async () => {
    const docs = await staticDocs(await built())
    expect(where(await docs.search('accent colour', 3))).toEqual(['Theme > Colours'])
    expect(await docs.search(BY_MEANING, 3)).toEqual([])
  })

  it('ranks by meaning as well when the build wrote vectors and the model can be loaded', async () => {
    const model = standIn()
    const docs = await staticDocs(await built(), { semantic: { root: '/site', loadEmbedder: model.load } })

    const hits = await docs.search(BY_MEANING, 3)
    expect(where(hits)).toEqual(['Going live > Hosting'])
    expect(hits[0]?.matched).toEqual({ keywords: false, meaning: true })

    // A word that is there is still found by the word, and what is about nothing in the site finds nothing.
    const both = await docs.search('accent colour', 3)
    expect(where(both)).toEqual(['Theme > Colours'])
    expect(both[0]?.matched).toEqual({ keywords: true, meaning: true })
    expect(await docs.search('qqzzxx', 3)).toEqual([])
  })

  it('loads the model once, when the first search arrives, and the one the index names', async () => {
    const model = standIn()
    const docs = await staticDocs(await built(), { semantic: { root: '/site', loadEmbedder: model.load } })
    docs.pages()
    docs.page('/guide/hosting')
    expect(model.asked.loads).toBe(0)

    await Promise.all([docs.search(BY_MEANING, 3), docs.search('installer', 3)])
    await docs.search('accent colour', 3)
    expect(model.asked).toEqual({
      loads: 1,
      models: ['stand-in/model'],
      roots: ['/site'],
      queries: [BY_MEANING, 'installer', 'accent colour'],
    })
  })

  it('applies the site\'s threshold for how close a section must be', async () => {
    // Mostly about hosting, a little about colour, and no word of it is in the site.
    const mixed = 'where can I publish my paint website online'
    const strict = await staticDocs(await built(), {
      semantic: { root: '/site', loadEmbedder: standIn().load, minSimilarity: 0.999 },
    })
    // The page on hosting is close to the query, and not that close.
    expect(await strict.search(mixed, 3)).toEqual([])
    const lenient = await staticDocs(await built(), {
      semantic: { root: '/site', loadEmbedder: standIn().load, minSimilarity: 0.5 },
    })
    expect(where(await lenient.search(mixed, 3))).toEqual(['Going live > Hosting'])
  })

  it('stays by keyword, without asking for the model, when the build has no vectors to rank by', async () => {
    const builds = {
      'built with --no-semantic': await built({ semantic: null, vectors: null }),
      'the vectors file is missing': await built({ vectors: null }),
      'the vectors are another build\'s': await built({ vectors: new Int8Array(TOPICS.length * 7) }),
    }
    for (const [name, dist] of Object.entries(builds)) {
      const model = standIn()
      const said: string[] = []
      const docs = await staticDocs(dist, { semantic: { root: '/site', loadEmbedder: model.load, log: (message) => said.push(message) } })
      expect(await docs.search(BY_MEANING, 3), name).toEqual([])
      expect(where(await docs.search('accent colour', 3)), name).toEqual(['Theme > Colours'])
      expect(model.asked.loads, name).toBe(0)
      expect(said, name).toEqual([])
    }
  })

  it('stays by keyword, and says why once, when Transformers.js is not installed', async () => {
    const model = standIn(null)
    const said: string[] = []
    const docs = await staticDocs(await built(), {
      semantic: { root: '/site', loadEmbedder: model.load, log: (message) => said.push(message) },
    })
    expect(await docs.search(BY_MEANING, 3)).toEqual([])
    expect(where(await docs.search('accent colour', 3))).toEqual(['Theme > Colours'])
    expect(where(await docs.search('installer', 3))).toEqual(['Setting up > Install'])
    expect(said).toEqual([
      'The build wrote vectors for semantic search, but @huggingface/transformers is not installed. The MCP endpoint searches by keyword.',
    ])
    // It was looked for once, not for every search.
    expect(model.asked.loads).toBe(1)
  })

  it('stays by keyword when the model cannot be loaded, and asks for it again a minute later', async () => {
    let clock = 1_000_000
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    try {
      let offline = true
      const working = standIn()
      const loads: string[] = []
      const said: string[] = []
      const docs = await staticDocs(await built(), {
        semantic: {
          root: '/site',
          log: (message) => said.push(message),
          loadEmbedder: async (model, root) => {
            loads.push(model)
            if (offline) throw new Error('fetch failed')
            return working.load(model, root)
          },
        },
      })

      expect(await docs.search(BY_MEANING, 3)).toEqual([])
      expect(where(await docs.search('accent colour', 3))).toEqual(['Theme > Colours'])
      expect(said).toEqual([
        'The embedding model "stand-in/model" could not be loaded (fetch failed). The MCP endpoint searches by keyword.',
      ])
      // The second search did not wait for another attempt: without a network one can take seconds.
      expect(loads).toHaveLength(1)

      offline = false
      clock += 59_000
      expect(await docs.search(BY_MEANING, 3)).toEqual([])
      expect(loads).toHaveLength(1)

      clock += 2_000
      expect(where(await docs.search(BY_MEANING, 3))).toEqual(['Going live > Hosting'])
      await docs.search(BY_MEANING, 3)
      expect(loads).toHaveLength(2)
      expect(said).toHaveLength(1)
    } finally {
      now.mockRestore()
    }
  })

  it('stays by keyword when the model fails on a query, or is not the one the vectors came from', async () => {
    const failing = standIn({
      embed: async () => {
        throw new Error('out of memory')
      },
    })
    const said: string[] = []
    const broken = await staticDocs(await built(), {
      semantic: { root: '/site', loadEmbedder: failing.load, log: (message) => said.push(message) },
    })
    expect(await broken.search(BY_MEANING, 3)).toEqual([])
    expect(where(await broken.search('accent colour', 3))).toEqual(['Theme > Colours'])
    expect(said).toEqual([
      'The embedding model "stand-in/model" could not embed a query (out of memory). The MCP endpoint searches by keyword.',
    ])

    // Vectors of five numbers cannot be compared with sections of three.
    const other = standIn({ dims: 5, embed: async (texts) => texts.map(() => new Float32Array(5).fill(0.4)) })
    const mismatched = await staticDocs(await built(), { semantic: { root: '/site', loadEmbedder: other.load } })
    expect(await mismatched.search(BY_MEANING, 3)).toEqual([])
    expect(where(await mismatched.search('accent colour', 3))).toEqual(['Theme > Colours'])
  })

  it('takes vectors and an embedder of the caller\'s own, with nothing from Node', async () => {
    const index: SearchIndexFile = { version: 1, docs: SECTIONS, semantic: { model: 'stand-in/model', dims: TOPICS.length } }
    const docs = staticDocsFrom(DOCS, index, { vectors: vectorsOf(SECTIONS), embed: async (query) => vectorOf(query) })
    expect(where(await docs.search(BY_MEANING, 3))).toEqual(['Going live > Hosting'])
    // Without them it is the keyword search a function on a host runs.
    expect(await staticDocsFrom(DOCS, index).search(BY_MEANING, 3)).toEqual([])
  })

  it('reads the build once, and again when another build has replaced it', async () => {
    const dist = await built()
    const model = standIn()
    const latest = latestStaticDocs(dist, { semantic: { root: '/site', loadEmbedder: model.load } })
    const first = await latest()
    expect(await latest()).toBe(first)
    expect(first.name).toBe('Acme Docs')

    const file = path.join(dist, '_shabd/docs.json')
    await writeFile(file, JSON.stringify({ ...DOCS, name: 'Acme Docs, rebuilt' }))
    // A build takes longer than the clock's smallest step; this test does not.
    const later = new Date(Date.now() + 5_000)
    await utimes(file, later, later)
    const second = await latest()
    expect(second).not.toBe(first)
    expect(second.name).toBe('Acme Docs, rebuilt')
    expect(where(await second.search(BY_MEANING, 3))).toEqual(['Going live > Hosting'])
  })

  it('answers an agent\'s search_docs by meaning, through the handler and the official client', async () => {
    const model = standIn()
    const handler = createMcpHandler(latestStaticDocs(await built(), { semantic: { root: '/site', loadEmbedder: model.load } }))
    const client = new Client({ name: 'shabd-test', version: '0.0.0' })
    await client.connect(
      new StreamableHTTPClientTransport(new URL('https://docs.acme.test/mcp'), {
        fetch: (input, init) => handler(new Request(input as string | URL, init)),
      }),
    )
    try {
      await client.listTools()
      expect(model.asked.loads).toBe(0)
      const result = await client.callTool({ name: 'search_docs', arguments: { query: BY_MEANING } })
      const text = (result.content as { text: string }[]).map((part) => part.text).join('\n')
      expect(text).toContain('1. Going live > Hosting\n   path: /guide/hosting#hosting')
      await client.callTool({ name: 'search_docs', arguments: { query: 'accent colour' } })
      expect(model.asked.loads).toBe(1)
    } finally {
      await client.close()
    }
  })
})

/* ───────────────────────── a running process ────────────────────────── */

/** A site of three pages in a folder, for `shabd dev` and `shabd mcp`, which read the content itself. */
const content = (features = '') => ({
  'shabd.config.yaml': `site:\n  title: Acme Docs\n${features}`,
  'content/guide/hosting.md': '---\ntitle: Going live\n---\n\n## Hosting\n\nUpload the dist folder to any static file host.\n',
  'content/guide/theme.md': '---\ntitle: Theme\n---\n\n## Colours\n\nSet the accent colour in the theme section.\n',
  'content/guide/install.md': '---\ntitle: Setting up\n---\n\n## Install\n\nRun the installer, then start the dev server.\n',
})

/**
 * A search compiles the pages, and the compile cache writes them to disk
 * behind it, into the site's folder. A folder that is being written to
 * cannot be removed, which this file does when its tests are done: so each
 * test waits for the writes of the contexts it made.
 */
const contexts: ShabdContext[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.compiler.cache.flush()))
})

/** `shabd mcp` on a site. */
async function local(dir: string, options: Parameters<typeof localDocs>[1] = {}) {
  const made = await localDocs(dir, options)
  contexts.push(made.context)
  return made
}

/** The context `shabd dev` makes for a site. */
async function devContext(dir: string): Promise<ShabdContext> {
  const context = await createContext(dir, { dev: true })
  contexts.push(context)
  return context
}

describe('search through the endpoint of a running process', () => {
  it('ranks by meaning with the model the index was built with, loaded by the first search', async () => {
    const model = standIn()
    const { docs } = await local(await site(content()), { loadEmbedder: model.load })
    docs.pages()
    expect(model.asked.loads).toBe(0)

    const hits = await docs.search(BY_MEANING, 3)
    expect(where(hits)).toEqual(['Going live > Hosting'])
    expect(hits[0]?.matched).toEqual({ keywords: false, meaning: true })
    expect(where(await docs.search('accent colour', 3))[0]).toBe('Theme > Colours')
    expect(await docs.search('qqzzxx', 3)).toEqual([])

    expect(model.asked.loads).toBe(1)
    expect(model.asked.models).toEqual(['Xenova/all-MiniLM-L6-v2'])
    expect(model.asked.queries).toEqual([BY_MEANING, 'accent colour', 'qqzzxx'])
  })

  it('keeps `shabd mcp` to keywords with features.mcp.semantic off: no vectors are built and no model is loaded', async () => {
    const model = standIn()
    const { docs } = await local(await site(content('features:\n  mcp: { semantic: false }\n')), {
      loadEmbedder: model.load,
    })
    expect(await docs.search(BY_MEANING, 3)).toEqual([])
    expect(where(await docs.search('accent colour', 3))).toEqual(['Theme > Colours'])
    expect(model.asked.loads).toBe(0)
  })

  it('keeps the dev server\'s endpoint to keywords with the switch off, and leaves the reader\'s search as it is', async () => {
    const model = standIn()
    const context = await devContext(await site(content('features:\n  mcp: { semantic: false }\n')))
    // As the dev server makes it: one service for the reader's index and for the endpoint.
    const service = new SearchService(() => context, { loadEmbedder: model.load })
    const docs = liveDocs(() => context, service)

    expect(await docs.search(BY_MEANING, 3)).toEqual([])
    expect(where(await docs.search('accent colour', 3))).toEqual(['Theme > Colours'])
    // The index the browser fetches still has its vectors, and a search that is not the endpoint's uses them.
    expect((await service.index()).file.semantic).toEqual({ model: 'Xenova/all-MiniLM-L6-v2', dims: TOPICS.length })
    expect(where(await service.search(BY_MEANING, 3))).toEqual(['Going live > Hosting'])
    expect(model.asked.queries).toEqual([BY_MEANING])
  })

  it('follows the config when it changes while the server runs', async () => {
    const model = standIn()
    const dir = await site(content())
    let context = await devContext(dir)
    const docs = liveDocs(() => context, new SearchService(() => context, { loadEmbedder: model.load }))
    expect(where(await docs.search(BY_MEANING, 3))).toEqual(['Going live > Hosting'])

    await writeFile(path.join(dir, 'shabd.config.yaml'), content('features:\n  mcp: { semantic: false }\n')['shabd.config.yaml'])
    context = await devContext(dir)
    expect(await docs.search(BY_MEANING, 3)).toEqual([])
  })

  it('stays by keyword when the site has semantic search off', async () => {
    const model = standIn()
    const { docs } = await local(await site(content('features:\n  search: { semantic: false }\n')), {
      loadEmbedder: model.load,
    })
    expect(await docs.search(BY_MEANING, 3)).toEqual([])
    expect(where(await docs.search('installer', 3))).toEqual(['Setting up > Install'])
    expect(model.asked.loads).toBe(0)
  })

  it('stays by keyword, and says why, when Transformers.js is not installed or the model cannot be loaded', async () => {
    const reasons = {
      'Semantic search is on, but @huggingface/transformers is not installed. Building keyword search only.': standIn(null),
      'Semantic search is on, but the model "Xenova/all-MiniLM-L6-v2" could not be loaded (fetch failed). Building keyword search only.':
        standIn(new Error('fetch failed')),
    }
    for (const [message, model] of Object.entries(reasons)) {
      const said: string[] = []
      const { docs } = await local(await site(content()), { loadEmbedder: model.load, log: (line) => said.push(line) })
      expect(await docs.search(BY_MEANING, 3), message).toEqual([])
      expect(where(await docs.search('accent colour', 3)), message).toEqual(['Theme > Colours'])
      expect(said, message).toEqual([message])
    }
  })

  it('stays by keyword, and says so once, when the model fails on a query', async () => {
    const said: string[] = []
    const model = standIn({
      embed: async (texts) => {
        // The sections are embedded when the index is built. Only the query fails.
        if (texts.length === 1 && !texts[0]!.includes('\n')) throw new Error('out of memory')
        return texts.map(vectorOf)
      },
    })
    const { docs } = await local(await site(content()), { loadEmbedder: model.load, log: (line) => said.push(line) })
    expect(await docs.search(BY_MEANING, 3)).toEqual([])
    expect(where(await docs.search('accent colour', 3))).toEqual(['Theme > Colours'])
    expect(said).toEqual(['The embedding model could not embed a query (out of memory). Searching by keyword.'])
  })
})

describe('a build with less in it', () => {
  it('still gives its pages when it has no search index, and is an error when it has no pages', async () => {
    const dist = await site({ '_shabd/docs.json': JSON.stringify(DOCS) })
    const model = standIn()
    const docs = await staticDocs(dist, { semantic: { root: '/site', loadEmbedder: model.load } })
    expect(await docs.search('accent colour', 3)).toEqual([])
    expect(docs.page('guide/theme.md')?.title).toBe('Theme')
    expect(model.asked.loads).toBe(0)

    await expect(staticDocs(path.join(dist, 'nowhere'))).rejects.toThrow(/ENOENT/)
  })
})
