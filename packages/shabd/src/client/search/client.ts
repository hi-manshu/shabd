/**
 * The page's handle on the search worker. One worker per tab, created the
 * first time search is opened and kept for the rest of the visit.
 */
import { withBase } from '../../shared/paths.js'
import { SEARCH_FILES, type SearchHit } from '../../shared/search-core.js'
import { createStore, siteStore } from '../app/store.js'
import type { ModelStatus, WorkerRequest, WorkerResponse } from './protocol.js'

export interface SearchStatus {
  index: 'loading' | 'ready' | 'error'
  error?: string
  model: ModelStatus
  /** Set once the index is open: which store holds it, and whether it is kept between visits. */
  store?: 'memory' | 'sqlite'
  persistent?: boolean
}

export interface SearchResults {
  query: string
  hits: SearchHit[]
  mode: 'keywords' | 'hybrid'
}

export const searchStatus = createStore<SearchStatus>({ index: 'loading', model: { state: 'idle' } })

let worker: Worker | null = null
let nextId = 0
let latest = { id: -1, query: '', resolve: (_results: SearchResults) => {} }

function start(): Worker {
  if (worker) return worker
  const { site, features } = siteStore.get()
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })

  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data
    switch (message.type) {
      case 'ready':
        searchStatus.update((status) => ({
          ...status,
          index: 'ready',
          store: message.store,
          persistent: message.persistent,
        }))
        break
      case 'model':
        searchStatus.update((status) => ({ ...status, model: message.status }))
        break
      case 'results':
        // Answers to superseded queries are dropped: only the newest keystroke matters.
        if (message.id === latest.id) latest.resolve({ query: latest.query, hits: message.hits, mode: message.mode })
        break
      case 'error':
        searchStatus.update((status) => ({ ...status, index: 'error', error: message.message }))
        break
    }
  }
  worker.onerror = (event) => {
    searchStatus.update((status) => ({ ...status, index: 'error', error: event.message }))
  }

  const file = (name: keyof typeof SEARCH_FILES) => withBase(site.base, `/${SEARCH_FILES[name]}`)
  send({
    type: 'init',
    store: features.search.store,
    indexUrl: file('index'),
    vectorsUrl: file('vectors'),
    databaseUrl: file('database'),
    manifestUrl: file('manifest'),
    model: features.search.model,
    minSimilarity: features.search.minSimilarity,
  })
  return worker
}

function send(request: WorkerRequest): void {
  worker?.postMessage(request)
}

/** True when the reader has asked their browser to use less data. */
function savingData(): boolean {
  return (navigator as { connection?: { saveData?: boolean } }).connection?.saveData === true
}

/**
 * Create the worker and load the index. The embedding model is tens of
 * megabytes, so it is only fetched for readers who have not asked to save data;
 * everyone else keeps keyword search.
 */
export function openSearch(): void {
  start()
  if (siteStore.get().features.search.semantic && !savingData()) send({ type: 'warm' })
}

/** Search. The promise for an older query never resolves once a newer one is sent. */
export function runSearch(query: string, limit: number): Promise<SearchResults> {
  start()
  return new Promise((resolve) => {
    latest = { id: nextId++, query, resolve }
    send({ type: 'query', id: latest.id, query, limit })
  })
}
