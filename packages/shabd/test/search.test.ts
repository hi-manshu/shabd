import { describe, expect, it } from 'vitest'
import { chunkPage, embeddingInput } from '../src/node/search/chunk.js'
import { editDistance } from '../src/shared/edit-distance.js'
import { locatePassage, passageTarget } from '../src/shared/passage.js'
import {
  closeTerms,
  fuseRanks,
  KeywordIndex,
  makeSnippet,
  quantize,
  queryTerms,
  rankBySimilarity,
  search,
  similarities,
  tokenize,
  typoBudget,
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
    expect(wordsToMark(index.plan('how do I change the colours'))).toEqual(['change', 'colours'])
    expect(wordsToMark(index.plan('go to it'))).toEqual([])
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

describe('typos', () => {
  it('counts the edits between two words, a swap of neighbours as one', () => {
    expect(editDistance('badge', 'badge')).toBe(0)
    expect(editDistance('bagde', 'badge')).toBe(1)
    expect(editDistance('colurs', 'colours')).toBe(1)
    expect(editDistance('colour', 'color')).toBe(1)
    expect(editDistance('kitten', 'sitting')).toBe(3)
    expect(editDistance('', 'abc')).toBe(3)
  })

  it('stops counting at a limit, and says only that the limit was passed', () => {
    expect(editDistance('kitten', 'sitting', 3)).toBe(3)
    expect(editDistance('kitten', 'sitting', 2)).toBe(3)
    expect(editDistance('kitten', 'sitting', 1)).toBe(2)
    expect(editDistance('a', 'abcdefgh', 2)).toBe(3)
  })

  it('forgives one edit from four letters and two from eight, and none in a short word or a number', () => {
    expect(['fnt', 'font', 'colours', 'headings', 'typography'].map(typoBudget)).toEqual([0, 1, 1, 2, 2])
    // A number one digit away is another number, not a misspelling.
    expect(['8080', 'es2023', 'sha256sum'].map(typoBudget)).toEqual([0, 0, 0])
  })

  it('finds a section by a misspelt word', () => {
    expect(top('colurs ')).toEqual(['Colours'])
    expect(top('tyopgraphy ')).toEqual(['Typography'])
    // Two edits in a long word: a letter missing and another one wrong.
    expect(top('typografy ')).toEqual(['Typography'])
    expect(top('srever ')).toEqual(['Install', 'Hosting'])
    // The word still being typed is forgiven once it is close to a whole word.
    expect(top('instaler')).toEqual(['Install'])
  })

  it('does not forgive a word of three letters, or more edits than the word is allowed', () => {
    expect(top('fnt ')).toEqual([])
    expect(top('colrs ')).toEqual([])
  })

  it('takes a word for a misspelling only when it matches nothing', () => {
    // "colour" is in the index, so it is not also taken for "colours", one edit away.
    expect(index.plan('colour ')).toEqual([{ word: 'colour', terms: [{ term: 'colour', weight: 1 }], corrected: false }])
    expect(index.plan('colurs ')).toEqual([{ word: 'colurs', terms: [{ term: 'colours', weight: 0.5 }], corrected: true }])
    // Nearest first, and the further one counts for less.
    expect(index.plan('instaler ')[0]?.terms).toEqual([
      { term: 'installer', weight: 0.5 },
      { term: 'install', weight: 0.25 },
    ])
  })

  it('ranks an exact match above a match by a misspelt word', () => {
    // "colours" is a heading, which counts three times over, and "font" is in a body. Typed correctly, the heading wins.
    expect(top('font colours ')).toEqual(['Colours', 'Typography'])
    expect(top('font colurs ')).toEqual(['Typography', 'Colours'])
  })

  it('never takes a word for a filler word', () => {
    expect(closeTerms('form', ['for', 'from', 'farm', 'forms', 'form'])).toEqual([
      { term: 'farm', edits: 1 },
      { term: 'forms', edits: 1 },
    ])
  })

  it('marks what a misspelt word was taken for, and cuts the excerpt around it', () => {
    const filler = 'Filler sentence about nothing in particular. '.repeat(8)
    const long = [doc('/long', 'Long', `${filler}The highlight colour marks the current page. ${filler}`)]
    const [hit] = search(new KeywordIndex(long), null, null, 'hihglight ', 3)
    expect(hit?.marks).toEqual(['highlight'])
    expect(hit?.snippet).toContain('The highlight colour marks')
    expect(hit?.snippet.startsWith('…')).toBe(true)
    // A word spelt as the index has it is marked as it was typed.
    expect(search(index, null, null, 'accent colour', 3)[0]?.marks).toEqual(['accent', 'colour'])
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
