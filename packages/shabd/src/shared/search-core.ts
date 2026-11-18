/**
 * Search, without any I/O: tokenising, BM25, vector similarity and rank fusion.
 *
 * The same code runs in three places, so results agree everywhere:
 *   - the browser's search worker (keyword + semantic, on the reader's device)
 *   - the MCP server (so an agent searching the docs sees what a reader sees)
 *   - tests
 */
import { editDistance } from './edit-distance.js'

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
  /** The words to mark in the snippet, and on the page when the reader goes to it: see `wordsToMark`. */
  marks: string[]
}

/* ─────────────────────────────── tokens ─────────────────────────────── */

const WORD = /[\p{L}\p{N}\p{M}]+/gu
const LATIN_DIACRITICS = /[\u0300-\u036f]/g

/** The form a word is indexed and matched in. */
const fold = (text: string) => text.toLowerCase().normalize('NFD').replace(LATIN_DIACRITICS, '')

/**
 * The scripts that are written without spaces between words: Chinese and
 * Japanese, Thai, and Lao, Khmer and Burmese, which are cut the same way.
 * A run of letters in one of them is a phrase or a sentence, not a word.
 *
 * A letter is taken by the scripts it is used in, not the one it belongs to:
 * the long-vowel mark in ブラウザー belongs to none, and is used in Japanese.
 */
const UNSPACED_SCRIPTS = ['Han', 'Hiragana', 'Katakana', 'Thai', 'Lao', 'Khmer', 'Myanmar']
  .map((script) => String.raw`\p{Script_Extensions=${script}}`)
  .join('')
const UNSPACED = new RegExp(`[${UNSPACED_SCRIPTS}]`, 'u')
/** A run of letters taken apart: stretches in those scripts (the first group), and what is between them. */
const STRETCH = new RegExp(`([${UNSPACED_SCRIPTS}]+)|[^${UNSPACED_SCRIPTS}]+`, 'gu')
/** A letter with the marks that sit on it. */
const LETTER = /\P{M}\p{M}*/gu

/** True for a word in a script that is written without spaces. */
export const isUnspaced = (word: string): boolean => UNSPACED.test(word)

let segmenter: Intl.Segmenter | null | undefined

/**
 * What cuts a stretch of such text into words: `Intl.Segmenter`, which has a
 * dictionary for each of these scripts, or null in a runtime without it.
 *
 * The locale is fixed, so that a build and a browser set to different
 * languages cut the same text the same way. Which locale it is matters
 * little: these scripts are cut by dictionary whatever the locale, and Node
 * gave the same words for `en`, `ja`, `zh` and `th`.
 */
function wordSegmenter(): Intl.Segmenter | null {
  if (segmenter === undefined) {
    segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('en', { granularity: 'word' }) : null
  }
  return segmenter
}

/**
 * Use this segmenter, or none (null), in place of the runtime's own. Tests
 * call it to see what a browser without `Intl.Segmenter` does. Pass
 * undefined to go back to the runtime's own.
 */
export function setSegmenter(next: Intl.Segmenter | null | undefined): void {
  segmenter = next
}

/**
 * Where the words of a stretch of unspaced text start and end.
 *
 * Without a segmenter there is no telling where a word ends, so every pair
 * of neighbouring letters is taken as one: 搜索功能 gives 搜索, 索功 and 功能.
 * Two of the three are words, and most words of Chinese are two letters long.
 */
function cutStretch(stretch: string): [start: number, end: number][] {
  const cutter = wordSegmenter()
  if (cutter) return Array.from(cutter.segment(stretch), (part) => [part.index, part.index + part.segment.length])
  const letters = [...stretch.matchAll(LETTER)]
  if (letters.length < 2) return [[0, stretch.length]]
  return letters.slice(1).map((letter, index) => [letters[index]!.index, letter.index + letter[0].length])
}

/**
 * Lower-cased words, with Latin accents folded (`café` matches `cafe`).
 * Combining marks in other scripts are kept: in Devanagari they are part of
 * the word, not decoration. Text in a script without spaces is cut into
 * words by a dictionary, or into pairs of letters where there is none.
 */
