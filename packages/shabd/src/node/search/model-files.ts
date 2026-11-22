/**
 * The files a reader's browser needs to run the embedding model, for a site
 * that serves them itself (`features.search.modelSource: site`).
 *
 * There are two sets, and a browser left to itself fetches each from a host
 * of its own:
 *
 *   the model    from the Hugging Face Hub. The build has these files
 *                already: Transformers.js downloaded them into its cache to
 *                embed the site's text, for the same model and the same
 *                8-bit weights the browser asks for.
 *   the runtime  ONNX Runtime's WebAssembly, from jsDelivr. Transformers.js
 *                names that address itself (src/backends/onnx.js in the
 *                package). The files are in node_modules, in onnxruntime-web,
 *                which Transformers.js depends on.
 *
 * `shabd build` copies both sets into the output, and the dev server serves
 * them from where they lie, at the same addresses.
 */
import { readdir, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { modelCacheDir } from './embed.js'

export interface ServedFile {
  /** Path under the folder the set is served from, with forward slashes. */
  name: string
  /** Where the file is on disk. */
  file: string
  bytes: number
}

const PACKAGE = '@huggingface/transformers'

/**
 * The two builds of the runtime that Transformers.js 4 asks a browser for:
 * one for most browsers, and a plainer one for Safari before version 26.
 * Each is a module and the WebAssembly it loads.
 */
const RUNTIME_FILES = [
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
]

/** The 8-bit weights, which is what Shabd embeds with: Transformers.js names them so. */
const WEIGHTS = /_quantized\b/

/** The folder Transformers.js is installed in, as the site or Shabd itself resolves it. */
function packageDir(root: string): string | undefined {
  for (const from of [path.join(root, 'package.json'), import.meta.url]) {
    try {
      const entry = createRequire(from).resolve(PACKAGE)
      const marker = path.join('node_modules', ...PACKAGE.split('/'))
      const at = entry.lastIndexOf(marker)
      if (at !== -1) return entry.slice(0, at + marker.length)
    } catch {
      // Not resolvable from here: try the next place.
    }
  }
  return undefined
}

async function describe(dir: string, names: string[]): Promise<ServedFile[]> {
  const files: ServedFile[] = []
  for (const name of names) {
    const file = path.join(dir, ...name.split('/'))
    const found = await stat(file).catch(() => undefined)
    if (found?.isFile()) files.push({ name, file, bytes: found.size })
  }
  return files
}

/**
 * The model's files in a Transformers.js cache folder, named as a browser
 * asks for them: `<model>/config.json`, `<model>/onnx/model_quantized.onnx`.
 *
 * A cache can hold other weights of the same model, put there by something
 * else: the full-precision ones are four times the size. Only the 8-bit
 * ones are taken, unless the folder has none by that name.
 */
export async function modelFilesIn(cacheDir: string, model: string): Promise<ServedFile[]> {
  const dir = path.join(cacheDir, ...model.split('/'))
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => [])
  const names = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .sort()
  const weights = names.filter((name) => name.startsWith('onnx/'))
  const wanted = weights.some((name) => WEIGHTS.test(name)) ? weights.filter((name) => WEIGHTS.test(name)) : weights
  const rest = names.filter((name) => !name.startsWith('onnx/'))
  const files = await describe(dir, [...rest, ...wanted])
  return files.map((file) => ({ ...file, name: `${model}/${file.name}` }))
}

/** The model's files, from the cache of the Transformers.js this site builds with. Empty when there are none. */
export async function modelFiles(model: string, root: string): Promise<ServedFile[]> {
  const cacheDir = await modelCacheDir(root)
  return cacheDir ? modelFilesIn(cacheDir, model) : []
}

/** The runtime's files, from the onnxruntime-web that Transformers.js depends on. Empty when it is not installed. */
export async function runtimeFiles(root: string): Promise<ServedFile[]> {
  const dir = packageDir(root)
  if (!dir) return []
  try {
    // Its entry for Node lies in `dist`, beside the builds for the browser.
    const entry = createRequire(path.join(dir, 'package.json')).resolve('onnxruntime-web')
    return await describe(path.dirname(entry), RUNTIME_FILES)
  } catch {
    return []
  }
}
