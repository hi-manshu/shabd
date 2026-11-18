/**
 * What the MCP server reads from: a DocsSource.
 *
 * This file and everything it imports use only web-standard APIs, so the
 * `/mcp` handler can run where there is no file system (an edge function).
 * The sources that need Node live next door:
 *
 *   live.ts    the content store of a running process (dev server, `shabd mcp`)
 *   static.ts  the files a build wrote to dist/_shabd (`shabd preview`)
 */
import { normalizePath } from '../../shared/paths.js'
import { MemoryStore, SEARCH_FILES, type SearchHit, type SearchIndexFile } from '../../shared/search-core.js'

export interface DocsPage {
  /** Route path, e.g. `/guide/install`. */
  path: string
  title: string
  description: string
  /** Address of the page's Markdown copy. */
  url: string
  markdown: string
}

export interface DocsSource {
  /** The site's title. */
  name: string
  description: string
  pages(): DocsPage[]
  page(path: string): DocsPage | undefined
  search(query: string, limit: number): Promise<SearchHit[]>
}

/** `guide/install`, `/guide/install/` and `/guide/install.md` all name the same page. */
export function toRoutePath(input: string): string {
  const [withoutHash = ''] = input.trim().split('#')
  const path = normalizePath(`/${withoutHash.replace(/^\/+/, '')}`.replace(/\.mdx?$/i, ''))
  return path === '/index' ? '/' : path
}

/** The file `shabd build` writes, and `staticDocsFrom` reads. */
export interface DocsFile {
  version: 1
  name: string
  description: string
  pages: DocsPage[]
}

export const DOCS_FILE = '_shabd/docs.json'
export const SEARCH_INDEX_FILE = SEARCH_FILES.index
export const SEARCH_VECTORS_FILE = SEARCH_FILES.vectors

/**
 * What `staticDocsFrom` needs to rank by meaning as well as by keyword: the
 * vectors a build wrote, and something that turns a query into one.
 *
 * Nothing here loads a model. Where the endpoint runs decides whether it can
 * afford one: a Node process gets Transformers.js from `staticDocs`
 * (static.ts), and a function on a host is given nothing and searches by
 * keyword.
 */
export interface SemanticSearch {
  /** `_shabd/search-vectors.bin`: one signed byte per dimension, per section. */
  vectors: Int8Array
  /**
   * The query as a unit vector from `model`, the one the index was built
   * with. Null, or an error, makes this one search a keyword search.
   */
  embed(query: string, model: string): Promise<ArrayLike<number> | null>
  /** `features.search.minSimilarity`. */
  minSimilarity?: number | undefined
}

export function staticDocsFrom(
  docs: DocsFile,
  searchIndex: SearchIndexFile | null,
  semantic?: SemanticSearch,
): DocsSource {
  const byPath = new Map(docs.pages.map((page) => [page.path, page]))
  // The store the reader's browser searches with, so an agent is ranked what a reader is ranked.
  // It leaves out vectors that do not belong to this index.
  const store = searchIndex ? new MemoryStore(searchIndex, semantic?.vectors ?? null) : null

  const queryVector = async (query: string): Promise<ArrayLike<number> | null> => {
    if (!semantic || !store?.semantic) return null
    try {
      const vector = await semantic.embed(query, store.semantic.model)
      // A vector of another length is from another model, and says nothing about these sections.
      return vector && vector.length === store.semantic.dims ? vector : null
    } catch {
      return null
    }
  }

  return {
    name: docs.name,
    description: docs.description,
    pages: () => docs.pages,
    page: (routePath) => byPath.get(toRoutePath(routePath)),
    search: async (query, limit) =>
      store ? store.search(query, await queryVector(query), limit, semantic?.minSimilarity) : [],
  }
}
