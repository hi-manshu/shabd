/**
 * Pages → searchable units.
 *
 * A unit is a section (the text under one heading). Sections longer than the
 * embedding model's window are split into overlapping passages, so the end of
 * a long section is as findable as its start.
 */
import type { SearchDoc } from '../../shared/search-core.js'
import type { PageSection } from '../../shared/types.js'

/** all-MiniLM-L6-v2 reads 256 word pieces; ~200 words keeps a passage inside that. */
const MAX_WORDS = 200
const OVERLAP_WORDS = 40

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

    const words = text.split(/\s+/).filter(Boolean)
    if (words.length <= MAX_WORDS) {
      docs.push({ ...unit, text })
      continue
    }
    for (let start = 0; start < words.length; start += MAX_WORDS - OVERLAP_WORDS) {
      docs.push({ ...unit, text: words.slice(start, start + MAX_WORDS).join(' ') })
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
