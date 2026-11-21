/**
 * A two-level cache: memory in front of disk.
 *
 * Entries live in *slots* (one per page) and each slot holds one value,
 * tagged with the key it was computed for. Looking up a slot with a
 * different key is a miss, and the next `set` overwrites it.
 *
 * One value per slot keeps the cache the size of the site: saving a page a
 * thousand times in a dev session leaves one entry, not a thousand.
 */
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { threadId } from 'node:worker_threads'

interface Entry<T> {
  key: string
  value: T
}

export function cacheKey(...parts: (string | number | boolean | undefined)[]): string {
  return createHash('sha1').update(parts.join('\u0000')).digest('hex')
}

export class SlotCache<T> {
  #memory = new Map<string, Entry<T>>()
  #dir: string | undefined
  #dirReady: Promise<unknown> | undefined
  #writes = new Set<Promise<void>>()
  #touched = new Set<string>()

  /** Pass a directory to persist entries across runs; omit it for a memory-only cache. */
  constructor(dir?: string) {
    this.#dir = dir
  }

  async get(slot: string, key: string): Promise<T | undefined> {
    this.#touched.add(slot)
    const inMemory = this.#memory.get(slot)
    if (inMemory) return inMemory.key === key ? inMemory.value : undefined
    if (!this.#dir) return undefined
    try {
      const entry = JSON.parse(await readFile(this.#file(slot), 'utf8')) as Entry<T>
      if (entry.key !== key) return undefined
      this.#memory.set(slot, entry)
      return entry.value
    } catch {
      // Missing or unreadable entries are misses; the value is recomputed and rewritten.
      return undefined
    }
  }

  set(slot: string, key: string, value: T): void {
    this.#touched.add(slot)
    const entry = { key, value }
    this.#memory.set(slot, entry)
    if (!this.#dir) return
    const write = this.#write(slot, entry).finally(() => this.#writes.delete(write))
    this.#writes.add(write)
  }

  /** Wait for pending disk writes. Call before the process exits. */
  async flush(): Promise<void> {
    await Promise.all(this.#writes)
  }

  /** Delete entries for slots not read or written in this run (pages that no longer exist). */
  async prune(): Promise<void> {
    if (!this.#dir) return
    const keep = new Set([...this.#touched].map((slot) => path.basename(this.#file(slot))))
    try {
      const files = await readdir(this.#dir)
      await Promise.all(
        files.filter((file) => !keep.has(file)).map((file) => rm(path.join(this.#dir!, file), { force: true })),
      )
    } catch {
      // Nothing to prune.
    }
  }

  #file(slot: string): string {
    return path.join(this.#dir!, `${createHash('sha1').update(slot).digest('hex').slice(0, 24)}.json`)
  }

  async #write(slot: string, entry: Entry<T>): Promise<void> {
    try {
      this.#dirReady ??= mkdir(this.#dir!, { recursive: true })
      await this.#dirReady
      const file = this.#file(slot)
      // Write-then-rename, so a crash never leaves a half-written entry behind.
      // Named after the thread as well as the process: the threads that compile pages side by side
      // (compile-pool.ts) are one process.
      const temporary = `${file}.${process.pid}.${threadId}.tmp`
      await writeFile(temporary, JSON.stringify(entry))
      await rename(temporary, file)
    } catch {
      // The cache is an optimisation. A failed write costs a recompile next time, nothing else.
    }
  }
}
