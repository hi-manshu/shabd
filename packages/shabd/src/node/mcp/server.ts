/**
 * The docs MCP server: three read-only tools over a DocsSource.
 *
 *   search_docs   find sections by keyword or meaning
 *   read_page     one page as Markdown
 *   list_pages    the table of contents
 *
 * Pages are also exposed as resources, for clients that attach context by URI.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { VERSION } from '../../shared/version.js'
import type { DocsSource } from './source.js'

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const

export function createDocsServer(source: DocsSource): McpServer {
  const name = source.name
  const server = new McpServer(
    {
      name: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'site'}-docs`,
      title: `${name} documentation`,
      version: VERSION,
    },
    {
      instructions:
        `These tools read the ${name} documentation. ` +
        'Call search_docs to find the relevant sections, then read_page with a returned path for the full text.',
    },
  )

  server.registerTool(
    'search_docs',
    {
      title: 'Search the documentation',
      description:
        `Search the ${name} documentation. Returns the best-matching sections, each with the page path, ` +
        'the heading and a short excerpt. Use read_page to get a full page.',
      inputSchema: {
        query: z.string().min(1).describe('Keywords or a question, in natural language'),
        limit: z.number().int().min(1).max(20).default(5).describe('Maximum number of results'),
      },
      annotations: READ_ONLY,
    },
    async ({ query, limit }) => {
      const hits = await source.search(query, limit)
      if (hits.length === 0) {
        return { content: [{ type: 'text', text: `No results for "${query}". Try different words, or list_pages.` }] }
      }
      const text = hits
        .map((hit, index) => {
          const where = hit.doc.heading ? `${hit.doc.title} > ${hit.doc.heading}` : hit.doc.title
          const target = hit.doc.anchor ? `${hit.doc.path}#${hit.doc.anchor}` : hit.doc.path
          return `${index + 1}. ${where}\n   path: ${target}\n   ${hit.snippet}`
        })
        .join('\n\n')
      return { content: [{ type: 'text', text }] }
    },
  )

  server.registerTool(
    'read_page',
    {
      title: 'Read a documentation page',
      description: 'Return one documentation page as Markdown.',
      inputSchema: {
        path: z.string().min(1).describe('Page path from search_docs or list_pages, for example /guide/installation'),
      },
      annotations: READ_ONLY,
    },
    async ({ path }) => {
      const page = source.page(path)
      if (!page) {
        return {
          isError: true,
          content: [{ type: 'text', text: `There is no page at "${path}". Call list_pages to see the paths that exist.` }],
        }
      }
      return { content: [{ type: 'text', text: page.markdown }] }
    },
  )

  server.registerTool(
    'list_pages',
    {
      title: 'List documentation pages',
      description: 'List every documentation page with its path, title and description.',
      annotations: READ_ONLY,
    },
    async () => {
      const lines = source
        .pages()
        .map((page) => `- ${page.path}: ${page.title}${page.description ? `. ${page.description}` : ''}`)
      return { content: [{ type: 'text', text: lines.join('\n') || 'This site has no pages yet.' }] }
    },
  )

  for (const page of source.pages()) {
    server.registerResource(
      page.path,
      /^https?:/.test(page.url) ? page.url : `shabd://page${page.path}`,
      { title: page.title, description: page.description, mimeType: 'text/markdown' },
      async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: page.markdown }] }),
    )
  }

  return server
}
