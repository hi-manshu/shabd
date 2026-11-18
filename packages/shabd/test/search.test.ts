import { afterEach, describe, expect, it } from 'vitest'
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
  setSegmenter,
  similarities,
  spansToMark,
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

describe('text in a script without spaces', () => {
  afterEach(() => setSegmenter(undefined))

  /** Words are held decomposed, as accents are: ブ is フ and a mark. Put back together, they can be read here. */
  const cut = (text: string) => tokenize(text).map((word) => word.normalize('NFC'))

  it('is cut into words by a dictionary', () => {
    expect(cut('搜索功能')).toEqual(['搜索', '功能'])
    expect(cut('検索は読者のブラウザーで実行されます')).toEqual(expect.arrayContaining(['検索', '読者', 'ブラウザー', '実行']))
    expect(cut('การค้นหาทำงานในเบราว์เซอร์')).toEqual(expect.arrayContaining(['ค้นหา', 'เบราว์เซอร์']))
    // Punctuation and spaces are not words here either.
    expect(cut('搜索，功能。 搜索')).toEqual(['搜索', '功能', '搜索'])
    // Written composed or decomposed, a word is the same word.
    expect(tokenize('ブラウザー')).toEqual(tokenize('ブラウザー'.normalize('NFD')))
  })

  it('is cut apart from letters and digits of other scripts that run into it', () => {
    expect(tokenize('Node18以上')).toEqual(['node18', '以上'])
    expect(tokenize('Shabd搜索 café 2 cups')).toEqual(['shabd', '搜索', 'cafe', '2', 'cups'])
  })

  it('leaves every other text cut exactly as it was before', () => {
    // The tokeniser as it was before any text was cut by dictionary.
    const before = (text: string) =>
      text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[\p{L}\p{N}\p{M}]+/gu) ?? []
    const texts = [
      'Café-au-lait, 2 cups! Don’t e-mail naïve_coöperation@example.com',
      'शब्द का अर्थ है word. हिन्दी में खोज',
      'Ελληνικά άλφα, Русский язык: поиск ёж',
      'العربية بحث في المستندات',
      '한국어 검색 기능은 띄어쓰기를 씁니다',
      'İstanbul ǅ ½ x² ℃ Ⅷ é́',
      '',
    ]
    for (const text of texts) expect(tokenize(text), text).toEqual(before(text))
  })

  it('says where each of its words is', () => {
    const text = 'Node18以上が必要です。'
    const spans = wordSpans(text)
    expect(spans.map((span) => text.slice(span.start, span.end))).toEqual(['Node18', '以上', 'が', '必要', 'です'])
    expect(spans.map((span) => span.token)).toEqual(tokenize(text))
  })

  it('is cut into pairs of letters where there is no dictionary to cut it by', () => {
    setSegmenter(null)
    expect(tokenize('搜索功能')).toEqual(['搜索', '索功', '功能'])
    expect(tokenize('読')).toEqual(['読'])
    // A letter keeps the marks that sit on it: ค้ is one letter of two characters.
    expect(tokenize('ค้นหา')).toEqual(['ค้น', 'นห', 'หา'])
    // Other scripts need no dictionary, and are not touched.
    expect(tokenize('Node18以上 café')).toEqual(['node18', '以上', 'cafe'])
  })
})

