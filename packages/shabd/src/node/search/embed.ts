/**
 * Build-time embeddings with Transformers.js.
 *
 * The same model runs here (in Node, over every section) and in the reader's
 * browser (over the query only). The corpus is embedded once per build and
 * shipped as bytes; a reader's device never embeds more than what they type.
 *
 * `@huggingface/transformers` is an optional peer dependency. If it is not
 * installed the site builds with keyword search only.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { quantize } from '../../shared/search-core.js'

export interface Embedder {
  model: string
  dims: number
  /** Unit-length vectors, one per input text. */
  embed(texts: string[]): Promise<Float32Array[]>
}

/** The slice of Transformers.js this module uses. */
interface TransformersModule {
  /** Where it keeps the model files it downloads: a folder, in Node. */
  env: { cacheDir: string | null }
  pipeline(
    task: 'feature-extraction',
    model: string,
    options?: Record<string, unknown>,
  ): Promise<(texts: string | string[], options: { pooling: 'mean'; normalize: boolean }) => Promise<Tensor>>
}
interface Tensor {
  data: Float32Array
  dims: number[]
}

const BATCH_SIZE = 16
const PACKAGE = '@huggingface/transformers'

async function importTransformers(root: string): Promise<TransformersModule | null> {
  try {
    return (await import(PACKAGE)) as unknown as TransformersModule
  } catch {
    // Not resolvable from Shabd's own location (strict package managers): try the site's.
  }
  try {
    const resolved = createRequire(path.join(root, 'package.json')).resolve(PACKAGE)
    return (await import(pathToFileURL(resolved).href)) as unknown as TransformersModule
  } catch {
    return null
  }
}

/** The folder Transformers.js downloads model files into, or null when it is not installed. */
export async function modelCacheDir(root: string): Promise<string | null> {
  return (await importTransformers(root))?.env.cacheDir ?? null
}

const embedders = new Map<string, Promise<Embedder | null>>()

/** Load the model once per process. Resolves to null when Transformers.js is not installed. */
export function loadEmbedder(model: string, root: string): Promise<Embedder | null> {
  let pending = embedders.get(model)
  if (!pending) {
    pending = createEmbedder(model, root)
    embedders.set(model, pending)
    // A failed download should be retried on the next request, not remembered.
    pending.catch(() => embedders.delete(model))
  }
  return pending
}

async function createEmbedder(model: string, root: string): Promise<Embedder | null> {
  const transformers = await importTransformers(root)
  if (!transformers) return null

  // `q8` (8-bit weights) is the variant the browser downloads; using it here
  // too keeps document and query vectors in exactly the same space.
  const extract = await transformers.pipeline('feature-extraction', model, { dtype: 'q8' })
  const probe = await extract('probe', { pooling: 'mean', normalize: true })
  const dims = probe.dims.at(-1) ?? probe.data.length

  return {
    model,
    dims,
    async embed(texts) {
      const vectors: Float32Array[] = []
      for (let start = 0; start < texts.length; start += BATCH_SIZE) {
        const batch = texts.slice(start, start + BATCH_SIZE)
        const output = await extract(batch, { pooling: 'mean', normalize: true })
        for (let i = 0; i < batch.length; i++) vectors.push(output.data.slice(i * dims, (i + 1) * dims))
      }
      return vectors
    },
  }
}

/**
 * Embeddings keyed by the text they were computed from.
 *
 * Embedding is the slowest step of a build. With this cache a rebuild only
 * embeds passages whose text changed.
 */
export class EmbeddingCache {
  #file: string
  #entries = new Map<string, Int8Array>()
  #used = new Set<string>()
  #dirty = false

  private constructor(file: string) {
    this.#file = file
  }

  static async open(cacheDir: string, model: string): Promise<EmbeddingCache> {
    const slug = createHash('sha1').update(model).digest('hex').slice(0, 12)
    const cache = new EmbeddingCache(path.join(cacheDir, 'embeddings', `${slug}.json`))
    try {
      const stored = JSON.parse(await readFile(cache.#file, 'utf8')) as Record<string, string>
      for (const [key, value] of Object.entries(stored)) {
        cache.#entries.set(key, new Int8Array(Buffer.from(value, 'base64')))
      }
    } catch {
      // No cache yet, or an unreadable one: start empty.
    }
    return cache
  }

  static key(text: string): string {
    return createHash('sha1').update(text).digest('hex')
  }

  get(text: string): Int8Array | undefined {
    const key = EmbeddingCache.key(text)
    const hit = this.#entries.get(key)
    if (hit) this.#used.add(key)
    return hit
  }

  set(text: string, vector: Int8Array): void {
    const key = EmbeddingCache.key(text)
    this.#entries.set(key, vector)
    this.#used.add(key)
    this.#dirty = true
  }

  /** Persist the entries used in this run; anything else belonged to text that no longer exists. */
  async save(): Promise<void> {
    if (!this.#dirty && this.#used.size === this.#entries.size) return
    const live: Record<string, string> = {}
    for (const key of this.#used) live[key] = Buffer.from(this.#entries.get(key)!.buffer).toString('base64')
    try {
      await mkdir(path.dirname(this.#file), { recursive: true })
      await writeFile(this.#file, JSON.stringify(live))
      this.#dirty = false
    } catch {
      // A cache that cannot be written only costs time on the next build.
    }
  }
}

/** Embed `texts`, reusing cached vectors. Returns one flat array: texts.length × dims signed bytes. */
export async function embedAll(
  embedder: Embedder,
  cache: EmbeddingCache,
  texts: string[],
): Promise<{ vectors: Int8Array; computed: number }> {
  const vectors = new Int8Array(texts.length * embedder.dims)
  const missing: number[] = []

  texts.forEach((text, index) => {
    const cached = cache.get(text)
    if (cached && cached.length === embedder.dims) vectors.set(cached, index * embedder.dims)
    else missing.push(index)
  })

  const computed = await embedder.embed(missing.map((index) => texts[index]!))
  computed.forEach((vector, i) => {
    const index = missing[i]!
    const bytes = quantize(vector)
    vectors.set(bytes, index * embedder.dims)
    cache.set(texts[index]!, bytes)
  })

  return { vectors, computed: missing.length }
}
