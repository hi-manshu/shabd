/**
 * The search index as a SQLite database.
 *
 * The same file is written at build time (in Node) and read in the reader's
 * browser, both through SQLite compiled to WebAssembly, so the full-text
 * tokenizer and the file format are identical on both sides by construction.
 *
 *   sections      one row per searchable section, with its vector as a BLOB
 *   sections_fts  an FTS5 index over title, heading and text
 *   meta          schema version, content fingerprint, embedding model
 *
 * Keyword ranking is FTS5's BM25. Semantic ranking is a scan of the vector
 * column through a SQL function implemented here. Both feed the same rank
 * fusion as the in-memory store (src/shared/search-core.ts).
 *
 * This module takes the SQLite API as an argument and touches nothing else,
 * so it runs unchanged in Node, in a Web Worker, and in tests.
 */
import {
  candidatePool,
  fuseHits,
  makeSnippet,
  MIN_SIMILARITY,
  queryTerms,
  type SearchDoc,
  type SearchHit,
  type SearchIndexFile,
  type SearchStore,
} from './search-core.js'

/** Bump when the tables change. A database with another version is rebuilt, not read. */
export const SQLITE_SCHEMA_VERSION = 1

/** Column weights for BM25, in table order: title, heading, text. They mirror the in-memory index. */
const BM25_WEIGHTS = '2.0, 3.0, 1.0'

/* The slice of the sqlite-wasm API used here. Declared structurally so that
   `@sqlite.org/sqlite-wasm` stays an optional dependency, even for types. */

export interface SqliteStatement {
  bind(values: unknown[]): SqliteStatement
  stepReset(): unknown
  finalize(): unknown
}

export interface SqliteDatabase {
  pointer?: number | undefined
  exec(sql: string): unknown
  prepare(sql: string): SqliteStatement
  selectObjects(sql: string, bind?: unknown[]): Record<string, unknown>[]
  selectValue(sql: string, bind?: unknown[]): unknown
  createFunction(
    name: string,
    fn: (context: unknown, ...args: unknown[]) => unknown,
    options?: { arity?: number; deterministic?: boolean },
  ): unknown
  checkRc(resultCode: number): unknown
  close(): void
}

export interface SqliteApi {
  oo1: { DB: new (filename?: string) => SqliteDatabase }
  capi: {
    sqlite3_js_db_export(db: number): Uint8Array
    sqlite3_deserialize(db: number, schema: string, data: number, size: number, bufferSize: number, flags: number): number
    SQLITE_DESERIALIZE_FREEONCLOSE: number
    SQLITE_DESERIALIZE_READONLY: number
  }
  wasm: { allocFromTypedArray(bytes: Uint8Array): number }
}

const SCHEMA = `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
  CREATE TABLE sections (
    id INTEGER PRIMARY KEY,
    path TEXT NOT NULL,
    anchor TEXT NOT NULL,
    title TEXT NOT NULL,
    heading TEXT NOT NULL,
    text TEXT NOT NULL,
    vector BLOB
  );
  -- External content: the index points at the rows above instead of storing the text a second time.
  -- No prefix index and full detail, chosen by measurement on 20,000 sections:
  -- a prefix index made as-you-type queries 0.9 ms faster and the file 60% larger,
  -- and dropping positional detail made the file smaller but ranking five times slower.
  CREATE VIRTUAL TABLE sections_fts USING fts5(
    title, heading, text,
    content = 'sections', content_rowid = 'id',
    tokenize = 'unicode61 remove_diacritics 2'
  );
`

/* ───────────────────────────── writing ───────────────────────────── */

/**
 * Build the database for an index and return its bytes.
 *
 * `version` identifies the content. The browser compares it with the copy it
 * already holds to decide whether to download the file again.
 */
export function writeSearchDatabase(
  sqlite3: SqliteApi,
  index: SearchIndexFile,
  vectors: Int8Array | null,
  version: string,
): Uint8Array {
  const dims = index.semantic?.dims ?? 0
  const hasVectors = index.semantic !== null && vectors !== null && vectors.length === index.docs.length * dims
  const db = new sqlite3.oo1.DB(':memory:')
  try {
    db.exec(SCHEMA)
    db.exec('BEGIN')
    const insert = db.prepare(
      'INSERT INTO sections (id, path, anchor, title, heading, text, vector) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    index.docs.forEach((doc, position) => {
      const vector = hasVectors
        ? new Uint8Array(vectors!.buffer, vectors!.byteOffset + position * dims, dims).slice()
        : null
      // Row ids start at 1; a section's id is its position in the index plus one.
      insert.bind([position + 1, doc.path, doc.anchor, doc.title, doc.heading, doc.text, vector]).stepReset()
    })
    insert.finalize()
    db.exec('INSERT INTO sections_fts (rowid, title, heading, text) SELECT id, title, heading, text FROM sections')

    const meta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)')
    const entries: Record<string, string> = {
      schema: String(SQLITE_SCHEMA_VERSION),
      version,
      sections: String(index.docs.length),
      model: hasVectors ? index.semantic!.model : '',
      dims: hasVectors ? String(dims) : '0',
    }
    for (const [key, value] of Object.entries(entries)) meta.bind([key, value]).stepReset()
    meta.finalize()
    db.exec('COMMIT')

    // Merge the index into one segment and drop free pages: the file is written once and only read after.
    db.exec("INSERT INTO sections_fts (sections_fts) VALUES ('optimize')")
    db.exec('VACUUM')
    return sqlite3.capi.sqlite3_js_db_export(db.pointer!)
  } finally {
    db.close()
  }
}

