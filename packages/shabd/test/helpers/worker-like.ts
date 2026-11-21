/**
 * Loads a bundled function into a JavaScript realm of its own, which has
 * what a Worker runtime gives a script and none of what Node adds.
 *
 * In it there is no `process`, `Buffer`, `global`, `require` or
 * `setImmediate`, and code cannot be made from strings: `eval` and
 * `new Function` throw, as they do in a Cloudflare Worker. A function that
 * needed any of these would fail here the way it would fail there.
 *
 * It is not Cloudflare's runtime (workerd). The web APIs in the realm are
 * Node's own, handed in from outside.
 */
import vm from 'node:vm'

/** What a Worker can name. Everything else a script reaches for is undefined, and throws when used. */
const WEB_GLOBALS = [
  'AbortController',
  'AbortSignal',
  'Blob',
  'Event',
  'EventTarget',
  'FormData',
  'Headers',
  'ReadableStream',
  'Request',
  'Response',
  'TextDecoder',
  'TextEncoder',
  'TransformStream',
  'URL',
  'URLSearchParams',
  'WritableStream',
  'atob',
  'btoa',
  'clearInterval',
  'clearTimeout',
  'console',
  'crypto',
  'fetch',
  'performance',
  'queueMicrotask',
  'setInterval',
  'setTimeout',
  'structuredClone',
] as const

export interface WorkerLike<T> {
  /** What the bundle defines: the Worker, or a function. */
  loaded: T
  /** Evaluate an expression in the realm, to ask what it can see. */
  probe(expression: string): unknown
}

/**
 * `code` is a file an adapter wrote: the bundle, then the `export` lines
 * that make a module of it. The bundle defines one name, which is what this
 * returns; the `export` lines are left out, since a realm made this way
 * runs scripts, not modules.
 */
export function loadWorkerLike<T>(code: string, name: string, filename: string): WorkerLike<T> {
  const globals: Record<string, unknown> = { navigator: { userAgent: 'Cloudflare-Workers' } }
  for (const key of WEB_GLOBALS) globals[key] = (globalThis as Record<string, unknown>)[key]
  const context = vm.createContext(globals, { codeGeneration: { strings: false, wasm: false } })
  const exports = code.search(/^export /m)
  vm.runInContext(exports === -1 ? code : code.slice(0, exports), context, { filename })
  return {
    loaded: (context as Record<string, unknown>)[name] as T,
    probe: (expression) => vm.runInContext(expression, context),
  }
}
