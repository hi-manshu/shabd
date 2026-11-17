/**
 * The MCP endpoint of a deployed site: the part of a host's function that is
 * the same on every host.
 *
 * `shabd build --adapter <name>` bundles this file, the handler in
 * src/node/mcp and the MCP SDK into one module. This file and everything it
 * imports use web-standard APIs only, so that the module runs in a Cloudflare
 * Worker as well as in Node.
 *
 * The endpoint reads two files a build writes: `_shabd/docs.json` and
 * `_shabd/search-index.json`. They are not bundled into the function. It
 * fetches them from the site's own static files when it first needs them,
 * and keeps them for as long as the host keeps the function loaded. Why:
 *
 *   - Both files grow with the site: one holds every page's Markdown, the
 *     other every section's text. A site with thousands of pages has tens of
 *     megabytes of them, and a function that carried them would be parsed
 *     in full on every cold start, before it could answer anything. A
 *     Cloudflare Worker has one second to start and may be 64 MiB. Fetched,
 *     the function is the same size for every site: about 400 KB.
 *   - The site publishes both files anyway (the search dialog reads the
 *     index), so bundling them would upload the same text twice.
 *   - A cold start then costs one request to the host's own file store
 *     before the first answer, and a second before the first search. The
 *     index waits for a search because nothing else needs it and building
 *     it is the expensive step.
 *
 * What it costs: a deployment behind a login answers the function's request
 * for its own files with the login page. The caller's cookie and
 * authorisation are passed along for that reason (see `readFromSite`).
 */
import { createMcpHandler } from '../../mcp/http.js'
import { staticDocsFrom, type DocsFile, type DocsSource } from '../../mcp/source.js'
import type { SearchIndexFile } from '../../../shared/search-core.js'

/** Where the endpoint and its two files are on the deployed site. The build writes this into the function. */
export interface EndpointSite {
  /** The addresses the MCP route answers at, with the site's base: `/mcp`, `/docs/mcp`. */
  routes: string[]
  /** The address of `_shabd/docs.json`. */
  docs: string
  /** The address of `_shabd/search-index.json`. */
  index: string
}

/** Fetches one of the site's own files, by its address on the site. */
export type ReadSiteFile = (path: string) => Promise<Response>

interface LoadedSite {
  docs: DocsFile
  /** The pages, without search. */
  pages: DocsSource
  /** The same with the search index, from the first search on. */
  searchable?: Promise<DocsSource> | undefined
}

/**
 * How many addresses' worth of files are kept. A deployment answers at a
 * few (its own domain, the host's), and a request can claim any name: each
 * new one must not keep another copy of the site in memory.
 */
const MAX_SITES = 4

async function readJson<T>(read: ReadSiteFile, path: string): Promise<T> {
  let response: Response
  try {
    response = await read(path)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`The MCP endpoint could not fetch ${path} from the site: ${reason}`)
  }
  if (!response.ok) {
    throw new Error(`The MCP endpoint could not read ${path}: the site answered ${response.status}.`)
  }
  try {
    return (await response.json()) as T
  } catch {
    throw new Error(
      `The MCP endpoint could not read ${path}: what the site sent is not JSON. A site behind a login sends its login page.`,
    )
  }
}

export class Endpoint {
  #site: EndpointSite
  #loaded = new Map<string, Promise<LoadedSite>>()

  constructor(site: EndpointSite) {
    this.#site = site
  }

  /** Is this the address of the MCP route? */
  owns(pathname: string): boolean {
    return this.#site.routes.includes(pathname)
  }

  /**
   * Answer a request for the MCP route. `read` fetches the site's files, and
   * `from` names where it fetches them from, when that can differ between
   * requests: files from one address are never served to a request for another.
   */
  respond(request: Request, read: ReadSiteFile, from = ''): Promise<Response> {
    return createMcpHandler(() => this.#source(read, from))(request)
  }

  /** The answer to a request for any other address, on a host that sent it here by mistake. */
  notFound(): Response {
    const message = `Not found. The MCP endpoint is at ${this.#site.routes[0]}.`
    return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  async #source(read: ReadSiteFile, from: string): Promise<DocsSource> {
    const loaded = await this.#load(read, from)
    const { name, description, pages, page } = loaded.pages
    return {
      name,
      description,
      pages,
      page,
      search: async (query, limit) => {
        const pending = (loaded.searchable ??= readJson<SearchIndexFile>(read, this.#site.index).then((index) =>
          staticDocsFrom(loaded.docs, index),
        ))
        let searchable: DocsSource
        try {
          searchable = await pending
        } catch (error) {
          // A fetch that failed is tried again by the next search, not remembered.
          if (loaded.searchable === pending) loaded.searchable = undefined
          throw error
        }
        return searchable.search(query, limit)
      },
    }
  }

  #load(read: ReadSiteFile, from: string): Promise<LoadedSite> {
    let pending = this.#loaded.get(from)
    if (!pending) {
      const loading = readJson<DocsFile>(read, this.#site.docs).then((docs) => ({
        docs,
        pages: staticDocsFrom(docs, null),
      }))
      if (this.#loaded.size >= MAX_SITES) {
        const [oldest] = this.#loaded.keys()
        if (oldest !== undefined) this.#loaded.delete(oldest)
      }
      this.#loaded.set(from, loading)
      loading.catch(() => {
        if (this.#loaded.get(from) === loading) this.#loaded.delete(from)
      })
      pending = loading
    }
    return pending
  }
}

/**
 * Reads the site's files over HTTP, for hosts whose functions have no other
 * way to them (Vercel, Netlify).
 *
 * The files are fetched from the address the request itself came to, not
 * from an address the host has for the deployment: on Vercel that one is
 * behind a login when the project protects its deployments. The caller's
 * cookie and authorisation go with the fetch, so that a deployment behind
 * a login answers the function as it answered the caller. Vercel describes
 * both steps: https://vercel.com/docs/deployment-protection
 */
export function readFromSite(request: Request): { read: ReadSiteFile; from: string } {
  const { origin } = new URL(request.url)
  const headers = new Headers()
  for (const name of ['cookie', 'authorization']) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  return { from: origin, read: (path) => fetch(new URL(path, origin), { headers }) }
}
