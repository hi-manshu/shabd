/**
 * Counts how often the two search stores give the same results for the same
 * query, on a real site's index. The table under "How far they agree" in
 * docs/content/features/search.md comes from here.
 *
 *     npm run build
 *     node scripts/bench/store-agreement.mjs docs
 *
 * The queries are made from the site's own words of five letters or more,
 * 300 of each kind, and are the same on every run. Keyword search only: by
 * meaning the two stores run the same code over the same vectors.
 */
import path from 'node:path'
import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import { compilePage, createContext } from '../../packages/shabd/dist/node/context.js'
import { chunkPage } from '../../packages/shabd/dist/node/search/chunk.js'
import { MemoryStore, tokenize } from '../../packages/shabd/dist/shared/search-core.js'
import { openSearchDatabase, SqliteStore, writeSearchDatabase } from '../../packages/shabd/dist/shared/sqlite-store.js'

const QUERIES = 300
const RESULTS = 8

const context = await createContext(path.resolve(process.argv[2] ?? 'docs'), { dev: false })
const docs = []
for (const page of context.store.pages()) docs.push(...chunkPage(page, (await compilePage(context, page)).sections))
await context.compiler.cache.flush()

const file = { version: 1, docs, semantic: null }
const sqlite3 = await sqlite3InitModule()
const memory = new MemoryStore(file, null)
const sqlite = new SqliteStore(openSearchDatabase(sqlite3, writeSearchDatabase(sqlite3, file, null, 'agreement')))

const words = [...new Set(docs.flatMap((doc) => tokenize(`${doc.title} ${doc.heading} ${doc.text}`)))].filter(
  (word) => word.length >= 5 && !/\d/.test(word),
)
let seed = 12345
const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296
const word = () => words[Math.floor(next() * words.length)]
/** Two neighbouring letters swapped. */
const misspelt = (right) => right.slice(0, 2) + right[3] + right[2] + right.slice(4)

const kinds = {
  'one word, finished': () => `${word()} `,
  'two words, finished': () => `${word()} ${word()} `,
  'one misspelt word': () => `${misspelt(word())} `,
  'a misspelt word and a right one': () => `${misspelt(word())} ${word()} `,
  'one word, three letters typed': () => word().slice(0, 3),
  'one word, four letters typed': () => word().slice(0, 4),
  'two words, the second with four letters typed': () => `${word()} ${word().slice(0, 4)}`,
}

console.log(`${docs.length} sections, ${words.length} words of five letters or more to make queries from\n`)
console.log(`${'query'.padEnd(46)} same first result   same sections   same order`)
for (const [kind, make] of Object.entries(kinds)) {
  const same = { first: 0, sections: 0, order: 0 }
  for (let i = 0; i < QUERIES; i++) {
    const query = make()
    const found = (store) => store.search(query, null, RESULTS).map((hit) => `${hit.doc.path}#${hit.doc.anchor}`)
    const [a, b] = [found(memory), found(sqlite)]
    if (a[0] === b[0]) same.first++
    if ([...a].sort().join() === [...b].sort().join()) same.sections++
    if (a.join() === b.join()) same.order++
  }
  const of = (count) => `${count} of ${QUERIES}`.padEnd(16)
  console.log(`${kind.padEnd(46)} ${of(same.first)}    ${of(same.sections)}${of(same.order)}`)
}
sqlite.close()
