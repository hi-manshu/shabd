/**
 * Public API for hosting the docs MCP endpoint yourself.
 *
 *     import { createMcpHandler, staticDocsFrom } from '@himanshoe/shabd/mcp'
 *
 * Nothing exported here touches the file system or any other Node built-in,
 * so the handler can be deployed to an edge or serverless function. Give it
 * the two JSON files a build writes: `_shabd/docs.json` and
 * `_shabd/search-index.json`.
 *
 * Search is then by keyword. A server that can run an embedding model may
 * pass `staticDocsFrom` a third argument, a `SemanticSearch`, to rank by
 * meaning as well.
 */
export { createMcpHandler, type McpHandlerOptions } from './http.js'
export { createDocsServer } from './server.js'
export {
  staticDocsFrom,
  toRoutePath,
  DOCS_FILE,
  SEARCH_INDEX_FILE,
  type DocsFile,
  type DocsPage,
  type DocsSource,
  type SemanticSearch,
} from './source.js'
