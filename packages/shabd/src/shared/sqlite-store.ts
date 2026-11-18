/**
 * The search index as a SQLite database.
 *
 * The same file is written at build time (in Node) and read in the reader's
 * browser, both through SQLite compiled to WebAssembly, so the file format
 * is identical on both sides by construction.
 *
 *   sections      one row per searchable section, with its vector as a BLOB
 *   sections_fts  an FTS5 index over the words of title, heading and text
 *   meta          schema version, content fingerprint, embedding model
 *
 * Keyword ranking is FTS5's BM25. Semantic ranking is a scan of the vector
 * column through a SQL function implemented here. Both feed the same rank
 * fusion as the in-memory store (src/shared/search-core.ts).
 *
 * The words are Shabd's, not FTS5's. FTS5's tokenisers split on spaces and
 * punctuation, which finds no words in Chinese, Japanese or Thai, and one of
 * them splits a Devanagari word at its combining marks. So the text is cut
 * into words by the tokeniser the in-memory store uses, here when the
 * database is written and again when it is asked, and FTS5 is handed the
 * words with spaces between them. The two stores then hold the same terms.
 *
 * FTS5 finds a word or the start of one. It has nothing for a misspelt word,
 * so that part is done here: the index's terms are read out once, the ones
 * close to the word are picked by the code the in-memory store uses, and
 * FTS5 is asked for those.
 *
 * This module takes the SQLite API as an argument and touches nothing else,
 * so it runs unchanged in Node, in a Web Worker, and in tests.
 */
import {
  candidatePool,
  fuseHits,
  makeSnippet,
  MIN_SIMILARITY,
  planQuery,
  queryTerms,
  soughtWords,
  tokenize,
  wordsToMark,
  type QueryWord,
  type SearchDoc,
  type SearchHit,
  type SearchIndexFile,
  type SearchStore,
} from './search-core.js'

/** Bump when the tables change. A database with another version is rebuilt, not read. */
export const SQLITE_SCHEMA_VERSION = 2

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
  selectValues(sql: string, bind?: unknown[]): unknown[]
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
  -- Contentless: the index holds no text of its own. What it is given is not the text of the rows
  -- above but their words (see the top of this file), and the text itself is read from those rows.
  -- The "ascii" tokeniser takes every character above ASCII as part of a word, so the words it is
  -- given, which have spaces between them and nothing else that is not a letter or a digit, come
  -- out as they went in.
  -- No prefix index and full detail, chosen by measurement on 20,000 sections:
  -- a prefix index made as-you-type queries 0.9 ms faster and the file 60% larger,
  -- and dropping positional detail made the file smaller but ranking five times slower.
  CREATE VIRTUAL TABLE sections_fts USING fts5(
    title, heading, text,
    content = '',
    tokenize = 'ascii'
  );
`

/** A text as FTS5 is given it: its words, with spaces between them. */
const asWords = (text: string) => tokenize(text).join(' ')

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
    const insertWords = db.prepare('INSERT INTO sections_fts (rowid, title, heading, text) VALUES (?, ?, ?, ?)')
    index.docs.forEach((doc, position) => {
      const vector = hasVectors
        ? new Uint8Array(vectors!.buffer, vectors!.byteOffset + position * dims, dims).slice()
        : null
      // Row ids start at 1; a section's id is its position in the index plus one.
      insert.bind([position + 1, doc.path, doc.anchor, doc.title, doc.heading, doc.text, vector]).stepReset()
      insertWords.bind([position + 1, asWords(doc.title), asWords(doc.heading), asWords(doc.text)]).stepReset()
    })
    insert.finalize()
    insertWords.finalize()

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

/** A word as FTS5 is asked for it: a quoted string, and a prefix when it is still being typed. */
function phrase(term: string, prefix: boolean): string {
  const quoted = `"${term.replaceAll('"', '""')}"`
  return prefix ? `${quoted}*` : quoted
}

/**
 * A query for FTS5: every word as a quoted string, joined with OR, the word
 * still being typed as a prefix. Quoting means nothing a reader types can be
 * read as FTS5 syntax.
 *
 * This is what the store asks when no word of the query is misspelt. It
 * builds that, and the queries for misspelt words, from the same quoting.
 */
export function toMatchExpression(query: string): string {
  const terms = queryTerms(query)
  const typing = !/\s$/.test(query)
  return terms.map((term, position) => phrase(term, typing && position === terms.length - 1)).join(' OR ')
}

