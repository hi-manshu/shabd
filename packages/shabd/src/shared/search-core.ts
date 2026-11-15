/**
 * Search, without any I/O: tokenising, BM25, vector similarity and rank fusion.
 *
 * The same code runs in three places, so results agree everywhere:
 *   - the browser's search worker (keyword + semantic, on the reader's device)
 *   - the MCP server (so an agent searching the docs sees what a reader sees)
 *   - tests
 */

/** One searchable unit: a section of a page (long sections are split further). */
export interface SearchDoc {
  /** Route path of the page. */
  path: string
  /** Heading anchor within the page; empty for text before the first heading. */
  anchor: string
  /** Page title. */
  title: string
  /** Section heading; empty for the page's opening text. */
  heading: string
  text: string
}

/** Where the search files live, relative to the site root. Written by the build, served by the dev server. */
export const SEARCH_FILES = {
  /** Sections as JSON. Read by the in-memory store and by the MCP endpoint. */
  index: '_shabd/search-index.json',
  /** One signed byte per dimension per section. */
  vectors: '_shabd/search-vectors.bin',
  /** The same index as a SQLite database, when `features.search.store` is `sqlite`. */
  database: '_shabd/search.sqlite',
  /** Fingerprint and size of the database, so a browser can tell whether its copy is current. */
  manifest: '_shabd/search-manifest.json',
} as const

export interface SearchManifest {
  /** Fingerprint of the indexed content. */
  version: string
  bytes: number
  sections: number
}

/** The file the build writes and the worker fetches. */
export interface SearchIndexFile {
  version: 1
  docs: SearchDoc[]
  /** Present when embeddings were built. Vectors are in a separate binary file. */
  semantic: { model: string; dims: number } | null
}

export interface SearchHit {
  doc: SearchDoc
  score: number
  /** Which signals put this result on the list. */
  matched: { keywords: boolean; meaning: boolean }
  /** A passage of the section around the first matching word. */
  snippet: string
}

/* ─────────────────────────────── tokens ─────────────────────────────── */

const WORD = /[\p{L}\p{N}\p{M}]+/gu
const LATIN_DIACRITICS = /[\u0300-\u036f]/g

/**
 * Lower-cased words, with Latin accents folded (`café` matches `cafe`).
 * Combining marks in other scripts are kept: in Devanagari they are part of
 * the word, not decoration.
 */
export function tokenize(text: string): string[] {
  return text.toLowerCase().normalize('NFD').replace(LATIN_DIACRITICS, '').match(WORD) ?? []
}

/**
 * Words that say nothing about what a query is looking for. They are dropped
 * from queries (never from the index) so that "how do I change the colours"
 * is ranked on "change" and "colours". English only: for other languages the
 * list simply never matches.
 */
const STOPWORDS = new Set(
  'a an and are as at be by can do does for from how i in is it me my of on or that the this to was what when where which with you your'.split(
    ' ',
  ),
)

/** Query words worth matching. A query made only of stopwords is kept as it is. */
export function queryTerms(query: string): string[] {
  const words = tokenize(query)
  const typing = !/\s$/.test(query)
  // The word still being typed is kept: "the" may be the start of "theme".
  const kept = words.filter((word, index) => !STOPWORDS.has(word) || (typing && index === words.length - 1))
  return kept.length > 0 ? kept : words
}

/* ──────────────────────────── keyword index ─────────────────────────── */

const K1 = 1.2
const B = 0.75
/** A match in the heading or the page title counts for more than one in the body. */
const HEADING_WEIGHT = 3
const TITLE_WEIGHT = 2
/** Cap on how many indexed terms a typed prefix may expand to. */
const MAX_PREFIX_TERMS = 40
const PREFIX_DISCOUNT = 0.6

interface Posting {
  doc: number
  /** Weighted term frequency. */
  tf: number
}

/** A BM25 index over SearchDocs with as-you-type prefix matching on the last word. */
export class KeywordIndex {
  readonly docs: SearchDoc[]
  #postings = new Map<string, Posting[]>()
  #terms: string[]
  #lengths: Float32Array
  #averageLength: number

  constructor(docs: SearchDoc[]) {
    this.docs = docs
    this.#lengths = new Float32Array(docs.length)
    let total = 0

    docs.forEach((doc, index) => {
      const frequencies = new Map<string, number>()
      const add = (text: string, weight: number) => {
        for (const term of tokenize(text)) frequencies.set(term, (frequencies.get(term) ?? 0) + weight)
      }
      add(doc.text, 1)
      add(doc.heading, HEADING_WEIGHT)
      add(doc.title, TITLE_WEIGHT)

      let length = 0
      for (const [term, tf] of frequencies) {
        length += tf
        let postings = this.#postings.get(term)
        if (!postings) this.#postings.set(term, (postings = []))
        postings.push({ doc: index, tf })
      }
      this.#lengths[index] = length
      total += length
    })

    this.#averageLength = docs.length ? total / docs.length : 1
    this.#terms = [...this.#postings.keys()].sort()
  }

