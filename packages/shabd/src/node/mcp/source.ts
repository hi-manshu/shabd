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
import { KeywordIndex, search, SEARCH_FILES, type SearchHit, type SearchIndexFile } from '../../shared/search-core.js'

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

export function staticDocsFrom(docs: DocsFile, searchIndex: SearchIndexFile | null): DocsSource {
  const byPath = new Map(docs.pages.map((page) => [page.path, page]))
  const keywords = searchIndex ? new KeywordIndex(searchIndex.docs) : null
  return {
    name: docs.name,
    description: docs.description,
    pages: () => docs.pages,
    page: (routePath) => byPath.get(toRoutePath(routePath)),
    search: async (query, limit) => (keywords ? search(keywords, null, null, query, limit) : []),
  }
}