export class SqliteStore implements SearchStore {
  readonly kind = 'sqlite'
  readonly sections: number
  readonly semantic: { model: string; dims: number } | null
  /** The content fingerprint the database was built with. */
  readonly version: string
  #db: SqliteDatabase
  #queryVector: ArrayLike<number> | null = null
  /** Every term of the index, once a misspelt word has made it worth reading them out. */
  #terms: string[] | null = null

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

  /**
   * The terms of the index, read out the first time a word is not found.
   *
   * FTS5 lists them through a table of its own kind, which holds nothing and
   * is made here, in the temporary schema, because the database is opened
   * read-only. Listing them means walking the whole index: 32 ms for 2,000
   * sections of 120 words and 106 ms for 20,000, measured in Node. A table
   * of terms written at build time would be read faster, and would make
   * every reader download it, misspelling or not.
   */
  #vocabulary(): readonly string[] {
    if (!this.#terms) {
      this.#db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS temp.sections_terms USING fts5vocab('main', 'sections_fts', 'row')")
      this.#terms = this.#db.selectValues('SELECT term FROM temp.sections_terms').map(String)
    }
    return this.#terms
  }

  /** Whether FTS5 finds anything for a word, or for the words that start with it. */
  #finds(term: string, asPrefix: boolean): boolean {
    const asked = phrase(term, asPrefix)
    return this.#db.selectValue('SELECT 1 FROM sections_fts WHERE sections_fts MATCH ? LIMIT 1', [asked]) !== undefined
  }

  /**
   * How each word of a query is looked up: see `planQuery`. A word that FTS5
   * finds, as itself or as the start of longer words, is left to FTS5, which
   * takes a prefix whole where the in-memory store lists the words under it.
   */
  #plan(query: string): QueryWord[] {
    return planQuery(query, {
      find: (word, asPrefix) =>
        this.#finds(word, asPrefix) ? [{ term: word, weight: 1, ...(asPrefix ? { prefix: true as const } : {}) }] : [],
      has: (term) => this.#finds(term, false),
      all: () => this.#vocabulary(),
    })
  }

  /** Section ids for a looked-up query, best first. */
  #rank(plan: readonly QueryWord[], limit: number): number[] {
    // FTS5's BM25 cannot weigh one word of a query against another. But it adds the words of a query up, so the
    // words are asked for in groups, one per weight, and the groups are added up here.
    const groups = new Map<number, string[]>()
    for (const { terms } of plan) {
      for (const { term, weight, prefix } of terms) {
        const asked = phrase(term, prefix === true)
        const group = groups.get(weight)
        if (group) group.push(asked)
        else groups.set(weight, [asked])
      }
    }
    if (groups.size === 0) return []

    const scored = `bm25(sections_fts, ${BM25_WEIGHTS})`
    const asked = [...groups].map(([weight, phrases]) => ({ weight, match: phrases.join(' OR ') }))
    // One group needs no adding up, whatever its weight: the order is FTS5's own. This is every query without a
    // misspelt word in it, and it is the query this store has always run.
    const rows =
      asked.length === 1
        ? this.#db.selectObjects(`SELECT rowid AS id FROM sections_fts WHERE sections_fts MATCH ? ORDER BY ${scored} LIMIT ?`, [
            asked[0]!.match,
            limit,
          ])
        : this.#db.selectObjects(
            // Materialised, so that each group is scored where FTS5 can score it. Left to itself, SQLite may
            // fold the groups into the sum, and bm25() cannot be called from inside one.
            `WITH scores (id, score) AS MATERIALIZED (${asked
              .map(() => `SELECT rowid, ? * ${scored} FROM sections_fts WHERE sections_fts MATCH ?`)
              .join(' UNION ALL ')})
             SELECT id FROM scores GROUP BY id ORDER BY SUM(score), id LIMIT ?`,
            [...asked.flatMap(({ weight, match }) => [weight, match]), limit],
          )
    return rows.map((row) => Number(row.id) - 1)
  }

  search(query: string, queryVector: ArrayLike<number> | null, limit: number, minSimilarity = MIN_SIMILARITY): SearchHit[] {
    const pool = candidatePool(limit)
    const ids = (rows: Record<string, unknown>[]) => rows.map((row) => Number(row.id) - 1)

    const plan = this.#plan(query)
    const keywordIds = this.#rank(plan, pool)

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
    const sought = soughtWords(plan)
    const marks = wordsToMark(plan)
    return fused.flatMap(({ id, score, matched }) => {
      const doc = docs.get(id)
      return doc ? [{ doc, score, matched, snippet: makeSnippet(doc.text, sought), marks }] : []
    })
  }

  close(): void {
    this.#db.close()
  }
}
