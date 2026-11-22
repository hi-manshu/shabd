/**
 * Times the two search stores on a synthetic index. The numbers under
 * "Choosing a store" in docs/content/features/search.md come from here.
 *
 *     npm run build
 *     node --expose-gc scripts/bench/search-stores.mjs            # 2,000 and 20,000 sections
 *     node --expose-gc scripts/bench/search-stores.mjs 500 5000   # other sizes
 *
 * It runs in Node, with the code the browser runs (dist/shared) and the same
 * SQLite WebAssembly build. What it cannot show is the browser's own part:
 * the download, and the SQLite store reading its file from the browser's
 * private file system and not from memory.
 *
 * The index is made up, and the same on every run: sections of 120 words
 * drawn from 30,000 invented words, a few of them very common and most of
 * them rare, as in prose; and a vector of 384 dimensions for each section,
 * pointing nowhere in particular. `--expose-gc` is needed for the row "held
 * in memory" only.
 */
import { gzipSync } from 'node:zlib'
import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import { MemoryStore, quantize, tokenize } from '../../packages/shabd/dist/shared/search-core.js'
import { openSearchDatabase, SqliteStore, writeSearchDatabase } from '../../packages/shabd/dist/shared/sqlite-store.js'

const DIMS = 384
const WORDS_PER_SECTION = 120
const VOCABULARY = 30_000
const QUERIES = 200
const RESULTS = 8

