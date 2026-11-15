/** Messages between the page and the search worker. */
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
    }
  /** Start loading the embedding model. Sent when the reader opens search, not before. */
  | { type: 'warm' }
  | { type: 'query'; id: number; query: string; limit: number }

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
