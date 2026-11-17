import { describe, expect, it } from 'vitest'
import { chunkPage, embeddingInput } from '../src/node/search/chunk.js'
import { locatePassage, passageTarget } from '../src/shared/passage.js'
import {
  fuseRanks,
  KeywordIndex,
  makeSnippet,
  quantize,
  queryTerms,
  rankBySimilarity,
  search,
  similarities,
  tokenize,
  wordSpans,
  wordsToMark,
  type SearchDoc,
} from '../src/shared/search-core.js'

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
]
const index = new KeywordIndex(docs)
const top = (query: string) => index.search(query, 5).map((hit) => docs[hit.doc]!.heading)

describe('tokenize', () => {
  it('lower-cases, splits on punctuation and folds Latin accents', () => {
    expect(tokenize('Café-au-lait, 2 cups!')).toEqual(['cafe', 'au', 'lait', '2', 'cups'])
  })

  it('keeps words in scripts that use combining marks whole', () => {
    expect(tokenize('शब्द का अर्थ')).toEqual(['शब्द', 'का', 'अर्थ'])
  })

  it('drops filler words from a query, but not the word being typed', () => {
    expect(queryTerms('how do I change the colours ')).toEqual(['change', 'colours'])
    expect(queryTerms('change the')).toEqual(['change', 'the'])
    expect(queryTerms('the')).toEqual(['the'])
  })

  it('says where each word is in the text it came from', () => {
    const text = 'Café-au-lait, 2 cups!'
    const spans = wordSpans(text)
    expect(spans.map((span) => span.token)).toEqual(tokenize(text))
    expect(spans.map((span) => text.slice(span.start, span.end))).toEqual(['Café', 'au', 'lait', '2', 'cups'])
  })

  it('marks the words of a query that say why a result matched, not the very short ones', () => {
    expect(wordsToMark('how do I change the colours')).toEqual(['change', 'colours'])
    expect(wordsToMark('go to it')).toEqual([])
  })
})

describe('keyword search', () => {
  it('finds sections by the words they contain', () => {
    expect(top('installer')).toEqual(['Install'])
    expect(top('static host')).toEqual(['Hosting'])
  })

  it('ranks a heading match above a body match', () => {
    expect(top('colours')[0]).toBe('Colours')
    // "server" is in the body of two sections; "install" is the heading of one.
    expect(top('install server')[0]).toBe('Install')
  })

  it('prefers sections that match every word', () => {
    expect(top('font scale headings')[0]).toBe('Typography')
  })

  it('matches the unfinished last word as a prefix', () => {
    expect(top('typog')).toEqual(['Typography'])
    // A trailing space says the word is finished, so it must match exactly.
    expect(top('typog ')).toEqual([])
  })

  it('returns nothing for words that are not in the index', () => {
    expect(top('zzqqxx')).toEqual([])
    expect(top('   ')).toEqual([])
  })
})

describe('vectors', () => {
  const unit = (values: number[]) => {
    const length = Math.hypot(...values)
    return values.map((value) => value / length)
  }

  it('keeps cosine similarity close after quantising to bytes', () => {
    const a = unit([0.2, -0.4, 0.6, 0.1])
    const b = unit([0.25, -0.35, 0.55, 0.2])
    const exact = a.reduce((sum, value, i) => sum + value * b[i]!, 0)
    const [approximate] = similarities(a, quantize(b), 4)
    expect(approximate).toBeCloseTo(exact, 2)
  })

  it('ranks by similarity and drops what is below the threshold', () => {
    const scores = new Float32Array([0.2, 0.9, 0.5, 0.36])
    expect(rankBySimilarity(scores, 10, 0.35)).toEqual([1, 2, 3])
    expect(rankBySimilarity(scores, 1, 0.35)).toEqual([1])
  })
})

describe('hybrid search', () => {
  it('fuses ranked lists so agreement beats a single first place', () => {
    const fused = fuseRanks([
      [0, 1, 2],
      [1, 3, 0],
    ])
    const order = [...fused].sort((a, b) => b[1] - a[1]).map(([id]) => id)
    expect(order[0]).toBe(1)
    expect(order.at(-1)).toBe(2)
  })

  it('adds semantic matches that share no word with the query, and says so', () => {
    // One-hot vectors: each section is its own direction, the query points at "Hosting".
    const vectors = new Int8Array(docs.length * docs.length)
    docs.forEach((_, i) => {
      vectors[i * docs.length + i] = 127
    })
    const query = [0, 0, 0, 1]
    const hits = search(index, { vectors, dims: docs.length }, query, 'publish my documentation online', 3)
    expect(hits[0]?.doc.heading).toBe('Hosting')
    expect(hits[0]?.matched).toEqual({ keywords: false, meaning: true })
  })

  it('falls back to keywords when there is no query vector', () => {
    const hits = search(index, null, null, 'accent colour', 3)
    expect(hits[0]?.doc.heading).toBe('Colours')
    expect(hits[0]?.matched).toEqual({ keywords: true, meaning: false })
  })
})