/** A small seeded generator, so that every run builds the same index and asks the same questions. */
function seeded(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Invented words of two to four syllables. */
function makeVocabulary(next) {
  const consonants = 'bcdfghjklmnprstvwz'
  const vowels = 'aeiou'
  const letter = (from) => from[Math.floor(next() * from.length)]
  const words = new Set()
  while (words.size < VOCABULARY) {
    let word = ''
    const syllables = 2 + Math.floor(next() * 3)
    for (let i = 0; i < syllables; i++) word += letter(consonants) + letter(vowels) + (next() < 0.3 ? letter(consonants) : '')
    words.add(word)
  }
  return [...words]
}

/** Draws a word: the first of the vocabulary is drawn most often, the second half as often, and so on (Zipf). */
function makeDraw(vocabulary, next) {
  const upTo = new Float64Array(vocabulary.length)
  let total = 0
  for (let rank = 0; rank < vocabulary.length; rank++) upTo[rank] = total += 1 / (rank + 1)
  return () => {
    const target = next() * total
    let low = 0
    let high = vocabulary.length - 1
    while (low < high) {
      const middle = (low + high) >> 1
      if (upTo[middle] < target) low = middle + 1
      else high = middle
    }
    return vocabulary[low]
  }
}

function makeIndex(sections) {
  const next = seeded(42)
  const vocabulary = makeVocabulary(next)
  const draw = makeDraw(vocabulary, next)
  const words = (count) => Array.from({ length: count }, draw).join(' ')

  const docs = Array.from({ length: sections }, (_, i) => ({
    path: `/page-${Math.floor(i / 10)}`,
    anchor: `section-${i}`,
    title: `Page ${Math.floor(i / 10)}`,
    heading: words(3),
    text: words(WORDS_PER_SECTION),
  }))

  const vectors = new Int8Array(sections * DIMS)
  const unit = new Float32Array(DIMS)
  for (let i = 0; i < sections; i++) {
    let length = 0
    for (let d = 0; d < DIMS; d++) {
      // Three uniform draws added up are near enough to a normal one for a direction in space.
      unit[d] = next() + next() + next() - 1.5
      length += unit[d] * unit[d]
    }
    length = Math.sqrt(length)
    for (let d = 0; d < DIMS; d++) unit[d] /= length
    vectors.set(quantize(unit), i * DIMS)
  }
  return { file: { version: 1, docs, semantic: { model: 'synthetic', dims: DIMS } }, vectors, vocabulary, next }
}

/**
 * What is asked. Words are taken from the text of sections picked at random, so every one of them is in
 * the index, leaving out the hundred most common, as a reader's words are seldom "the" and "of".
 */
function makeQueries({ file, vectors, vocabulary, next }) {
  const common = new Set(vocabulary.slice(0, 100))
  const terms = new Set(file.docs.flatMap((doc) => tokenize(doc.text)))
  const word = () => {
    for (;;) {
      const text = file.docs[Math.floor(next() * file.docs.length)].text.split(' ')
      const picked = text[Math.floor(next() * text.length)]
      if (!common.has(picked) && picked.length >= 5) return picked
    }
  }
  /** Two neighbouring letters swapped, such that the result is not a word of the index. */
  const misspelt = () => {
    for (;;) {
      const right = word()
      const at = 1 + Math.floor(next() * (right.length - 2))
      const wrong = right.slice(0, at) + right[at + 1] + right[at] + right.slice(at + 2)
      if (wrong !== right && !terms.has(wrong)) return wrong
    }
  }
  const many = (make) => Array.from({ length: QUERIES }, make)
  return {
    // Two words, the second with its first four letters typed.
    typing: many(() => `${word()} ${word().slice(0, 4)}`),
    // Two finished words, the first of them misspelt.
    misspelt: many(() => `${misspelt()} ${word()} `),
    // A direction close to one section's, so that the section passes the similarity threshold.
    vectors: many(() => {
      const at = Math.floor(next() * file.docs.length) * DIMS
      return Float32Array.from(vectors.subarray(at, at + DIMS), (value) => value / 127)
    }),
  }
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const elapsed = (run) => {
  const started = performance.now()
  run()
  return performance.now() - started
}
/** The median time of one query, after a first pass that is not counted. */
function timeEach(queries, run) {
  queries.slice(0, 20).forEach(run)
  return median(queries.map((query, index) => elapsed(() => run(query, index))))
}
/** The median of a few runs of something done once, each run on a fresh start. */
const timeOnce = (run, runs = 5) => median(Array.from({ length: runs }, () => elapsed(run)))

const ms = (value) => `${value < 10 ? value.toFixed(2) : value.toFixed(0)} ms`
const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`
const inUse = () => {
  globalThis.gc()
  const { heapUsed, arrayBuffers } = process.memoryUsage()
  return heapUsed + arrayBuffers
}

const sqlite3 = await sqlite3InitModule()
const sizes = process.argv.slice(2).map(Number).filter((size) => size > 0)
console.log(`Node ${process.version} on ${process.platform} ${process.arch}, SQLite ${sqlite3.capi.sqlite3_libversion()}`)

for (const sections of sizes.length ? sizes : [2000, 20_000]) {
  const index = makeIndex(sections)
  const { file, vectors } = index
  const queries = makeQueries(index)
  const json = JSON.stringify(file)
  const vectorBytes = new Uint8Array(vectors.buffer)
  const rows = []
  const row = (name, value) => rows.push([name, value])

  /* ── the in-memory store ── */

  const openMemory = () => new MemoryStore(JSON.parse(json), new Int8Array(vectorBytes.buffer.slice(0)))
  row('memory: download, compressed', megabytes(gzipSync(json).length + gzipSync(vectorBytes).length))
  row('memory: time to open', ms(timeOnce(openMemory, 3)))
  if (globalThis.gc) {
    const before = inUse()
    const held = openMemory()
    row('memory: held in memory', megabytes(inUse() - before))
    held.close()
  }
  const memory = openMemory()
  row('memory: keyword query', ms(timeEach(queries.typing, (query) => memory.search(query, null, RESULTS))))
  row(
    'memory: with semantic',
    ms(timeEach(queries.typing, (query, at = 0) => memory.search(query, queries.vectors[at], RESULTS))),
  )
  row('memory: with a misspelt word', ms(timeEach(queries.misspelt, (query) => memory.search(query, null, RESULTS))))

  /* ── the SQLite store ── */

  const bytes = writeSearchDatabase(sqlite3, file, vectors, 'bench')
  const openSqlite = () => new SqliteStore(openSearchDatabase(sqlite3, bytes))
  /** Something a store does once, timed on a store that has not done it yet. */
  const first = (run) =>
    median(
      Array.from({ length: 5 }, () => {
        const store = openSqlite()
        const time = elapsed(() => run(store))
        store.close()
        return time
      }),
    )
  row('sqlite: download, compressed', megabytes(gzipSync(bytes).length))
  row('sqlite: time to open', ms(timeOnce(() => openSqlite().close())))
  const sqlite = openSqlite()
  row('sqlite: keyword query', ms(timeEach(queries.typing, (query) => sqlite.search(query, null, RESULTS))))
  row('sqlite: first query with semantic', ms(first((store) => store.search(queries.typing[0], queries.vectors[0], RESULTS))))
  row(
    'sqlite: with semantic',
    ms(timeEach(queries.typing, (query, at = 0) => sqlite.search(query, queries.vectors[at], RESULTS))),
  )
  row('sqlite: first misspelt word', ms(first((store) => store.search(queries.misspelt[0], null, RESULTS))))
  row('sqlite: with a misspelt word', ms(timeEach(queries.misspelt, (query) => sqlite.search(query, null, RESULTS))))

  // A run that found nothing would be quick, and worth nothing.
  const found = (store, list, withVectors) =>
    list.filter((query, at) => store.search(query, withVectors ? queries.vectors[at] : null, RESULTS).length > 0).length
  const byMeaning = (store) =>
    queries.vectors.filter((vector) => store.search('qqzzqq ', vector, RESULTS)[0]?.matched.meaning === true).length
  sqlite.close()

  console.log(`\n${sections} sections of ${WORDS_PER_SECTION} words, ${DIMS} dimensions`)
  for (const [name, value] of rows) console.log(`  ${name.padEnd(36)} ${value}`)
  const check = openSqlite()
  console.log(
    `  queries that found something: typing ${found(memory, queries.typing)} and ${found(check, queries.typing)} of ${QUERIES},` +
      ` misspelt ${found(memory, queries.misspelt)} and ${found(check, queries.misspelt)},` +
      ` by meaning alone ${byMeaning(memory)} and ${byMeaning(check)}`,
  )
  check.close()
}
