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
type TransformersEnv = NonNullable<(typeof import('virtual:shabd/embedder'))['env']>

const scope = self as unknown as {
  postMessage(message: WorkerResponse): void
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
}
const post = (message: WorkerResponse) => scope.postMessage(message)

let store: SearchStore | null = null
let modelName = ''
let minSimilarity: number | undefined
/** Set when the site serves the model itself: the two folders it serves from. */
let served: { models: string; runtime: string } | null = null
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
  served = request.modelSource === 'site' ? { models: request.modelsUrl, runtime: request.runtimeUrl } : null
  post({ type: 'ready', sections: store.sections, semantic: store.semantic !== null, store: store.kind, persistent })
  if (!store.semantic) setModel({ state: 'unavailable' })
}

function setModel(status: ModelStatus): void {
  post({ type: 'model', status })
}

/**
 * Tell Transformers.js to take the model, and the runtime that executes it,
 * from this site and from nowhere else (`features.search.modelSource: site`).
 *
 * Left alone it asks two other hosts.
 *
 * The model comes from the Hugging Face Hub, which is `remoteHost`. That is
 * set to this site's own folder of model files, laid out as `{model}/` and
 * the file's name. Transformers.js also has settings for model files that
 * are "local" (`allowLocalModels`, `localModelPath`), and they are not
 * used: in a browser, version 4.3 asks for each local file twice, once in
 * full to read its size, and never reads or cancels that first answer. In
 * Chromium the second request for the 22 MB of weights then failed with a
 * network error. Through `remoteHost` the size is asked for with a request
 * for one byte.
 *
 * The runtime, ONNX Runtime's WebAssembly, comes from jsDelivr.
 * Transformers.js has chosen which two files it wants by the time it is
 * imported, and written their addresses in `wasmPaths`. The same two files
 * are asked for here, by name, in the site's own folder.
 */
function serveFromSite(env: TransformersEnv, from: { models: string; runtime: string }): void {
  // A folder's address may come without the slash at its end.
  const folder = (address: string) => new URL(address.replace(/\/?$/, '/'), self.location.href)

  env.remoteHost = folder(from.models).href
  env.remotePathTemplate = '{model}/'

  const wasm = env.backends.onnx.wasm
  const paths = wasm?.wasmPaths
  if (wasm && paths && typeof paths === 'object') {
    const here = (address: unknown) => new URL(String(address).split('/').pop() ?? '', folder(from.runtime)).href
    wasm.wasmPaths = { mjs: here(paths.mjs), wasm: here(paths.wasm) }
  }
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
      if (served && transformers.env) serveFromSite(transformers.env, served)
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