describe('snippets', () => {
  const long = `${'Filler sentence about nothing in particular. '.repeat(8)}The highlight colour marks the current page. ${'More filler follows here. '.repeat(8)}`

  it('centres on the first matching word and cuts at word boundaries', () => {
    const snippet = makeSnippet(long, 'highlight colour', 120)
    expect(snippet).toContain('highlight colour')
    expect(snippet.startsWith('…')).toBe(true)
    expect(snippet.endsWith('…')).toBe(true)
    expect(snippet.length).toBeLessThanOrEqual(124)
  })

  it('returns short text unchanged', () => {
    expect(makeSnippet('Short text.', 'short')).toBe('Short text.')
  })
})

describe('chunking', () => {
  const page = { path: '/guide', title: 'Guide', description: 'A short guide.' }

  it('makes one unit per section and puts the description in the opening one', () => {
    const units = chunkPage(page, [
      { anchor: '', heading: '', depth: 0, text: 'Opening text.' },
      { anchor: 'setup', heading: 'Setup', depth: 2, text: 'Do this first.' },
    ])
    expect(units.map((unit) => [unit.anchor, unit.text])).toEqual([
      ['', 'A short guide. Opening text.'],
      ['setup', 'Do this first.'],
    ])
    expect(embeddingInput(units[1]!)).toBe('Guide: Setup\nDo this first.')
  })

  it('gives a page that opens with a heading an entry of its own', () => {
    const units = chunkPage(page, [{ anchor: 'setup', heading: 'Setup', depth: 2, text: 'Do this first.' }])
    expect(units[0]).toMatchObject({ anchor: '', heading: '', text: 'A short guide.' })
  })

  it('splits long sections into overlapping passages', () => {
    const words = Array.from({ length: 450 }, (_, i) => `w${i}`)
    const units = chunkPage(page, [{ anchor: 'long', heading: 'Long', depth: 2, text: words.join(' ') }])
    const passages = units.filter((unit) => unit.anchor === 'long')
    expect(passages).toHaveLength(3)
    expect(passages[0]!.text.split(' ')).toHaveLength(200)
    // Each passage starts 160 words after the previous one, so 40 words overlap.
    expect(passages[1]!.text.startsWith('w160 ')).toBe(true)
    expect(passages.at(-1)!.text.endsWith(' w449')).toBe(true)
  })
})

describe('finding a passage in its section', () => {
  const page = { path: '/guide', title: 'Guide', description: '' }
  const section = Array.from({ length: 450 }, (_, i) => `w${i}`)
  const passages = chunkPage(page, [{ anchor: 'long', heading: 'Long', depth: 2, text: section.join(' ') }])
    .filter((unit) => unit.anchor === 'long')
    .map((unit) => tokenize(unit.text))

  it('finds each passage by its first and last word', () => {
    expect(passages.map((passage) => locatePassage(section, passage))).toEqual([
      { first: 0, last: 199 },
      { first: 160, last: 359 },
      { first: 320, last: 449 },
    ])
  })

  it('is not thrown by words the page shows and the index never saw, or the other way round', () => {
    // The label of a code block and its copy button, in the middle of the passage.
    const withLabels = [...section.slice(0, 200), 'ts', 'copy', ...section.slice(200)]
    expect(locatePassage(withLabels, passages[1]!)).toEqual({ first: 160, last: 361 })
    // A title before every tenth word, as a row of cards has.
    const withTitles = section.flatMap((word, index) => (index % 10 === 0 ? ['card', 'title', word] : [word]))
    expect(locatePassage(withTitles, passages[1]!)).toEqual({
      first: withTitles.indexOf('w160'),
      last: withTitles.indexOf('w359'),
    })
    // The code of a live sandbox, sixty words of it, which the page keeps in a text field where it is not text.
    const withoutCode = [...section.slice(0, 220), ...section.slice(280)]
    expect(locatePassage(withoutCode, passages[1]!)).toEqual({ first: 160, last: 299 })
  })

  it('tells a passage from an earlier one that opens with the same words', () => {
    const refrain = tokenize('the same few words arranged in a slightly different order')
    const before = Array.from({ length: 300 }, (_, i) => `before${i}`)
    const after = Array.from({ length: 150 }, (_, i) => `after${i}`)
    const words = [...refrain, ...before, ...refrain, ...after]
    expect(locatePassage(words, [...refrain, ...after])).toEqual({ first: 310, last: 469 })
  })

  it('says so when the section does not hold the passage', () => {
    expect(locatePassage(section, tokenize('none of these words are in the section at all'))).toBeNull()
    // A few words in common are not a passage.
    expect(locatePassage(section, [...tokenize('ten words that the section has never had in it'), 'w7', 'w8'])).toBeNull()
    expect(locatePassage([], passages[0]!)).toBeNull()
    expect(locatePassage(section, [])).toBeNull()
  })

  it('carries a passage of ordinary length whole, and cuts one that is far longer', () => {
    const text = section.slice(0, 200).join(' ')
    expect(passageTarget(text, ['w1'])).toEqual({ text, words: ['w1'] })
    expect(passageTarget('x'.repeat(100_000), []).text.length).toBeLessThan(10_000)
  })
})
