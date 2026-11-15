/**
 * Exercises the /mcp handler with the official MCP client over its real
 * Streamable HTTP transport. Only the network is replaced: `fetch` calls the
 * handler directly.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createMcpHandler } from '../src/node/mcp/http.js'
import { staticDocsFrom, toRoutePath, type DocsFile } from '../src/node/mcp/source.js'
import type { SearchIndexFile } from '../src/shared/search-core.js'

const docs: DocsFile = {
  version: 1,
  name: 'Acme Docs',
  description: 'How to use Acme.',
  pages: [
    {
      path: '/',
      title: 'Acme',
      description: 'Start here.',
      url: 'https://docs.acme.test/index.md',
      markdown: '# Acme\n\nStart here.\n',
    },
    {
      path: '/guide/install',
      title: 'Installation',
      description: 'Install the CLI.',
      url: 'https://docs.acme.test/guide/install.md',
      markdown: '# Installation\n\nRun `npm install acme`.\n',
    },
  ],
}

const searchIndex: SearchIndexFile = {
  version: 1,
  semantic: null,
  docs: [
    { path: '/', anchor: '', title: 'Acme', heading: '', text: 'Start here.' },
    {
      path: '/guide/install',
      anchor: 'with-npm',
      title: 'Installation',
      heading: 'With npm',
      text: 'Run npm install acme to add the command line tool.',
    },
  ],
}

const handler = createMcpHandler(staticDocsFrom(docs, searchIndex))
const endpoint = new URL('https://docs.acme.test/mcp')
const text = (result: { content?: unknown }) =>
  (result.content as { type: string; text: string }[]).map((part) => part.text).join('\n')

describe('MCP endpoint', () => {
  const client = new Client({ name: 'shabd-test', version: '0.0.0' })

  beforeAll(async () => {
    await client.connect(
      new StreamableHTTPClientTransport(endpoint, {
        fetch: (input, init) => handler(new Request(input as string | URL, init)),
      }),
    )
  })
  afterAll(() => client.close())

  it('completes the handshake and describes itself', () => {
    expect(client.getServerVersion()).toMatchObject({ name: 'acme-docs-docs', title: 'Acme Docs documentation' })
    expect(client.getInstructions()).toContain('search_docs')
  })

  it('lists three read-only tools', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual(['list_pages', 'read_page', 'search_docs'])
    for (const tool of tools) expect(tool.annotations?.readOnlyHint).toBe(true)
  })

  it('searches sections and reports where they are', async () => {
    const result = await client.callTool({ name: 'search_docs', arguments: { query: 'install with npm' } })
    expect(text(result)).toContain('Installation > With npm')
    expect(text(result)).toContain('path: /guide/install#with-npm')
  })

  it('says so when nothing matches', async () => {
    const result = await client.callTool({ name: 'search_docs', arguments: { query: 'zzzzqqq' } })
    expect(text(result)).toContain('No results')
  })

  it('reads a page as Markdown, however the path is written', async () => {
    for (const path of ['/guide/install', 'guide/install', '/guide/install.md', '/guide/install/']) {
      const result = await client.callTool({ name: 'read_page', arguments: { path } })
      expect(text(result)).toContain('npm install acme')
    }
  })

  it('returns a tool error for a page that does not exist', async () => {
    const result = await client.callTool({ name: 'read_page', arguments: { path: '/nope' } })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('list_pages')
  })

  it('lists every page', async () => {
    const result = await client.callTool({ name: 'list_pages', arguments: {} })
    expect(text(result)).toBe('- /: Acme. Start here.\n- /guide/install: Installation. Install the CLI.')
  })

  it('exposes pages as Markdown resources', async () => {
    const { resources } = await client.listResources()
    expect(resources.map((resource) => resource.uri)).toEqual([
      'https://docs.acme.test/index.md',
      'https://docs.acme.test/guide/install.md',
    ])
    const { contents } = await client.readResource({ uri: 'https://docs.acme.test/guide/install.md' })
    expect(contents[0]).toMatchObject({ mimeType: 'text/markdown' })
    expect((contents[0] as { text: string }).text).toContain('npm install acme')
  })
})

describe('MCP endpoint policy', () => {
  const initialize = (headers: Record<string, string> = {}) =>
    new Request(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } },
      }),
    })

  it('is stateless: only POST is accepted', async () => {
    const response = await handler(new Request(endpoint, { method: 'GET' }))
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST, OPTIONS')
  })

  it('answers a plain JSON-RPC POST with JSON and no session', async () => {
    const response = await handler(initialize())
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('mcp-session-id')).toBeNull()
    const body = (await response.json()) as { result: { serverInfo: { name: string } } }
    expect(body.result.serverInfo.name).toBe('acme-docs-docs')
  })

  it('lets any website call a public deployment', async () => {
    const response = await handler(initialize({ origin: 'https://app.example' }))
    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('in local mode, refuses calls from other websites but not from local tools', async () => {
    const local = createMcpHandler(staticDocsFrom(docs, searchIndex), { origins: 'local' })
    expect((await local(initialize({ origin: 'https://evil.example' }))).status).toBe(403)
    expect((await local(initialize({ origin: 'http://localhost:4321' }))).status).toBe(200)
    expect((await local(initialize())).status).toBe(200)
  })
})

describe('toRoutePath', () => {
  it('normalises the ways a page can be named', () => {
    expect(toRoutePath('/')).toBe('/')
    expect(toRoutePath('index.md')).toBe('/')
    expect(toRoutePath('guide/install.mdx#steps')).toBe('/guide/install')
  })
})
