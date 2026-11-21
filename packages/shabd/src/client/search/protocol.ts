/** Messages between the page and the search worker. */
import type { Editions } from '../../shared/editions.js'
import type { SearchHit } from '../../shared/search-core.js'

export type WorkerRequest =
  | {
      type: 'init'
      store: 'memory' | 'sqlite'
      indexUrl: string
      vectorsUrl: string
      databaseUrl: string
      manifestUrl: string
      model: string
      minSimilarity: number
      /** Where the model comes from: the Hugging Face Hub, or this site, at the two addresses below. */
      modelSource: 'huggingface' | 'site'
      /** The folder the site serves model files from, and the one it serves the runtime that executes them from. */
      modelsUrl: string
      runtimeUrl: string
    }
  /** Start loading the embedding model. Sent when the reader opens search, not before. */
  | { type: 'warm' }
  | { type: 'query'; id: number; query: string; limit: number; scope?: SearchScope | undefined }

/**
 * Where a reader is searching from, on a site with more than one language or
 * more than one version: the results are sections of the same language and
 * the same version as the page they are on.
 */
export interface SearchScope {
  editions: Editions
  /** The page the reader is on. */
  path: string
}

export type ModelStatus =
  | { state: 'idle' }
  | { state: 'loading'; progress: number }
  | { state: 'ready' }
  /** Semantic search is off for this site, or the model could not be loaded. */
  | { state: 'unavailable'; reason?: string }

export type WorkerResponse =
  | {
      type: 'ready'
      sections: number
      semantic: boolean
      /** The store actually in use; `memory` if the SQLite one could not be opened. */
      store: 'memory' | 'sqlite'
      /** The index is kept in the browser's private file system between visits. */
      persistent: boolean
    }
  | { type: 'model'; status: ModelStatus }
  | { type: 'results'; id: number; hits: SearchHit[]; mode: 'keywords' | 'hybrid'; ms: number }
  | { type: 'error'; message: string }