describe('keyword search in a script without spaces', () => {
  afterEach(() => setSegmenter(undefined))

  const pages = [
    doc('/zh', '搜索', '搜索功能在读者的浏览器中运行，不需要任何搜索服务。侧边栏的宽度可以在主题配置中修改。'),
    doc('/ja', 'サイドバー', 'サイドバーの幅はテーマの設定で変更できます。検索は読者のブラウザーで実行されます。'),
    doc('/th', 'การค้นหา', 'การค้นหาทำงานในเบราว์เซอร์ของผู้อ่าน ติดตั้งแพ็กเกจแล้วเริ่มเซิร์ฟเวอร์สำหรับนักพัฒนา'),
    doc('/en', 'Install', 'Run the installer, then start the dev server.'),
  ]
  const words = new KeywordIndex(pages)
  const found = (query: string) => words.search(query, 5).map((hit) => pages[hit.doc]!.path)

  it('finds a section by a word of its text', () => {
    expect(found('浏览器')).toEqual(['/zh'])
    expect(found('主题配置')).toEqual(['/zh'])
    expect(found('ブラウザー')).toEqual(['/ja'])
    expect(found('設定')).toEqual(['/ja'])
    expect(found('เบราว์เซอร์')).toEqual(['/th'])
    expect(found('ค้นหา')).toEqual(['/th'])
    // A word shared by two languages finds both, and a word of another script is as it was.
    expect(found('读者 読者').sort()).toEqual(['/ja', '/zh'])
    expect(found('installer')).toEqual(['/en'])
  })

  it('matches the word still being typed from its first letter', () => {
    expect(found('浏')).toEqual(['/zh'])
    expect(found('ブラウ')).toEqual(['/ja'])
  })

  /** A segmenter that cuts some words as Playwright's Firefox was seen to, and the rest as this runtime does. */
  const cutAs = (cuts: Record<string, string[]>): Intl.Segmenter => {
    const own = new Intl.Segmenter('en', { granularity: 'word' })
    const segment = (text: string) => {
      const pieces = cuts[text]
      if (!pieces) return own.segment(text)
      let index = 0
      return pieces.map((piece) => ({ segment: piece, index: (index += piece.length) - piece.length, input: text }))
    }
    return { segment } as unknown as Intl.Segmenter
  }

  it('finds a word that the reader’s browser cut otherwise than the build did', () => {
    // The index was cut by this runtime: サイド and バー, ทำงาน, เบราว์เซอร์, ติด and ตั้ง.
    setSegmenter(cutAs({ サイドバー: ['サイドバー'], ทำงาน: ['ทำ', 'งาน'], เบราว์เซอร์: ['เบราว์', 'เซอร์'], ติดตั้ง: ['ติดตั้ง'] }))

    // Terms are held decomposed (ド as ト and its mark), so they are put back together to be read here.
    const terms = (query: string) =>
      words.plan(query).map((word) => word.terms.map(({ term, weight }) => `${term.normalize('NFC')} ${weight}`))

    // One word where the index has two: it is cut again along the index's words.
    expect(found('サイドバー ')).toEqual(['/ja'])
    expect(terms('サイドバー ')).toEqual([['サイド 1', 'バー 1']])
    expect(words.plan('サイドバー ')[0]?.corrected).toBe(true)
    expect(found('ติดตั้ง ')).toEqual(['/th'])
    expect(terms('ติดตั้ง ')).toEqual([['ติด 1', 'ตั้ง 1']])
    // Two words where the index has one: the first is found as the start of the longer word.
    expect(found('ทำงาน ')).toEqual(['/th'])
    expect(terms('ทำงาน ')).toEqual([['ทำงาน 0.6'], []])
    expect(found('เบราว์เซอร์ ')).toEqual(['/th'])
  })

  it('finds text by pairs of letters where the reader’s browser has no dictionary', () => {
    setSegmenter(null)
    expect(found('浏览器')).toEqual(['/zh'])
    expect(found('搜索功能')).toEqual(['/zh'])
    expect(found('サイドバー')).toEqual(['/ja'])
    expect(found('ブラウザー')).toEqual(['/ja'])
    expect(found('เบราว์เซอร์')).toEqual(['/th'])
    expect(found('installer')).toEqual(['/en'])
  })

  it('marks single letters only where they belong to what was typed', () => {
    const text = pages[0]!.text
    const marked = (marks: string[]) =>
      spansToMark(wordSpans(text), marks).map((span) => `${text.slice(span.start, span.end)}@${span.start}`)
    // A word of two letters is a word: the rule that leaves "to" unmarked is for alphabets.
    expect(wordsToMark(words.plan('搜索 的 a to'))).toEqual(['搜索', '的'])
    expect(marked(['搜索'])).toEqual(['搜索@0', '搜索@20'])
    // 的 is grammar. It is in the text twice, and beside neither 搜索 nor 功能.
    expect(marked(['搜索', '的', '功能'])).toEqual(['搜索@0', '功能@2', '搜索@20'])
    // A term the dictionary does not know comes as its letters. They are marked where they stand together.
    expect(marked(['侧', '边', '栏', '中'])).toEqual(['侧边@25', '栏@27'])
    // A query that is one letter and no more is marked wherever it is.
    expect(marked(['的'])).toEqual(['的@7', '的@28'])
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

  it('counts words, and not runs of letters, where a text has no spaces', () => {
    const sentence = '搜索功能在读者的浏览器中运行，不需要任何搜索服务。'
    const text = sentence.repeat(40)
    const total = tokenize(text).length
    expect(total).toBeGreaterThan(400)

    // Counted by its spaces the whole section is one word, and so one passage.
    const section = { anchor: 'long', heading: '搜索', depth: 2, text }
    const passages = chunkPage(page, [section]).filter((unit) => unit.anchor === 'long')
    expect(passages).toHaveLength(Math.ceil((total - 200) / 160) + 1)
    // About 200 words each. Cut on its own, a passage can come out a word more or less at its ends.
    expect(Math.abs(tokenize(passages[0]!.text).length - 200)).toBeLessThan(5)
    // A passage is the text as it was written: no spaces are put in, and punctuation stays where it was.
    for (const passage of passages) expect(text).toContain(passage.text)
    expect(text.startsWith(passages[0]!.text)).toBe(true)
    expect(text.endsWith(passages.at(-1)!.text)).toBe(true)
  })

  it('keeps the spaces of a text that has both kinds of script', () => {
    const text = `${'word '.repeat(150)}${'搜索功能在读者的浏览器中运行。'.repeat(20)} ${'tail '.repeat(100)}`.trim()
    const section = { anchor: 'mixed', heading: 'Mixed', depth: 2, text }
    const passages = chunkPage(page, [section]).filter((unit) => unit.anchor === 'mixed')
    expect(passages.length).toBeGreaterThan(1)
    for (const passage of passages) expect(text).toContain(passage.text)
    expect(passages[0]!.text.startsWith('word word ')).toBe(true)
    expect(passages.at(-1)!.text.endsWith(' tail tail')).toBe(true)
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
