/**
 * The SQLite search store, exercised with the real SQLite WebAssembly build:
 * a database is written the way a site build writes it, then opened from its
 * bytes the way the browser opens it.
 */
import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import { beforeAll, describe, expect, it } from 'vitest'
import { MemoryStore, type SearchDoc, type SearchIndexFile } from '../src/shared/search-core.js'
import {
  openSearchDatabase,
  readSearchMeta,
  SqliteStore,
  toMatchExpression,
  writeSearchDatabase,
  type SqliteApi,
} from '../src/shared/sqlite-store.js'

const doc = (path: string, heading: string, text: string, title = 'Guide'): SearchDoc => ({
  path,
  anchor: heading.toLowerCase().replace(/\s+/g, '-'),
  title,
  heading,
  text,
})

const docs = [
  doc('/install', 'Install', 'Run the installer, then start the dev server.'),
  doc('/theme', 'Colours', 'Set the accent colour and the highlight colour in the theme section.'),
  doc('/theme', 'Typography', 'Choose a font stack and a type scale for headings.'),
  doc('/deploy', 'Hosting', 'Upload the dist folder to any static host. The server is not needed.'),
  doc('/hindi', 'शब्द', 'शब्द का अर्थ है word. A café serves coffee.'),
]

// One direction per section, so a query vector can point at exactly one of them.
const DIMS = docs.length
const vectors = new Int8Array(docs.length * DIMS)
docs.forEach((_, i) => {
  vectors[i * DIMS + i] = 127
})
const pointingAt = (heading: string) => docs.map((d) => (d.heading === heading ? 1 : 0))

const index: SearchIndexFile = { version: 1, docs, semantic: { model: 'test-model', dims: DIMS } }

let sqlite3: SqliteApi
let bytes: Uint8Array
let store: SqliteStore
const memory = new MemoryStore(index, vectors)
const headings = (hits: { doc: SearchDoc }[]) => hits.map((hit) => hit.doc.heading)

beforeAll(async () => {
  sqlite3 = (await sqlite3InitModule()) as unknown as SqliteApi
  bytes = writeSearchDatabase(sqlite3, index, vectors, 'fingerprint-1')
  store = new SqliteStore(openSearchDatabase(sqlite3, bytes))
})

describe('search database', () => {
  it('is a SQLite file that records what it was built from', () => {
    expect(new TextDecoder().decode(bytes.slice(0, 15))).toBe('SQLite format 3')
    expect(store.kind).toBe('sqlite')
    expect(store.sections).toBe(docs.length)
    expect(store.version).toBe('fingerprint-1')
    expect(store.semantic).toEqual({ model: 'test-model', dims: DIMS })
  })

  it('is written without vectors when the index has none', () => {
    const plain = writeSearchDatabase(sqlite3, { ...index, semantic: null }, null, 'v')
    const opened = new SqliteStore(openSearchDatabase(sqlite3, plain))
    expect(opened.semantic).toBeNull()
    expect(headings(opened.search('installer', pointingAt('Hosting'), 3))).toEqual(['Install'])
    opened.close()
  })

  it('refuses a database with another schema, or one that is not ours', () => {
    const other = new sqlite3.oo1.DB(':memory:')
    other.exec('CREATE TABLE unrelated (x)')
    expect(readSearchMeta(other)).toBeNull()
    expect(() => new SqliteStore(other)).toThrow(/Not a Shabd search database/)
    other.close()

    const old = new sqlite3.oo1.DB(':memory:')
    old.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT); INSERT INTO meta VALUES ('schema', '0')")
    expect(readSearchMeta(old)).toBeNull()
    old.close()
  })
})

describe('keyword search through FTS5', () => {
  it('finds sections by the words they contain', () => {
    expect(headings(store.search('installer', null, 5))).toEqual(['Install'])
    expect(headings(store.search('static host', null, 5))).toEqual(['Hosting'])
  })

  it('ranks a heading match above a body match', () => {
    expect(headings(store.search('colours', null, 5))[0]).toBe('Colours')
    expect(headings(store.search('install server', null, 5))[0]).toBe('Install')
  })

  it('matches the unfinished last word as a prefix', () => {
    expect(headings(store.search('typog', null, 5))).toEqual(['Typography'])
    expect(headings(store.search('typog ', null, 5))).toEqual([])
  })

  it('folds accents and keeps words in other scripts whole', () => {
    expect(headings(store.search('cafe ', null, 5))).toEqual(['शब्द'])
    expect(headings(store.search('शब्द ', null, 5))).toEqual(['शब्द'])
  })

  it('treats whatever is typed as words, never as query syntax', () => {
    expect(toMatchExpression('change the colours ')).toBe('"change" OR "colours"')
    expect(toMatchExpression('change col')).toBe('"change" OR "col"*')
    for (const hostile of ['"', 'colours"', 'NEAR(colours', 'title:colours', 'colours AND OR NOT', '*', '(((', "'; DROP TABLE sections; --"]) {
      expect(() => store.search(hostile, null, 5)).not.toThrow()
    }
    expect(headings(store.search('title:colours ', null, 5))[0]).toBe('Colours')
    expect(store.sections).toBe(docs.length)
  })

  it('returns a snippet around the match', () => {
    const [hit] = store.search('upload ', null, 1)
    expect(hit?.snippet).toContain('Upload the dist folder')
    expect(hit?.matched).toEqual({ keywords: true, meaning: false })
  })
})

describe('semantic search through a SQL function', () => {
  it('finds a section that shares no word with the query, and says so', () => {
    const hits = store.search('publish my documentation online', pointingAt('Hosting'), 3)
    expect(hits[0]?.doc.heading).toBe('Hosting')
    expect(hits[0]?.matched).toEqual({ keywords: false, meaning: true })
  })

  it('fuses both rankings: a section found both ways comes first', () => {
    const hits = store.search('font ', pointingAt('Typography'), 3)
    expect(hits[0]?.doc.heading).toBe('Typography')
    expect(hits[0]?.matched).toEqual({ keywords: true, meaning: true })
  })

  it('leaves out sections below the similarity threshold', () => {
    const weak = docs.map((d) => (d.heading === 'Hosting' ? 0.2 : 0))
    expect(store.search('zzqqxx', weak, 3)).toEqual([])
    expect(headings(store.search('zzqqxx', weak, 3, 0.1))).toEqual(['Hosting'])
  })
})

describe('the two stores', () => {
  it('agree on the best result for the same queries', () => {
    const cases: [string, number[] | null][] = [
      ['installer', null],
      ['colours', null],
      ['static host ', null],
      ['typog', null],
      ['font scale headings ', null],
      ['publish my documentation online', pointingAt('Hosting')],
      ['font ', pointingAt('Typography')],
    ]
    for (const [query, vector] of cases) {
      const fromSqlite = store.search(query, vector, 3)[0]?.doc.heading
      const fromMemory = memory.search(query, vector, 3)[0]?.doc.heading
      expect(fromSqlite, query).toBe(fromMemory)
    }
  })
})