/* ───────────────────────────── reading ───────────────────────────── */

/** Open database bytes as an in-memory, read-only database. */
export function openSearchDatabase(sqlite3: SqliteApi, bytes: Uint8Array): SqliteDatabase {
  const db = new sqlite3.oo1.DB()
  const { capi } = sqlite3
  // SQLite takes ownership of the copy and frees it when the database closes.
  const pointer = sqlite3.wasm.allocFromTypedArray(bytes)
  db.checkRc(
    capi.sqlite3_deserialize(
      db.pointer!,
      'main',
      pointer,
      bytes.length,
      bytes.length,
      capi.SQLITE_DESERIALIZE_FREEONCLOSE | capi.SQLITE_DESERIALIZE_READONLY,
    ),
  )
  return db
}

/** What the `meta` table says about a database, or null if it is not one of ours (or an old schema). */
export function readSearchMeta(db: SqliteDatabase): { version: string; sections: number; model: string; dims: number } | null {
  try {
    const meta = Object.fromEntries(
      db.selectObjects('SELECT key, value FROM meta').map((row) => [String(row.key), String(row.value)]),
    )
    if (Number(meta.schema) !== SQLITE_SCHEMA_VERSION) return null
    return {
      version: meta.version ?? '',
      sections: Number(meta.sections ?? 0),
      model: meta.model ?? '',
      dims: Number(meta.dims ?? 0),
    }
  } catch {
    return null
  }
}

/**
 * A query for FTS5: every word as a quoted string, joined with OR, the word
 * still being typed as a prefix. Quoting means nothing a reader types can be
 * read as FTS5 syntax.
 */
export function toMatchExpression(query: string): string {
  const terms = queryTerms(query)
  const typing = !/\s$/.test(query)
  return terms
    .map((term, position) => {
      const quoted = `"${term.replaceAll('"', '""')}"`
      return typing && position === terms.length - 1 ? `${quoted}*` : quoted
    })
    .join(' OR ')
}

export class SqliteStore implements SearchStore {
  readonly kind = 'sqlite'
  readonly sections: number
  readonly semantic: { model: string; dims: number } | null
  /** The content fingerprint the database was built with. */
  readonly version: string
  #db: SqliteDatabase
  #queryVector: ArrayLike<number> | null = null

  constructor(db: SqliteDatabase) {
    const meta = readSearchMeta(db)
    if (!meta) throw new Error('Not a Shabd search database, or one written by another version.')
    this.#db = db
    this.sections = meta.sections
    this.version = meta.version
    this.semantic = meta.dims > 0 ? { model: meta.model, dims: meta.dims } : null

    // similarity(vector): cosine similarity between a stored vector and the
    // current query. The vectors are unit length and stored as signed bytes.
    db.createFunction(
      'similarity',
      (_context, blob) => {
        const query = this.#queryVector
        if (!query || !(blob instanceof Uint8Array)) return null
        let sum = 0
        for (let i = 0; i < blob.length; i++) sum += query[i]! * ((blob[i]! << 24) >> 24)
        return sum / 127
      },
      { arity: 1, deterministic: false },
    )
  }

  search(query: string, queryVector: ArrayLike<number> | null, limit: number, minSimilarity = MIN_SIMILARITY): SearchHit[] {
    const pool = candidatePool(limit)
    const ids = (rows: Record<string, unknown>[]) => rows.map((row) => Number(row.id) - 1)

    let keywordIds: number[] = []
    const match = toMatchExpression(query)
    if (match) {
      keywordIds = ids(
        this.#db.selectObjects(
          `SELECT rowid AS id FROM sections_fts WHERE sections_fts MATCH ? ORDER BY bm25(sections_fts, ${BM25_WEIGHTS}) LIMIT ?`,
          [match, pool],
        ),
      )
    }

    let meaningIds: number[] = []
    if (this.semantic && queryVector) {
      this.#queryVector = queryVector
      try {
        meaningIds = ids(
          this.#db.selectObjects(
            `SELECT id FROM (SELECT id, similarity(vector) AS score FROM sections WHERE vector IS NOT NULL)
             WHERE score >= ? ORDER BY score DESC LIMIT ?`,
            [minSimilarity, pool],
          ),
        )
      } finally {
        this.#queryVector = null
      }
    }

    const fused = fuseHits(keywordIds, meaningIds, limit)
    if (fused.length === 0) return []

    const rows = this.#db.selectObjects(
      `SELECT id, path, anchor, title, heading, text FROM sections WHERE id IN (${fused.map(() => '?').join(', ')})`,
      fused.map((hit) => hit.id + 1),
    )
    const docs = new Map<number, SearchDoc>(
      rows.map((row) => [
        Number(row.id) - 1,
        {
          path: String(row.path),
          anchor: String(row.anchor),
          title: String(row.title),
          heading: String(row.heading),
          text: String(row.text),
        },
      ]),
    )
    return fused.flatMap(({ id, score, matched }) => {
      const doc = docs.get(id)
      return doc ? [{ doc, score, matched, snippet: makeSnippet(doc.text, query) }] : []
    })
  }

  close(): void {
    this.#db.close()
  }
}
