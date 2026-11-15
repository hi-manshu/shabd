/**
 * Opens the search database in the worker.
 *
 * Preferred: the origin-private file system (OPFS). The database file is
 * downloaded once, stored there, and opened in place. SQLite then reads
 * only the pages a query touches, so a large index costs neither a download
 * per visit nor its size in memory. A small manifest says whether the stored
 * copy is still the current one.
 *
 * Fallback: download the file and open it from memory. This is what happens
 * where OPFS is unavailable, and in a second tab while the first one holds
 * the stored file (OPFS access handles are exclusive).
 */
import type { SearchManifest } from '../../shared/search-core.js'
import {
  openSearchDatabase,
  readSearchMeta,
  SqliteStore,
  type SqliteApi,
  type SqliteDatabase,
} from '../../shared/sqlite-store.js'

/** The parts of SQLite's OPFS "sync access handle pool" used here. */
interface HandlePool {
  getFileNames(): string[]
  importDb(name: string, bytes: Uint8Array): Promise<number>
  OpfsSAHPoolDb: new (name: string) => SqliteDatabase
}
type BrowserSqlite = SqliteApi & {
  installOpfsSAHPoolVfs?: (options: { name: string; initialCapacity: number }) => Promise<HandlePool>
}

const STORED_NAME = '/search.sqlite'

export interface OpenedStore {
  store: SqliteStore
  /** True when the database is kept in the browser's private file system between visits. */
  persistent: boolean
}

async function download(url: string): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not load the search database (${response.status})`)
  return new Uint8Array(await response.arrayBuffer())
}

export async function openSqliteStore(databaseUrl: string, manifestUrl: string): Promise<OpenedStore> {
  // Resolved by the Vite plugin: SQLite WASM when the site uses this store and has it installed.
  const module = await import('virtual:shabd/sqlite')
  if (!module.available || !module.init) throw new Error('SQLite is not installed for this site.')
  const sqlite3 = (await module.init()) as unknown as BrowserSqlite

  // Always ask the network for the manifest: it is tiny, and it is what says a new build is out.
  const manifestResponse = await fetch(manifestUrl, { cache: 'no-cache' })
  if (!manifestResponse.ok) throw new Error(`Could not load the search manifest (${manifestResponse.status})`)
  const manifest = (await manifestResponse.json()) as SearchManifest

  let pool: HandlePool | null = null
  try {
    pool = (await sqlite3.installOpfsSAHPoolVfs?.({ name: 'shabd-search', initialCapacity: 2 })) ?? null
  } catch {
    // No OPFS here, or another tab has the stored file open.
  }

  if (pool) {
    try {
      let db: SqliteDatabase | null = null
      if (pool.getFileNames().includes(STORED_NAME)) {
        db = new pool.OpfsSAHPoolDb(STORED_NAME)
        if (readSearchMeta(db)?.version !== manifest.version) {
          db.close()
          db = null
        }
      }
      if (!db) {
        await pool.importDb(STORED_NAME, await download(databaseUrl))
        db = new pool.OpfsSAHPoolDb(STORED_NAME)
      }
      return { store: new SqliteStore(db), persistent: true }
    } catch {
      // A stored file that cannot be used is not worth failing search over: read from memory instead.
    }
  }

  return { store: new SqliteStore(openSearchDatabase(sqlite3, await download(databaseUrl))), persistent: false }
}
