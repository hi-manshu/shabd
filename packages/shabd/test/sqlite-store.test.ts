/**
 * The SQLite search store, exercised with the real SQLite WebAssembly build:
 * a database is written the way a site build writes it, then opened from its
 * bytes the way the browser opens it.
 */
import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  MemoryStore,
  setSegmenter,
  tokenize,
  type SearchDoc,
  type SearchHit,
  type SearchIndexFile,
} from '../src/shared/search-core.js'
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

describe('typos, which FTS5 knows nothing of', () => {
  it('finds a section by a misspelt word', () => {
    expect(headings(store.search('colurs ', null, 5))).toEqual(['Colours'])
    expect(headings(store.search('tyopgraphy ', null, 5))).toEqual(['Typography'])
    expect(headings(store.search('typografy ', null, 5))).toEqual(['Typography'])
    expect(headings(store.search('srever ', null, 5))).toEqual(['Install', 'Hosting'])
    expect(headings(store.search('instaler', null, 5))).toEqual(['Install'])
  })

  it('does not forgive a word of three letters, or more edits than the word is allowed', () => {
    expect(store.search('fnt ', null, 5)).toEqual([])
    expect(store.search('colrs ', null, 5)).toEqual([])
  })

  it('ranks an exact match above a match by a misspelt word', () => {
    // FTS5 scores the words of a query alike, so the misspelt one is asked for apart and its score halved.
    expect(headings(store.search('font colours ', null, 5))).toEqual(['Colours', 'Typography'])
    expect(headings(store.search('font colurs ', null, 5))).toEqual(['Typography', 'Colours'])
  })

  it('marks what a misspelt word was taken for', () => {
    expect(store.search('hihglight ', null, 5)[0]?.marks).toEqual(['highlight'])
    expect(store.search('accent colour', null, 5)[0]?.marks).toEqual(['accent', 'colour'])
  })

  it('reads the terms of the index out only when a word is not found', () => {
    const database = openSearchDatabase(sqlite3, bytes)
    const fresh = new SqliteStore(database)
    const listed = () => database.selectValue("SELECT count(*) FROM sqlite_temp_master WHERE name = 'sections_terms'")
    fresh.search('colours typog', null, 5)
    expect(listed()).toBe(0)
    fresh.search('colurs ', null, 5)
    expect(listed()).toBe(1)
    fresh.close()
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

  it('take a misspelt word for the same words, and list what they find in the same order', () => {
    const cases: [string, number[] | null][] = [
      ['colurs ', null],
      ['tyopgraphy ', null],
      ['typografy ', null],
      ['instaler', null],
      ['srever ', null],
      ['hedings ', null],
      ['cofee ', null],
      // A misspelt word beside one that is spelt right, in either order.
      ['font colurs ', null],
      ['colurs font ', null],
      ['server instaler ', null],
      ['uplaod dist', null],
      // Nothing to forgive: too short, too far off, a number, and no word at all.
      ['fnt ', null],
      ['colrs ', null],
      ['8081 ', null],
      ['zzqqxx ', null],
      // With a section found by meaning as well.
      ['hedings ', pointingAt('Hosting')],
    ]
    const found = (hits: SearchHit[]) => hits.map((hit) => [hit.doc.heading, hit.marks, hit.matched])
    for (const [query, vector] of cases) {
      expect(found(store.search(query, vector, 5)), query).toEqual(found(memory.search(query, vector, 5)))
    }
    // The cases above are not all empty on both sides.
    expect(headings(memory.search('server instaler ', null, 5))).toEqual(['Install', 'Hosting'])
  })

  it('hold the same terms, cut by the same tokeniser', () => {
    const database = openSearchDatabase(sqlite3, bytes)
    database.exec("CREATE VIRTUAL TABLE temp.terms USING fts5vocab('main', 'sections_fts', 'row')")
    const inSqlite = database.selectValues('SELECT term FROM temp.terms').map(String).sort()
    database.close()
    const inMemory = [...new Set(docs.flatMap((d) => tokenize(`${d.title} ${d.heading} ${d.text}`)))].sort()
    expect(inSqlite).toEqual(inMemory)
    // FTS5's own tokenisers cut a Devanagari word at its marks, and leave an accent on.
    expect(inSqlite).toEqual(expect.arrayContaining(['शब्द', 'अर्थ', 'cafe']))
  })

  it('take a misspelt word for the same words in a script with combining marks', () => {
    // थ for त: one edit from अर्थ, which is four characters long.
    expect(headings(store.search('अर्त ', null, 5))).toEqual(['शब्द'])
    expect(headings(memory.search('अर्त ', null, 5))).toEqual(['शब्द'])
  })
})

describe('text in a script without spaces, which FTS5 does not cut into words', () => {
  afterEach(() => setSegmenter(undefined))

  const pages = [
    doc('/zh', '搜索', '搜索功能在读者的浏览器中运行，不需要任何搜索服务。侧边栏的宽度可以在主题配置中修改。'),
    doc('/ja', 'サイドバー', 'サイドバーの幅はテーマの設定で変更できます。検索は読者のブラウザーで実行されます。'),
    doc('/th', 'การค้นหา', 'การค้นหาทำงานในเบราว์เซอร์ของผู้อ่าน ติดตั้งแพ็กเกจแล้วเริ่มเซิร์ฟเวอร์สำหรับนักพัฒนา'),
    doc('/en', 'Install', 'Run the installer, then start the dev server.'),
  ]
  const file: SearchIndexFile = { version: 1, docs: pages, semantic: null }
  const inMemory = new MemoryStore(file, null)
  let inSqlite: SqliteStore
  beforeAll(() => {
    inSqlite = new SqliteStore(openSearchDatabase(sqlite3, writeSearchDatabase(sqlite3, file, null, 'scripts')))
  })
  const found = (hits: SearchHit[]) => hits.map((hit) => [hit.doc.path, hit.marks])
  const queries = [
    '浏览器',
    '读者',
    '侧边栏',
    '主题配置 ',
    '搜索功能',
    '浏',
    'サイドバー',
    'ブラウザー',
    '設定 ',
    'ブラウ',
    'ทำงาน',
    'เบราว์เซอร์ ',
    'ติดตั้ง',
    'แพ็กเกจ',
    '读者 読者 ',
    'installer 浏览器',
    '没有这个词 ',
  ]

  it('is found by its words', () => {
    expect(found(inSqlite.search('浏览器', null, 5)).map(([path]) => path)).toEqual(['/zh'])
    expect(found(inSqlite.search('ブラウザー', null, 5)).map(([path]) => path)).toEqual(['/ja'])
    expect(found(inSqlite.search('เบราว์เซอร์', null, 5)).map(([path]) => path)).toEqual(['/th'])
    expect(found(inSqlite.search('浏', null, 5)).map(([path]) => path)).toEqual(['/zh'])
  })

  it('is found the same way in both stores', () => {
    for (const query of queries) {
      expect(found(inSqlite.search(query, null, 5)), query).toEqual(found(inMemory.search(query, null, 5)))
    }
  })

  it('is found the same way in both stores when the browser cuts a word otherwise than the build did', () => {
    const own = new Intl.Segmenter('en', { granularity: 'word' })
    const cuts: Record<string, string[]> = {
      サイドバー: ['サイドバー'],
      ทำงาน: ['ทำ', 'งาน'],
      เบราว์เซอร์: ['เบราว์', 'เซอร์'],
      ติดตั้ง: ['ติดตั้ง'],
    }
    const segment = (text: string) => {
      const pieces = cuts[text]
      if (!pieces) return own.segment(text)
      let index = 0
      return pieces.map((piece) => ({ segment: piece, index: (index += piece.length) - piece.length, input: text }))
    }
    setSegmenter({ segment } as unknown as Intl.Segmenter)
    for (const query of Object.keys(cuts)) {
      const hits = found(inSqlite.search(`${query} `, null, 5))
      expect(hits, query).toEqual(found(inMemory.search(`${query} `, null, 5)))
      expect(hits.length, query).toBe(1)
    }
  })

  it('is found the same way in both stores when the browser has no dictionary to cut by', () => {
    setSegmenter(null)
    for (const query of queries) {
      expect(found(inSqlite.search(query, null, 5)), query).toEqual(found(inMemory.search(query, null, 5)))
    }
    expect(found(inSqlite.search('サイドバー', null, 5)).map(([path]) => path)).toEqual(['/ja'])
  })
})
