/**
 * Pages → searchable units.
 *
 * A unit is a section (the text under one heading). Sections longer than the
 * embedding model's window are split into overlapping passages, so the end of
 * a long section is as findable as its start.
 */
import { isUnspaced, wordSpans, type SearchDoc } from '../../shared/search-core.js'
import type { PageSection } from '../../shared/types.js'

/** all-MiniLM-L6-v2 reads 256 word pieces; ~200 words keeps a passage inside that. */
const MAX_WORDS = 200
const OVERLAP_WORDS = 40

/** A word of a text, and whether a space stood before it. */
interface Word {
  word: string
  spaced: boolean
}

/**
 * The words of a text, to count a passage by.
 *
 * A word is what spaces separate, except in a script written without spaces,
 * where a whole paragraph would count as one. Such a run is cut where the
 * search tokeniser cuts it. Its pieces remember that no space stood between
 * them, so that a passage is put back together as it was written.
 */
function wordsOf(text: string): Word[] {
  const words: Word[] = []
  for (const run of text.split(/\s+/).filter(Boolean)) {
    const starts = isUnspaced(run) ? wordSpans(run).map((span) => span.start) : []
    if (starts.length < 2) {
      words.push({ word: run, spaced: true })
      continue
    }
    // Punctuation stays with the word it follows, and what opens the run stays with its first word.
    starts[0] = 0
    starts.forEach((start, index) => words.push({ word: run.slice(start, starts[index + 1]), spaced: index === 0 }))
  }
  return words
}

const join = (words: Word[]): string =>
  words.map(({ word, spaced }, index) => (spaced && index > 0 ? ` ${word}` : word)).join('')

export function chunkPage(
  page: { path: string; title: string; description: string },
  sections: PageSection[],
): SearchDoc[] {
  const docs: SearchDoc[] = []
  let hasOpening = false

  for (const section of sections) {
    const unit = { path: page.path, anchor: section.anchor, title: page.title, heading: section.heading }
    let text = section.text
    if (section.anchor === '') {
      hasOpening = true
      if (page.description && !text.includes(page.description)) text = `${page.description} ${text}`.trim()
    }

    const words = wordsOf(text)
    if (words.length <= MAX_WORDS) {
      docs.push({ ...unit, text })
      continue
    }
    for (let start = 0; start < words.length; start += MAX_WORDS - OVERLAP_WORDS) {
      docs.push({ ...unit, text: join(words.slice(start, start + MAX_WORDS)) })
      if (start + MAX_WORDS >= words.length) break
    }
  }

  // A page that opens with a heading still needs an entry for the page itself.
  if (!hasOpening) {
    docs.unshift({ path: page.path, anchor: '', title: page.title, heading: '', text: page.description })
  }
  return docs
}

/** What the model embeds: the passage, prefixed with where it sits, so short passages keep their context. */
export function embeddingInput(doc: SearchDoc): string {
  return `${[doc.title, doc.heading].filter(Boolean).join(': ')}\n${doc.text}`.trim()
}
