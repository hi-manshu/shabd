/**
 * Arriving from a search result: go to the passage that matched, and mark the
 * words of the query in it.
 *
 * A result names its section's heading, and a long section is many screens
 * of text. The passage is found among the section's words as the page shows
 * them (src/shared/passage.ts), the page is scrolled to where it starts, and
 * the words that were searched for are marked.
 *
 * The marks are drawn with the CSS Custom Highlight API: ranges over the
 * page's own text, registered under a name that the stylesheet colours
 * (`::highlight(sb-search)` in styles/content.css). Nothing is added to the
 * document and nothing in it is changed, so React finds it as it left it, on
 * the next render, on hydration and on a hot update. A browser without the
 * API still goes to the passage; it shows no marks.
 */
import { locatePassage, type PassageTarget } from '../../shared/passage.js'
import { tokenize, wordSpans } from '../../shared/search-core.js'

/** The name the marks are registered under. The stylesheet has the same one. */
const HIGHLIGHT = 'sb-search'

const HEADING = /^H[1-6]$/

/** Elements whose text runs on from their neighbour's. Any other element ends a word. */
const INLINE = new Set(
  'A ABBR B BDI BDO CITE CODE DATA DEL DFN EM I INS KBD MARK Q S SAMP SMALL SPAN STRONG SUB SUP TIME U VAR'.split(' '),
)

/** Elements whose text is not prose: what a control says, and text that is never drawn. */
const NOT_PROSE = new Set('BUTTON SELECT TEXTAREA SCRIPT STYLE TEMPLATE NOSCRIPT'.split(' '))

/** A passage that starts this close to its heading is shown from the heading. */
const NEAR_HEADING = 20

/** Text gathered from the page as one string, with where each stretch of it came from. */
interface PageText {
  text: string
  /** Text nodes in the order they were read, each with where its text starts in `text`. */
  pieces: { node: Text; at: number }[]
}

function readText(nodes: Iterable<Node>, into: PageText = { text: '', pieces: [] }): PageText {
  for (const node of nodes) {
    if (node instanceof Text) {
      into.pieces.push({ node, at: into.text.length })
      into.text += node.data
    } else if (node instanceof Element && !NOT_PROSE.has(node.tagName)) {
      const inline = INLINE.has(node.tagName)
      // A space that belongs to no node: the word before a block ends where the block starts.
      if (!inline) into.text += ' '
      readText(node.childNodes, into)
      if (!inline) into.text += ' '
    }
  }
  return into
}

/** The range in the page for `start` to `end` of the gathered text. */
function rangeOf(page: PageText, start: number, end: number): Range {
  const pieceAt = (offset: number) => {
    let low = 0
    let high = page.pieces.length - 1
    while (low < high) {
      const middle = (low + high + 1) >> 1
      if (page.pieces[middle]!.at <= offset) low = middle
      else high = middle - 1
    }
    return page.pieces[low]!
  }
  const first = pieceAt(start)
  // The last character of the word, so that a word ending where a node ends stays in that node.
  const last = pieceAt(end - 1)
  const range = new Range()
  range.setStart(first.node, start - first.at)
  range.setEnd(last.node, end - last.at)
  return range
}

/** The heading of a section and the nodes under it, up to the next heading at the top level of the page. */
function sectionOf(anchor: string): { heading: Element | null; body: Node[] } | null {
  const article = document.querySelector('.sb-content')
  if (!article) return null
  const heading = anchor ? document.getElementById(anchor) : null
  if (anchor && !(heading && article.contains(heading))) return null

  const body: Node[] = []
  for (let node = heading ? heading.nextSibling : article.firstChild; node; node = node.nextSibling) {
    if (node instanceof Element && HEADING.test(node.tagName)) break
    body.push(node)
  }
  return { heading, body }
}

/** How far down the window the page's text starts: the header covers what is above. */
function headerOffset(): number {
  return Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0
}

/** The box a range is drawn in, or null when it is not drawn at all (a closed tab, a folded section). */
function boxOf(range: Range): DOMRect | null {
  const box = range.getBoundingClientRect()
  return box.width > 0 || box.height > 0 ? box : null
}

const canMark = (): boolean => typeof Highlight === 'function' && typeof CSS !== 'undefined' && 'highlights' in CSS

/**
 * Go to the passage in the section under `anchor` and mark its words.
 *
 * The page is expected to be at the section's heading already, which is
 * where it stays if the passage cannot be found. `onDismiss` is called when
 * the reader clears the marks with Escape. Returns what removes the marks.
 */
export function showPassage(target: PassageTarget, anchor: string, onDismiss: () => void): () => void {
  const section = sectionOf(anchor)
  if (!section) return () => {}

  const body = readText(section.body)
  const words = wordSpans(body.text)
  const located = locatePassage(
    words.map((word) => word.token),
    tokenize(target.text),
  )
  // Where the passage is not found, the section stands in for it: the page stays at the heading,
  // and the words are marked wherever the section has them.
  const { first, last } = located ?? { first: 0, last: words.length - 1 }
  const fromHeading = first < NEAR_HEADING

  const wanted = (token: string) => target.words.some((word) => token.startsWith(word))
  const marks: Range[] = []
  if (fromHeading && section.heading) {
    const title = readText([section.heading])
    for (const word of wordSpans(title.text)) if (wanted(word.token)) marks.push(rangeOf(title, word.start, word.end))
  }
  for (const word of words.slice(first, last + 1)) {
    if (wanted(word.token)) marks.push(rangeOf(body, word.start, word.end))
  }

  // The start of the passage goes where a heading would: just under the header.
  const offset = headerOffset()
  const start = fromHeading || !words[first] ? null : boxOf(rangeOf(body, words[first].start, words[first].end))
  if (start) window.scrollBy(0, start.top - offset)

  // A passage can be taller than the window (a long code sample). If the first marked word is out of sight, show it.
  const drawn = marks.find((mark) => boxOf(mark))
  const box = drawn ? boxOf(drawn) : null
  const middle = box ? box.top + box.height / 2 : 0
  if (box && (middle < offset || middle > window.innerHeight)) {
    window.scrollBy(0, middle - (offset + window.innerHeight) / 2)
  }

  if (marks.length === 0 || !canMark()) return () => {}

  CSS.highlights.set(HIGHLIGHT, new Highlight(...marks))
  const onKeyDown = (event: KeyboardEvent) => {
    // Escape that closed something else (the search dialog) was not meant for the marks.
    if (event.key !== 'Escape' || event.defaultPrevented) return
    clear()
    onDismiss()
  }
  const clear = () => {
    CSS.highlights.delete(HIGHLIGHT)
    window.removeEventListener('keydown', onKeyDown)
  }
  window.addEventListener('keydown', onKeyDown)
  return clear
}
