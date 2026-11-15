/**
 * Writes the search index as a SQLite database, for sites that set
 * `features.search.store: sqlite`.
 *
 * The file is produced with the same SQLite WebAssembly build the browser
 * reads it with (see src/shared/sqlite-store.ts), which runs in Node as well.
 * `@sqlite.org/sqlite-wasm` is an optional peer dependency: without it the
 * site falls back to the in-memory store.
 */
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { SearchManifest } from '../../shared/search-core.js'
import { SQLITE_SCHEMA_VERSION, writeSearchDatabase, type SqliteApi } from '../../shared/sqlite-store.js'
import type { BuiltIndex } from './service.js'

export interface BuiltDatabase {
  bytes: Uint8Array
  manifest: SearchManifest
}

const PACKAGE = '@sqlite.org/sqlite-wasm'
let loading: Promise<SqliteApi | null> | undefined

function loadSqlite(root: string): Promise<SqliteApi | null> {
  loading ??= (async () => {
    type Init = { default: () => Promise<unknown> }
    let module: Init
    try {
      module = (await import(PACKAGE)) as Init
    } catch {
      try {
        // Not resolvable from Shabd's own location (strict package managers): try the site's.
        const resolved = createRequire(path.join(root, 'package.json')).resolve(PACKAGE)
        module = (await import(pathToFileURL(resolved).href)) as Init
      } catch {
        return null
      }
    }
    return (await module.default()) as SqliteApi
  })()
  return loading
}

/** Changes exactly when the indexed content (or the table layout) changes. */
function fingerprint(built: BuiltIndex): string {
  const hash = createHash('sha1')
  hash.update(String(SQLITE_SCHEMA_VERSION))
  hash.update(JSON.stringify(built.file))
  if (built.vectors) hash.update(built.vectors)
  return hash.digest('hex').slice(0, 16)
}

export async function buildSearchDatabase(built: BuiltIndex, root: string): Promise<BuiltDatabase | null> {
  const sqlite3 = await loadSqlite(root)
  if (!sqlite3) return null
  const version = fingerprint(built)
  const bytes = writeSearchDatabase(sqlite3, built.file, built.vectors, version)
  return { bytes, manifest: { version, bytes: bytes.length, sections: built.file.docs.length } }
}
