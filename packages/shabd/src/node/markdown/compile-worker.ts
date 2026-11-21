/**
 * A thread that compiles pages for another: started by compile-pool.ts, which
 * says why. It reads the site's config for itself, makes the compiler that
 * config asks for, and writes each page it is given to the cache on disk.
 */
import { parentPort, workerData } from 'node:worker_threads'
import { loadConfig } from '../config/load.js'
import { createCompiler } from '../context.js'
import type { CompileInput } from './compile.js'

const port = parentPort
if (!port) throw new Error('compile-worker is started by compile-pool, as a worker thread')

const config = await loadConfig((workerData as { root: string }).root)
const compiler = await createCompiler(config)

port.on('message', (batch: CompileInput[]) => {
  void (async () => {
    for (const input of batch) {
      try {
        await compiler.compile(input)
      } catch {
        // A page that does not compile is left out of the cache. The thread that asked compiles it
        // again, one page at a time, and that is where its error is reported.
      }
    }
    // The pages are of use once they are on disk.
    await compiler.cache.flush()
    port.postMessage(batch.length)
  })()
})

port.postMessage('ready')
