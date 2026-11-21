/**
 * The search index for a site, built from the content store.
 *
 * One service instance is shared by everything that needs search in Node:
 * the build (which writes the index to disk), the dev server (which serves
 * it), and the MCP server (which searches it directly).
 */
import {
  KeywordIndex,
  search,
  type SearchDoc,
  type SearchHit,
  type SearchIndexFile,
} from '../../shared/search-core.js'
import { compilePage, type ShabdContext } from '../context.js'
import { chunkPage, embeddingInput } from './chunk.js'
import { embedAll, EmbeddingCache, loadEmbedder, type Embedder } from './embed.js'
import { buildSearchDatabase, type BuiltDatabase } from './sqlite.js'

export interface BuiltIndex {
  file: SearchIndexFile
  /** docs.length × dims signed bytes, or null when the index is keyword-only. */
  vectors: Int8Array | null
  stats: { pages: number; docs: number; embedded: number; ms: number }
}

export interface SearchServiceOptions {
  /** Force keyword-only, regardless of the config (`shabd build --no-semantic`). */
  semantic?: boolean
  /** Where the embedding model comes from: Transformers.js, unless something else is given. A test gives its own. */
  loadEmbedder?: (model: string, root: string) => Promise<Embedder | null>
  log?: (message: string) => void
}

export interface SearchOptions {
  /** False ranks this search by keyword alone, even when the index has vectors (`features.mcp.semantic`). */
  semantic?: boolean
}

export class SearchService {
  #context: () => ShabdContext
  #options: SearchServiceOptions
  #built: Promise<BuiltIndex> | undefined
  #builtRevision = -1
  #keywords: { index: KeywordIndex; for: BuiltIndex } | undefined
  #database: { result: Promise<BuiltDatabase | null>; for: BuiltIndex } | undefined
  #embedder: Embedder | null = null
  /** A model that fails on queries is reported once, not for every search. */
  #warned = false

  constructor(context: () => ShabdContext, options: SearchServiceOptions = {}) {
    this.#context = context
    this.#options = options
  }

  /** The index for the current content. Rebuilt lazily after content changes; unchanged pages come from cache. */
  index(): Promise<BuiltIndex> {
    const revision = this.#context().store.revision
    if (!this.#built || revision !== this.#builtRevision) {
      this.#builtRevision = revision
      this.#built = this.#build().catch((error: unknown) => {
        this.#built = undefined
        throw error
      })
    }
    return this.#built
  }

  /** The index as a SQLite database, or null when `@sqlite.org/sqlite-wasm` is not installed. */
  async database(): Promise<BuiltDatabase | null> {
    const built = await this.index()
    if (this.#database?.for !== built) {
      this.#database = { result: buildSearchDatabase(built, this.#context().config.root), for: built }
    }
    return this.#database.result
  }

  /**
   * Search with the same ranking the browser uses: by keyword, and by
   * meaning as well when the index has vectors. The model that embedded the
   * sections embeds the query, so nothing is loaded here that the index did
   * not already need.
   */
  async search(query: string, limit: number, options: SearchOptions = {}): Promise<SearchHit[]> {
    const built = await this.index()
    if (this.#keywords?.for !== built) {
      this.#keywords = { index: new KeywordIndex(built.file.docs), for: built }
    }
    const semantic =
      options.semantic !== false && built.vectors && built.file.semantic
        ? { vectors: built.vectors, dims: built.file.semantic.dims }
        : null
    let queryVector: Float32Array | null = null
    if (semantic && this.#embedder) {
      try {
        ;[queryVector = null] = await this.#embedder.embed([query])
      } catch (error) {
        // A query the model fails on is still a query the keywords can answer.
        if (!this.#warned) {
          const reason = error instanceof Error ? error.message : String(error)
          this.#options.log?.(`The embedding model could not embed a query (${reason}). Searching by keyword.`)
        }
        this.#warned = true
      }
    }
    const { minSimilarity } = this.#context().config.config.features.search
    return search(this.#keywords.index, semantic, queryVector, query, limit, minSimilarity)
  }

  async #build(): Promise<BuiltIndex> {
    const started = performance.now()
    const context = this.#context()
    const { search: feature } = context.config.config.features
    const log = this.#options.log ?? (() => {})

    const docs: SearchDoc[] = []
    let pages = 0
    for (const page of context.store.pages()) {
      if (page.error) continue
      try {
        const compiled = await compilePage(context, page)
        docs.push(...chunkPage(page, compiled.sections))
        pages++
      } catch {
        // A page that does not compile is reported where it is rendered; it is just not searchable.
      }
    }

    let vectors: Int8Array | null = null
    let semantic: SearchIndexFile['semantic'] = null
    let embedded = 0

    if (feature.semantic && this.#options.semantic !== false) {
      let embedder: Embedder | null = null
      let reason = '@huggingface/transformers is not installed'
      try {
        embedder = await (this.#options.loadEmbedder ?? loadEmbedder)(feature.model, context.config.root)
      } catch (error) {
        reason = `the model "${feature.model}" could not be loaded (${error instanceof Error ? error.message : String(error)})`
      }
      if (embedder) {
        this.#embedder = embedder
        const cache = await EmbeddingCache.open(context.config.cacheDir, feature.model)
        const result = await embedAll(embedder, cache, docs.map(embeddingInput))
        await cache.save()
        vectors = result.vectors
        embedded = result.computed
        semantic = { model: embedder.model, dims: embedder.dims }
      } else {
        log(`Semantic search is on, but ${reason}. Building keyword search only.`)
      }
    }

    return {
      file: { version: 1, docs, semantic },
      vectors,
      stats: { pages, docs: docs.length, embedded, ms: performance.now() - started },
    }
  }
}
