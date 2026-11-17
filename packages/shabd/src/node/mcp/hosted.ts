/**
 * The MCP endpoint for a deployed site, on a host that runs code beside the
 * static files.
 *
 * `shabd build --adapter <host>` bundles this file into one module, with a
 * few lines for the host around it (see hosts/). The handler reads the two
 * JSON files the build wrote, from the deployed site itself, the first time
 * it is asked something, and keeps them for as long as the host keeps the
 * function warm. Like everything `mcp/index.ts` exports, it uses web
 * standards only.
 */
import type { SearchIndexFile } from '../../shared/search-core.js'
import { createMcpHandler } from './http.js'
import { DOCS_FILE, SEARCH_INDEX_FILE, staticDocsFrom, type DocsFile, type DocsSource } from './source.js'

/**
 * Fetches a file of the deployed site by its path, such as
 * `/_shabd/docs.json`. `context` is whatever the host passes beside the
 * request: Cloudflare's bindings, for one, which is how a Worker reads the
 * site's static files.
 */
export type AssetLoader<Context> = (path: string, request: Request, context: Context) => Promise<Response>

export function hostedMcp<Context = unknown>(
  base: string,
  load: AssetLoader<Context>,
): (request: Request, context: Context) => Promise<Response> {
  let source: Promise<DocsSource> | undefined

  const read = async <T>(file: string, request: Request, context: Context): Promise<T> => {
    const response = await load(`${base}${file}`, request, context)
    if (!response.ok) throw new Error(`${base}${file} answered ${response.status}`)
    return (await response.json()) as T
  }

  const docs = (request: Request, context: Context): Promise<DocsSource> => {
    source ??= Promise.all([
      read<DocsFile>(DOCS_FILE, request, context),
      // A site may have search switched off. The pages can still be listed and read.
      read<SearchIndexFile>(SEARCH_INDEX_FILE, request, context).catch(() => null),
    ]).then(([file, index]) => staticDocsFrom(file, index))
    // A failed read is not kept: the next request tries again.
    source.catch(() => (source = undefined))
    return source
  }

  return async (request, context) => {
    try {
      return await createMcpHandler(() => docs(request, context))(request)
    } catch (error) {
      const message = `The documentation could not be read: ${error instanceof Error ? error.message : String(error)}`
      return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }
}
