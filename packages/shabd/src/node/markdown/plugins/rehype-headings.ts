/**
 * Gives every heading a stable id, and records the page outline.
 *
 * Two outputs come from the same walk over the top-level nodes:
 *   - `toc`      headings, for the "On this page" block
 *   - `sections` the text under each heading, for search and for AI agents
 *
 * The anchor link itself is drawn by the <Heading> component, not here, so a
 * theme can restyle it.
 */
import GithubSlugger from 'github-slugger'
import type { Element, Root, RootContent } from 'hast'
import { toString } from 'hast-util-to-string'
import { visit } from 'unist-util-visit'
import type { VFile } from 'vfile'
import type { PageSection } from '../../../shared/types.js'
import { pageData } from '../page-data.js'

const HEADING = /^h([1-6])$/

function headingDepth(node: RootContent): number | undefined {
  if (node.type !== 'element') return undefined
  const match = HEADING.exec(node.tagName)
  return match ? Number(match[1]) : undefined
}

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim()

/** Elements whose text should not run into their neighbour's ("…component.Pages are…"). */
const BLOCK = new Set([
  'p', 'li', 'td', 'th', 'tr', 'div', 'pre', 'br', 'dt', 'dd', 'blockquote', 'figcaption', 'summary',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
])

/** The text of a node, with a space wherever a block ends. */
function blockText(node: unknown): string {
  const item = node as { type: string; value?: string; tagName?: string; name?: string | null; children?: unknown[] }
  if (item.type === 'text') return item.value ?? ''
  if (!item.children) return ''
  const text = item.children.map(blockText).join('')
  // Components written in MDX (<Card>, <Tab>) are blocks too.
  const isBlock = item.type === 'mdxJsxFlowElement' || (item.tagName !== undefined && BLOCK.has(item.tagName))
  return isBlock ? `${text} ` : text
}

export function rehypeHeadings() {
  return (tree: Root, file: VFile) => {
    const data = pageData(file)
    const slugger = new GithubSlugger()

    // Ids first, for every heading in the document (including nested ones),
    // so that links to them work and duplicates are numbered in source order.
    visit(tree, 'element', (node: Element) => {
      if (!HEADING.test(node.tagName)) return
      const existing = node.properties.id
      node.properties.id = typeof existing === 'string' && existing ? existing : slugger.slug(toString(node))
      data.anchors.push(node.properties.id)
    })

    let current: PageSection = { anchor: '', heading: '', depth: 0, text: '' }
    const flush = () => {
      current.text = collapse(current.text)
      if (current.text || current.heading) data.sections.push(current)
    }

    for (const node of tree.children) {
      const depth = headingDepth(node)
      if (depth !== undefined) {
        const heading = node as Element
        const text = collapse(toString(heading))
        const id = String(heading.properties.id)
        data.toc.push({ depth, id, text })
        flush()
        current = { anchor: id, heading: text, depth, text: '' }
      } else {
        current.text += ` ${blockText(node)}`
      }
    }
    flush()
  }
}