export function tokenize(text: string): string[] {
  // Text with no such script in it is cut exactly as it was before there was any cutting by dictionary.
  if (!UNSPACED.test(text)) return fold(text).match(WORD) ?? []
  return wordSpans(text).map((span) => span.token)
}

/** A word where it stands in a text, with the form it is indexed and matched in. */
export interface WordSpan {
  token: string
  start: number
  end: number
}

/**
 * The words of `text` and where each one is, for code that cuts or marks the
 * text itself: the excerpt under a result, the marks on a page.
 */
export function wordSpans(text: string): WordSpan[] {
  const spans: WordSpan[] = []
  const add = (start: number, end: number) => {
    // A run of accents on their own folds away to nothing.
    const [token] = fold(text.slice(start, end)).match(WORD) ?? []
    if (token) spans.push({ token, start, end })
  }
  for (const run of text.matchAll(WORD)) {
    if (!UNSPACED.test(run[0])) {
      add(run.index, run.index + run[0].length)
      continue
    }
    // Japanese runs Latin letters and digits into its own with no space between: "Node18以上".
    // Each stretch is cut on its own.
    for (const stretch of run[0].matchAll(STRETCH)) {
      const at = run.index + stretch.index
      if (stretch[1] === undefined) {
        add(at, at + stretch[0].length)
        continue
      }
      // The stretch is folded once and its words sliced out of the result, which is quicker than folding each
      // word: 2,000 sections of Chinese were cut in 400 ms where that took 480. It can be done where folding
      // moved no letter, which is where it left the length as it was.
      const folded = fold(stretch[0])
      const inPlace = folded.length === stretch[0].length
      for (const [start, end] of cutStretch(stretch[0])) {
        const token = inPlace ? folded.slice(start, end) : fold(stretch[0].slice(start, end))
        if (token) spans.push({ token, start: at + start, end: at + end })
      }
    }
  }
  return spans
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

/* ─────────────────────────────── typos ──────────────────────────────── */

/** A match by a word one edit from the one typed counts for half of an exact match; two edits, for a quarter. */
const TYPO_DISCOUNT = 0.5
/** Cap on how many indexed words a misspelt one may be taken for. */
const MAX_TYPO_TERMS = 20

/**
 * How many edits a query word is forgiven: none under four letters, one up
 * to seven, two from eight. A short word has too many neighbours for a near
 * miss to mean anything ("for", "far", "fir"). And a number one digit away
 * is another number, not a misspelling.
 */
export function typoBudget(word: string): number {
  if (/\p{N}/u.test(word)) return 0
  const letters = [...word].length
  return letters >= 8 ? 2 : letters >= 4 ? 1 : 0
}

/**
 * The indexed words a misspelt query word may have been meant as: those
 * within its budget of edits, nearest first. Filler words are never offered:
 * "form" is one edit from "for" and from "from", which most sections have.
 */
export function closeTerms(word: string, vocabulary: Iterable<string>): { term: string; edits: number }[] {
  const budget = typoBudget(word)
  if (budget === 0) return []
  const close: { term: string; edits: number }[] = []
  for (const term of vocabulary) {
    const edits = editDistance(word, term, budget)
    if (edits > 0 && edits <= budget && !STOPWORDS.has(term)) close.push({ term, edits })
  }
  close.sort((a, b) => a.edits - b.edits || (a.term < b.term ? -1 : 1))
  return close.slice(0, MAX_TYPO_TERMS)
}

/* ────────────────────────── looking a query up ───────────────────────── */

/** An indexed term that stands for a word of a query. */
export interface TermMatch {
  term: string
  /** What a match by it counts for, against 1 for the word as it was typed. */
  weight: number
  /** Set when the store is asked for every word that starts with `term`, and not for the term alone. */
  prefix?: true
}

/** How one word of a query is looked up in an index. */
export interface QueryWord {
  word: string
  terms: TermMatch[]
  /** True when the word itself matched nothing, and `terms` are the words it was taken for. */
  corrected: boolean
}

/** What a store says about the terms it holds, for a query to be looked up in it. */
export interface Vocabulary {
  /** The terms that match a word as it stands, and as the start of longer words when `asPrefix` is set. */
  find(word: string, asPrefix: boolean): TermMatch[]
  has(term: string): boolean
  /** Every term. Only asked for when a word has to be measured against all of them. */
  all(): Iterable<string>
}

/** A word longer than this is not cut again: it is no word, and every way of cutting it would be tried. */
const MAX_RECUT_LETTERS = 16

/**
 * A word cut along the index's own words: at each letter, the longest term
 * that starts there. A letter that starts none is passed over.
 */
function recut(word: string, has: (term: string) => boolean): string[] {
  // A letter goes with its marks: ド is held as ト and a mark, and サイト is another word.
  const letters = word.match(LETTER) ?? []
  if (letters.length > MAX_RECUT_LETTERS) return []
  const pieces: string[] = []
  let from = 0
  while (from < letters.length) {
    // The word as a whole is known not to be a term.
    let to = from === 0 ? letters.length - 1 : letters.length
    while (to > from && !has(letters.slice(from, to).join(''))) to--
    if (to === from) {
      from++
      continue
    }
    pieces.push(letters.slice(from, to).join(''))
    from = to
  }
  return pieces
}

/**
 * How each word of a query is looked up: as itself, as the start of a longer
 * word while it is being typed, and, only if that finds nothing, as the words
 * it may have been meant as.
 *
 * Both stores look a query up through this function, each with its own
 * vocabulary, so the same word is taken for the same terms in either.
 *
 * A word in a script without spaces gets two more tries before it is taken
 * for a misspelling, because a query is not always cut where the index was.
 *
 *   - The dictionary goes by what is around a word. Node gave แพ็กเกจ as
 *     แพ็ก, เก and จ in a sentence, and as แพ็ก and เกจ on its own.
 *   - Engines have different dictionaries. The SQLite store's index is cut
 *     by Node when the site is built, and the query by the reader's browser:
 *     Playwright's Firefox gave サイドバー as one word where Node gave サイド
 *     and バー, and ทำ and งาน where Node gave ทำงาน. (The in-memory store
 *     builds its index in the browser, so there both are cut by one engine.)
 *
 * So such a word is tried as the start of a longer word, and then cut again
 * along the words the index does have.
 */
export function planQuery(query: string, vocabulary: Vocabulary): QueryWord[] {
  const words = queryTerms(query)
  // While someone is typing, the last word is probably unfinished.
  const typing = !/\s$/.test(query)

  return words.map((word, position) => {
    const unfinished = typing && position === words.length - 1
    const found = vocabulary.find(word, unfinished)
    if (found.length > 0) return { word, terms: found, corrected: false }

    if (isUnspaced(word)) {
      const longer = unfinished ? [] : vocabulary.find(word, true)
      if (longer.length > 0) return { word, terms: longer, corrected: false }
      const pieces = recut(word, (term) => vocabulary.has(term))
      if (pieces.length > 0) return { word, terms: pieces.map((term) => ({ term, weight: 1 })), corrected: true }
    }

    // Only a word that matched nothing is taken for a misspelling, so a correct word is never second-guessed.
    const close = closeTerms(word, vocabulary.all())
    return {
      word,
      terms: close.map(({ term, edits }) => ({ term, weight: TYPO_DISCOUNT ** edits })),
      corrected: close.length > 0,
    }
  })
}

/** The words to look for in a result's text: the query's own, or what one that matched nothing was taken for. */
export function soughtWords(plan: readonly QueryWord[]): string[] {
  return plan.flatMap(({ word, terms, corrected }) => (corrected ? terms.map(({ term }) => term) : [word]))
}

/**
 * The words to mark where a result is shown. A word of the text is marked
 * when it starts with one of them. Very short ones ("a", "to") are left out:
 * marking them lights up half the text and says nothing about why it matched.
 * That is a rule for alphabets. In a script without spaces most words are
 * one or two letters long, so there every word is kept: see `spansToMark`.
 */
export function wordsToMark(plan: readonly QueryWord[]): string[] {
  return soughtWords(plan).filter((word) => word.length > 2 || isUnspaced(word))
}

/** One letter, with its marks, of a script without spaces. */
const isLoneLetter = (word: string) => isUnspaced(word) && (word.match(LETTER)?.length ?? 0) === 1

/**
 * The words of a text to mark, out of all its words: those that start with
 * one of `words` (see `wordsToMark`).
 *
 * In a script without spaces a word can be a single letter, and a query often
 * has one that is only grammar (的, の), or is a term the dictionary does not
 * know and has cut into its letters (侧, 边, 栏). Such a letter is marked
 * where it touches another marked word, as part of what was typed, and not
 * wherever else the text has it. A query that is one letter and no more is
 * marked wherever that letter is.
 */
export function spansToMark(spans: readonly WordSpan[], words: readonly string[]): WordSpan[] {
  const wanted = spans.filter((span) => words.some((word) => span.token.startsWith(word)))
  if (words.length < 2) return wanted
  return wanted.filter(
    (span, index) =>
      !isLoneLetter(span.token) || wanted[index - 1]?.end === span.start || wanted[index + 1]?.start === span.end,
  )
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

/**
 * A BM25 index over SearchDocs. The last word of a query also matches as the
 * start of a longer word, as it is typed, and a word that matches nothing
 * matches the words it may be a misspelling of.
 */
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
    return this.rank(this.plan(query), limit)
  }

  /** How each word of a query is looked up here: see `planQuery`. */
  plan(query: string): QueryWord[] {
    return planQuery(query, {
      find: (word, asPrefix) => {
        const terms: TermMatch[] = []
        if (this.#postings.has(word)) terms.push({ term: word, weight: 1 })
        if (asPrefix) {
          for (const term of this.#termsWithPrefix(word)) {
            if (term !== word) terms.push({ term, weight: PREFIX_DISCOUNT })
          }
        }
        return terms
      },
      has: (term) => this.#postings.has(term),
      all: () => this.#terms,
    })
  }

  /** Document indexes with scores, best first, for a query that has been looked up with `plan`. */
  rank(plan: readonly QueryWord[], limit: number): { doc: number; score: number }[] {
    if (plan.length === 0) return []
    const scores = new Map<number, number>()
    const coverage = new Map<number, number>()

    for (const { terms } of plan) {
      const matchedDocs = new Set<number>()
      for (const { term, weight } of terms) {
        const postings = this.#postings.get(term)!
        const idf = Math.log(1 + (this.docs.length - postings.length + 0.5) / (postings.length + 0.5))
        for (const { doc, tf } of postings) {
          const normalised = tf + K1 * (1 - B + (B * this.#lengths[doc]!) / this.#averageLength)
          scores.set(doc, (scores.get(doc) ?? 0) + weight * idf * ((tf * (K1 + 1)) / normalised))
          matchedDocs.add(doc)
        }
      }
      for (const doc of matchedDocs) coverage.set(doc, (coverage.get(doc) ?? 0) + 1)
    }

    // A section matching every word should beat one that repeats a single word.
    const ranked = [...scores].map(([doc, score]) => ({
      doc,
      score: score * ((coverage.get(doc) ?? 0) / plan.length) ** 2,
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

/**
 * A window of `text` around the first query word, cut at word boundaries.
 * `query` is the query as typed, or the words to look for when they are not
 * the ones typed: see `soughtWords`.
 */
export function makeSnippet(text: string, query: string | readonly string[], maxLength = 180): string {
  if (text.length <= maxLength) return text
  const words = typeof query === 'string' ? queryTerms(query) : query
  let start = 0
  for (const span of wordSpans(text)) {
    if (words.some((word) => span.token.startsWith(word))) {
      start = Math.max(0, span.start - Math.floor(maxLength / 3))
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
  const plan = index.plan(query)
  const keywordIds = index.rank(plan, pool).map((hit) => hit.doc)
  const meaningIds =
    semantic && queryVector
      ? rankBySimilarity(similarities(queryVector, semantic.vectors, semantic.dims), pool, minSimilarity)
      : []

  const sought = soughtWords(plan)
  const marks = wordsToMark(plan)
  return fuseHits(keywordIds, meaningIds, limit).map(({ id, score, matched }) => {
    const doc = index.docs[id]!
    return { doc, score, matched, snippet: makeSnippet(doc.text, sought), marks }
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
