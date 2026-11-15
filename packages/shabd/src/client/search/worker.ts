/**
 * The search worker: the whole search engine, running off the main thread in
 * the reader's browser. No request leaves the device when they search.
 *
 *   init   open the index the build produced, in the store the site chose
 *   warm   load the embedding model (Transformers.js, ONNX Runtime on WASM)
 *   query  keyword search always; fused with semantic search once the model is ready
 *
 * Keyword search works from the first keystroke. Semantic search joins in
 * when the model has loaded, without the reader doing anything.
 */
import { MemoryStore, type SearchIndexFile, type SearchStore } from '../../shared/search-core.js'
import type { ModelStatus, WorkerRequest, WorkerResponse } from './protocol.js'

type Embed = (text: string) => Promise<Float32Array>
type Init = Extract<WorkerRequest, { type: 'init' }>

const scope = self as unknown as {
  postMessage(message: WorkerResponse): void
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
}
const post = (message: WorkerResponse) => scope.postMessage(message)

let store: SearchStore | null = null
let modelName = ''
let minSimilarity: number | undefined
let embed: Embed | null = null
let modelLoading: Promise<void> | null = null
/** Id of the most recent query received; older ones are abandoned once superseded. */
let newestQuery = -1

async function openMemoryStore(request: Init): Promise<SearchStore> {
  const response = await fetch(request.indexUrl)
  if (!response.ok) throw new Error(`Could not load the search index (${response.status})`)
  const index = (await response.json()) as SearchIndexFile
  let vectors: Int8Array | null = null
  if (index.semantic) {
    const file = await fetch(request.vectorsUrl)
    if (file.ok) vectors = new Int8Array(await file.arrayBuffer())
  }
  return new MemoryStore(index, vectors)
}

async function init(request: Init): Promise<void> {
  let persistent = false
  if (request.store === 'sqlite') {
    try {
      // Loaded only for sites that use it: SQLite is a megabyte and a half of WebAssembly.
      const { openSqliteStore } = await import('./sqlite.js')
      const opened = await openSqliteStore(request.databaseUrl, request.manifestUrl)
      store = opened.store
      persistent = opened.persistent
    } catch {
      // The database or SQLite itself is missing from this build: the JSON index always exists.
    }
  }
  store ??= await openMemoryStore(request)

  modelName = store.semantic?.model ?? request.model
  minSimilarity = request.minSimilarity
  post({ type: 'ready', sections: store.sections, semantic: store.semantic !== null, store: store.kind, persistent })
  if (!store.semantic) setModel({ state: 'unavailable' })
}

function setModel(status: ModelStatus): void {
  post({ type: 'model', status })
}

function loadModel(): Promise<void> {
  if (!store?.semantic) return Promise.resolve()
  modelLoading ??= (async () => {
    setModel({ state: 'loading', progress: 0 })
    try {
      // Resolved by the Vite plugin: Transformers.js when it is installed, a stub when it is not.
      const transformers = await import('virtual:shabd/embedder')
      if (!transformers.available || !transformers.pipeline) {
        setModel({ state: 'unavailable', reason: 'Transformers.js is not installed for this site.' })
        return
      }
      const files = new Map<string, number>()
      const extract = await transformers.pipeline('feature-extraction', modelName, {
        // The same 8-bit weights the build used, so queries and documents share a vector space.
        dtype: 'q8',
        progress_callback: (event: { status: string; file?: string; progress?: number }) => {
          if (event.status !== 'progress' || !event.file) return
          files.set(event.file, event.progress ?? 0)
          const total = [...files.values()].reduce((sum, value) => sum + value, 0) / files.size
          setModel({ state: 'loading', progress: Math.round(total) })
        },
      })
      embed = async (text) => {
        const output = await extract(text, { pooling: 'mean', normalize: true })
        return output.data as Float32Array
      }
      setModel({ state: 'ready' })
    } catch (error) {
      setModel({ state: 'unavailable', reason: error instanceof Error ? error.message : String(error) })
    }
  })()
  return modelLoading
}

async function query(request: Extract<WorkerRequest, { type: 'query' }>): Promise<void> {
  if (!store) return
  const started = performance.now()
  const vector = embed && store.semantic ? await embed(request.query) : null
  if (request.id !== newestQuery) return
  const hits = store.search(request.query, vector, request.limit, minSimilarity)
  post({
    type: 'results',
    id: request.id,
    hits,
    mode: vector ? 'hybrid' : 'keywords',
    ms: performance.now() - started,
  })
}

/** Settles when the index is open. `warm` and `query` can arrive before that and must wait for it. */
let initialised: Promise<void> = Promise.resolve()

scope.onmessage = (event) => {
  const request = event.data
  let run: Promise<void>
  if (request.type === 'init') {
    run = initialised = init(request)
  } else if (request.type === 'warm') {
    run = initialised.then(loadModel)
  } else {
    newestQuery = request.id
    run = initialised.then(() => query(request))
  }
  run.catch((error: unknown) => post({ type: 'error', message: error instanceof Error ? error.message : String(error) }))
}
