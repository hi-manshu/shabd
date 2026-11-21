/**
 * Compiles pages on more than one core.
 *
 * A page is compiled by one thread, and a site of thousands of pages spent
 * close to half of its build doing that on one core while the others stood
 * by. So before the pages are looked at one by one, the ones that are not in
 * the cache are handed out to worker threads. Each worker has a compiler of
 * its own, made from the same config, and writes what it compiles to the
 * cache on disk, where the thread that asked finds it. Nothing else changes:
 * a page is still compiled by `compilePage`, which now finds it done.
 *
 * A small site is not worth the workers. Starting one costs about as much as
 * compiling a hundred short pages, and a site that was built before has most
 * of its pages in the cache already.
 */
import { existsSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import type { PageRecord } from '../content/store.js'
import { compileInput, type ShabdContext } from '../context.js'
import type { CompileInput } from './compile.js'

/** With fewer pages than this left to compile, they are compiled where they are asked for. */
const WORTH_WORKERS = 200
/** How many pages a worker is given at a time. */
const BATCH = 16
/** As many as `build.threads: auto` starts. More than this each wait on the disk and on memory more than they compile. */
const MOST_WORKERS = 8

/** The worker, as the build of this package leaves it beside this file. */
const WORKER = new URL('./compile-worker.js', import.meta.url)

export interface Warmed {
  /** How many threads compiled. */
  workers: number
  /** How many pages they were given. */
  pages: number
}

/**
 * Compile the pages that are not in the cache, side by side. Resolves with
 * nothing when it was not worth doing, or could not be done: the pages are
 * then compiled one at a time by whoever asks for them, as before.
 */
export async function warmCompileCache(context: ShabdContext, pages: readonly PageRecord[], options: { worthIt?: number } = {}): Promise<Warmed | undefined> {
  // Run from its source, as the unit tests run it, this package has no worker to start: it is a file of the build.
  if (!existsSync(fileURLToPath(WORKER))) return undefined
  const cores = availableParallelism()
  const asked = context.config.config.build.threads
  const most = asked === 'auto' ? MOST_WORKERS : asked
  // One thread is the thread that asked, compiling each page as it comes to it.
  if (most < 2 || cores < 3) return undefined

  const waiting: CompileInput[] = []
  for (const page of pages) {
    // A page whose frontmatter is wrong is not compiled at all: whoever asks for it is told why.
    if (page.error) continue
    const input = compileInput(context, page)
    if (!(await context.compiler.has(input))) waiting.push(input)
  }
  if (waiting.length < (options.worthIt ?? WORTH_WORKERS)) return undefined

  // One core is left for this thread, which hands the pages out, and for the system.
  const workers = Math.max(2, Math.min(most, cores - 1, Math.ceil(waiting.length / BATCH)))
  const total = waiting.length
  await Promise.all(Array.from({ length: workers }, () => work(context.config.root, waiting)))
  return { workers, pages: total }
}

/** One worker, taking pages from the front of the list until there are none. */
function work(root: string, waiting: CompileInput[]): Promise<void> {
  return new Promise((resolve) => {
    const worker = new Worker(WORKER, { workerData: { root } })
    // It says when it is ready, and again after each batch.
    worker.on('message', () => {
      const batch = waiting.splice(0, BATCH)
      if (batch.length > 0) worker.postMessage(batch)
      else void worker.terminate()
    })
    // A worker that fails leaves its pages to the thread that asked, which compiles them itself and
    // says what is wrong with them. A worker is never the one to report a page.
    worker.on('error', () => resolve())
    worker.on('exit', () => resolve())
  })
}
