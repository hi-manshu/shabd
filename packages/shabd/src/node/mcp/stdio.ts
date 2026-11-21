/**
 * `shabd mcp`: the docs MCP server over stdio, reading the content folder
 * directly. For agents running on the same machine as the docs source:
 *
 *     claude mcp add my-docs -- npx shabd mcp ./docs
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createContext, type ShabdContext } from '../context.js'
import { SearchService, type SearchServiceOptions } from '../search/service.js'
import { createDocsServer } from './server.js'
import { liveDocs } from './live.js'
import type { DocsSource } from './source.js'

/**
 * The docs of the site at `root`, read from its content folder, for a
 * process that only serves them to an agent.
 *
 * Nothing else in such a process searches. So with `features.mcp.semantic`
 * off the index is built without vectors, and the embedding model is never
 * loaded. With it on, the first search loads the model and embeds the
 * sections the cache does not hold yet.
 */
export async function localDocs(
  root: string,
  options: Pick<SearchServiceOptions, 'loadEmbedder' | 'log'> = {},
): Promise<{ context: ShabdContext; docs: DocsSource }> {
  const context = await createContext(root, { dev: false })
  const search = new SearchService(() => context, {
    ...(context.config.config.features.mcp.semantic ? {} : { semantic: false }),
    ...options,
  })
  return { context, docs: liveDocs(() => context, search) }
}

export async function serveStdio(root: string): Promise<void> {
  // stdout carries the protocol, so anything informational goes to stderr.
  const { context, docs } = await localDocs(root, { log: (message) => console.error(`shabd: ${message}`) })
  const server = createDocsServer(docs)
  await server.connect(new StdioServerTransport())
  console.error(`shabd: MCP server for "${context.config.config.site.title}" is running on stdio`)
}
