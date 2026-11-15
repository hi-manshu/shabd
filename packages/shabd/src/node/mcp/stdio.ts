/**
 * `shabd mcp`: the docs MCP server over stdio, reading the content folder
 * directly. For agents running on the same machine as the docs source:
 *
 *     claude mcp add my-docs -- npx shabd mcp ./docs
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createContext } from '../context.js'
import { SearchService } from '../search/service.js'
import { createDocsServer } from './server.js'
import { liveDocs } from './live.js'

export async function serveStdio(root: string): Promise<void> {
  const context = await createContext(root, { dev: false })
  // stdout carries the protocol, so anything informational goes to stderr.
  const search = new SearchService(() => context, { log: (message) => console.error(`shabd: ${message}`) })
  const server = createDocsServer(liveDocs(() => context, search))
  await server.connect(new StdioServerTransport())
  console.error(`shabd: MCP server for "${context.config.config.site.title}" is running on stdio`)
}
