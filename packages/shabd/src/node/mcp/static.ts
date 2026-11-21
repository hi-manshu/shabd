/**
 * A DocsSource over the files a build wrote. Needs no content folder.
 *
 * Search is by keyword, unless it is asked to rank by meaning as well. Then
 * the vectors the build wrote are read too, and the embedding model turns
 * each query into one: the same model the build used, loaded once, when
 * the first search arrives. A process that serves the endpoint for a long
 * time can afford that (`shabd preview`); a function on a host cannot, and
 * does not come through here.
 *
 * Whatever is missing for it (the build wrote no vectors, Transformers.js
 * is not installed, the model cannot be loaded) leaves search by keyword.
 * Nothing fails.
 */
import { statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { SearchIndexFile } from '../../shared/search-core.js'
import { loadEmbedder, type Embedder } from '../search/embed.js'
import {
  DOCS_FILE,
  SEARCH_INDEX_FILE,
  SEARCH_VECTORS_FILE,
  staticDocsFrom,
  type DocsFile,
  type DocsSource,
  type SemanticSearch,
} from './source.js'

/** How long after a failed attempt the model is not asked for again, in milliseconds. */
const RETRY_AFTER = 60_000

export interface StaticSemanticOptions {
  /** The site folder. `@huggingface/transformers` is looked for there when Shabd's own folder does not have it. */
  root: string
  /** `features.search.minSimilarity`. */
  minSimilarity?: number | undefined
  /** Where the model comes from: Transformers.js, unless something else is given. A test gives its own. */
  loadEmbedder?: ((model: string, root: string) => Promise<Embedder | null>) | undefined
  /** Told why search is by keyword after all, once. */
  log?: ((message: string) => void) | undefined
}

export interface StaticDocsOptions {
  /** Rank by meaning as well as by keyword, where the build wrote vectors and the model can be loaded. */
  semantic?: StaticSemanticOptions | undefined
}

/** Load the docs a build wrote into `distDir`. */
export async function staticDocs(distDir: string, options: StaticDocsOptions = {}): Promise<DocsSource> {
  const docs = JSON.parse(await readFile(path.join(distDir, DOCS_FILE), 'utf8')) as DocsFile
  const searchIndex = await readFile(path.join(distDir, SEARCH_INDEX_FILE), 'utf8')
    .then((text) => JSON.parse(text) as SearchIndexFile)
    .catch(() => null)
  // An index that names no model was built for keywords: there is nothing to rank by meaning with.
  const semantic =
    options.semantic && searchIndex?.semantic ? await semanticSearch(distDir, options.semantic) : undefined
  return staticDocsFrom(docs, searchIndex, semantic)
}

async function semanticSearch(distDir: string, options: StaticSemanticOptions): Promise<SemanticSearch | undefined> {
  const bytes = await readFile(path.join(distDir, SEARCH_VECTORS_FILE)).catch(() => null)
  if (!bytes) return undefined

  const load = options.loadEmbedder ?? loadEmbedder
  let said = false
  const keywordsOnly = (why: string): null => {
    if (!said) options.log?.(`${why} The MCP endpoint searches by keyword.`)
    said = true
    return null
  }

  // Asked for by the first search, and by no search twice. `loadEmbedder` keeps the model for the whole
  // process, so a source read again after a rebuild gets the one that is already loaded.
  let loading: Promise<Embedder | null> | undefined
  let failedAt = -Infinity
  const embedder = (model: string): Promise<Embedder | null> => {
    if (!loading) {
      const pending = load(model, options.root)
      loading = pending
      pending.catch(() => {
        failedAt = Date.now()
        if (loading === pending) loading = undefined
      })
    }
    return loading
  }

  return {
    vectors: new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    minSimilarity: options.minSimilarity,
    async embed(query, model) {
      // A model that could not be loaded is asked for again, but not by every search: without a network
      // each attempt can take seconds, and an agent is waiting for this answer.
      if (!loading && Date.now() - failedAt < RETRY_AFTER) return null

      const reason = (error: unknown) => (error instanceof Error ? error.message : String(error))
      let loaded: Embedder | null
      try {
        loaded = await embedder(model)
      } catch (error) {
        return keywordsOnly(`The embedding model "${model}" could not be loaded (${reason(error)}).`)
      }
      if (!loaded) {
        return keywordsOnly('The build wrote vectors for semantic search, but @huggingface/transformers is not installed.')
      }
      try {
        const [vector] = await loaded.embed([query])
        return vector ?? null
      } catch (error) {
        return keywordsOnly(`The embedding model "${model}" could not embed a query (${reason(error)}).`)
      }
    },
  }
}

/**
 * `staticDocs` for a server that outlives a build. The files are read when
 * they are first needed, and again only after a build has replaced them:
 * not for every request, which with vectors would mean megabytes each time.
 */
export function latestStaticDocs(distDir: string, options: StaticDocsOptions = {}): () => Promise<DocsSource> {
  const files = [DOCS_FILE, SEARCH_INDEX_FILE, SEARCH_VECTORS_FILE].map((file) => path.join(distDir, file))
  let read: { stamp: string; docs: Promise<DocsSource> } | undefined
  return () => {
    const stamp = files.map((file) => statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? 0).join(' ')
    if (read?.stamp !== stamp) read = { stamp, docs: staticDocs(distDir, options) }
    return read.docs
  }
}