  /** Document indexes with scores, best first. */
  search(query: string, limit: number): { doc: number; score: number }[] {
    const words = queryTerms(query)
    if (words.length === 0) return []
    // While someone is typing, the last word is probably unfinished.
    const lastIsPrefix = !/\s$/.test(query)

    const scores = new Map<number, number>()
    const coverage = new Map<number, number>()

    words.forEach((word, position) => {
      const candidates: { term: string; weight: number }[] = []
      if (this.#postings.has(word)) candidates.push({ term: word, weight: 1 })
      if (lastIsPrefix && position === words.length - 1) {
        for (const term of this.#termsWithPrefix(word)) {
          if (term !== word) candidates.push({ term, weight: PREFIX_DISCOUNT })
        }
      }

      const matchedDocs = new Set<number>()
      for (const { term, weight } of candidates) {
        const postings = this.#postings.get(term)!
        const idf = Math.log(1 + (this.docs.length - postings.length + 0.5) / (postings.length + 0.5))
        for (const { doc, tf } of postings) {
          const normalised = tf + K1 * (1 - B + (B * this.#lengths[doc]!) / this.#averageLength)
          scores.set(doc, (scores.get(doc) ?? 0) + weight * idf * ((tf * (K1 + 1)) / normalised))
          matchedDocs.add(doc)
        }
      }
      for (const doc of matchedDocs) coverage.set(doc, (coverage.get(doc) ?? 0) + 1)
    })

    // A section matching every word should beat one that repeats a single word.
    const ranked = [...scores].map(([doc, score]) => ({
      doc,
      score: score * ((coverage.get(doc) ?? 0) / words.length) ** 2,
    }))
    ranked.sort((a, b) => b.score - a.score || a.doc - b.doc)
    return ranked.slice(0, limit)
  }

  #termsWithPrefix(prefix: string): string[] {
    let low = 0
    let high = this.#terms.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (this.#terms[middle]! < prefix) low = middle + 1
      else high = middle
    }
    const found: string[] = []
    for (let i = low; i < this.#terms.length && found.length < MAX_PREFIX_TERMS; i++) {
      const term = this.#terms[i]!
      if (!term.startsWith(prefix)) break
      found.push(term)
    }
    return found
  }
}

/* ───────────────────────────── vectors ──────────────────────────────── */

/** Unit vectors stored as one signed byte per dimension: a quarter of the size, for ~1% recall loss. */
export function quantize(vector: ArrayLike<number>): Int8Array {
  const out = new Int8Array(vector.length)
  for (let i = 0; i < vector.length; i++) out[i] = Math.max(-127, Math.min(127, Math.round(vector[i]! * 127)))
  return out
}

/**
 * Cosine similarity of a query against every stored vector.
 *
 * A linear scan is the right structure at documentation scale: 10,000
 * sections × 384 dimensions is 3.8 million multiply-adds, a few milliseconds,
 * with no index to build, ship or keep in sync.
 */
export function similarities(query: ArrayLike<number>, vectors: Int8Array, dims: number): Float32Array {
  const count = Math.floor(vectors.length / dims)
  const out = new Float32Array(count)
  for (let doc = 0; doc < count; doc++) {
    const offset = doc * dims
    let sum = 0
    for (let i = 0; i < dims; i++) sum += query[i]! * vectors[offset + i]!
    out[doc] = sum / 127
  }
  return out
}

/**
 * Below this cosine similarity a section is not "about" the query, however
 * it ranks among the others.
 *
 * The value suits the default model (all-MiniLM-L6-v2). Measured on Shabd's
 * own docs, sections that answered a query scored 0.37 to 0.52, the best
 * section for an unrelated query scored 0.31 to 0.32, and nonsense scored
 * under 0.2. Other models spread their scores differently, which is why
 * `features.search.minSimilarity` can change it.
 */
export const MIN_SIMILARITY = 0.35

export function rankBySimilarity(scores: Float32Array, limit: number, minimum = MIN_SIMILARITY): number[] {
  const candidates: number[] = []
  for (let doc = 0; doc < scores.length; doc++) if (scores[doc]! >= minimum) candidates.push(doc)
  candidates.sort((a, b) => scores[b]! - scores[a]!)
  return candidates.slice(0, limit)
}

/* ───────────────────────────── fusion ───────────────────────────────── */

/**
 * Reciprocal rank fusion: combine ranked lists without having to make BM25
 * scores and cosine similarities comparable. A result's score is the sum of
 * 1 / (k + rank) over the lists it appears in.
 */
export function fuseRanks(lists: number[][], k = 60): Map<number, number> {
  const fused = new Map<number, number>()
  for (const list of lists) {
    list.forEach((doc, rank) => fused.set(doc, (fused.get(doc) ?? 0) + 1 / (k + rank + 1)))
  }
  return fused
}

/* ───────────────────────────── snippets ─────────────────────────────── */

/** A window of `text` around the first query word, cut at word boundaries. */
export function makeSnippet(text: string, query: string, maxLength = 180): string {
  if (text.length <= maxLength) return text
  const words = new Set(queryTerms(query))
  let start = 0
  for (const match of text.matchAll(WORD)) {
    const [token = ''] = tokenize(match[0])
    if ([...words].some((word) => token.startsWith(word))) {
      start = Math.max(0, match.index - Math.floor(maxLength / 3))
      break
    }
  }
  if (start > 0) {
    const space = text.indexOf(' ', start)
    start = space === -1 || space - start > 20 ? start : space + 1
  }
  let end = Math.min(text.length, start + maxLength)
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end)
    if (space > start + maxLength / 2) end = space
  }
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`
}

/* ───────────────────────────── search ───────────────────────────────── */

export interface SemanticData {
  vectors: Int8Array
  dims: number
}

/** How many candidates each ranking contributes before fusion. */
export const candidatePool = (limit: number) => Math.max(limit * 3, 20)

export interface FusedHit {
  /** Position of the section in the index. */
  id: number
  score: number
  /** Which signals put this result on the list. */
  matched: { keywords: boolean; meaning: boolean }
}

/**
 * Merge a keyword ranking and a semantic ranking into one list.
 *
 * Every store (the in-memory one, the SQLite one) produces its two rankings
 * its own way and then calls this, so the final order follows one rule
 * wherever search runs.
 */
export function fuseHits(keywordIds: number[], meaningIds: number[], limit: number): FusedHit[] {
  const fused = fuseRanks(meaningIds.length ? [keywordIds, meaningIds] : [keywordIds])
  const inKeywords = new Set(keywordIds)
  const inMeaning = new Set(meaningIds)
  return [...fused]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, limit)
    .map(([id, score]) => ({ id, score, matched: { keywords: inKeywords.has(id), meaning: inMeaning.has(id) } }))
}

/**
 * Keyword search, semantic search, or both fused, over an in-memory index.
 *
 * `queryVector` is the embedded query. Pass null to search by keyword only
 * (semantic search is off, or the model has not finished loading).
 */
export function search(
  index: KeywordIndex,
  semantic: SemanticData | null,
  queryVector: ArrayLike<number> | null,
  query: string,
  limit: number,
  minSimilarity = MIN_SIMILARITY,
): SearchHit[] {
  const pool = candidatePool(limit)
  const keywordIds = index.search(query, pool).map((hit) => hit.doc)
  const meaningIds =
    semantic && queryVector
      ? rankBySimilarity(similarities(queryVector, semantic.vectors, semantic.dims), pool, minSimilarity)
      : []

  return fuseHits(keywordIds, meaningIds, limit).map(({ id, score, matched }) => {
    const doc = index.docs[id]!
    return { doc, score, matched, snippet: makeSnippet(doc.text, query) }
  })
}

/* ───────────────────────────── stores ───────────────────────────────── */

/**
 * Where a search index lives while it is being queried.
 *
 *   MemoryStore   the index as JavaScript objects and a typed array. Nothing
 *                 to download beyond the index itself. The default.
 *   SqliteStore   the index as a SQLite database (src/shared/sqlite-store.ts):
 *                 full-text search by FTS5, and in the browser the file is
 *                 kept in the origin-private file system and read page by
 *                 page, so a large index is neither re-downloaded nor held
 *                 in memory.
 */
export interface SearchStore {
  readonly kind: 'memory' | 'sqlite'
  readonly sections: number
  /** Set when the index carries vectors for semantic search. */
  readonly semantic: { model: string; dims: number } | null
  search(query: string, queryVector: ArrayLike<number> | null, limit: number, minSimilarity?: number): SearchHit[]
  close(): void
}

export class MemoryStore implements SearchStore {
  readonly kind = 'memory'
  readonly sections: number
  readonly semantic: { model: string; dims: number } | null
  #keywords: KeywordIndex
  #vectors: SemanticData | null

  constructor(index: SearchIndexFile, vectors: Int8Array | null) {
    this.#keywords = new KeywordIndex(index.docs)
    this.sections = index.docs.length
    // An index and a vector file from different builds do not line up; ignore the vectors then.
    const usable = index.semantic && vectors && vectors.length === index.docs.length * index.semantic.dims
    this.semantic = usable ? index.semantic : null
    this.#vectors = usable ? { vectors: vectors!, dims: index.semantic!.dims } : null
  }

  search(query: string, queryVector: ArrayLike<number> | null, limit: number, minSimilarity?: number): SearchHit[] {
    return search(this.#keywords, this.#vectors, queryVector, query, limit, minSimilarity)
  }

  close(): void {}
}
