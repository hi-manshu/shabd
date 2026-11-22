/**
 * Prose beside code, for layouts that ask for it (`split: true`, which the
 * built-in `api` layout does).
 *
 * The page is cut into rows at its headings. In each row the text goes in
 * one cell and the code samples in another, and the stylesheet sets the two
 * side by side on a wide screen: a reader keeps the request in view while
 * reading about it. On a narrow screen the cells stack, in the order the
 * author wrote them, cell by cell.
 *
 * A page with no code at all is left as it is: half a column of text beside
 * nothing would only be a narrow page.
 */
import type { Element, ElementContent, Root, RootContent } from 'hast'
import type { VFile } from 'vfile'
import { pageData } from '../page-data.js'

const HEADING = /^h[1-6]$/
/** What goes in the code cell: highlighted code, and the components a fence can become. */
const CODE = new Set(['pre', 'Sandbox', 'Mermaid'])

const isElement = (node: RootContent): node is Element => node.type === 'element'
const isBlank = (node: RootContent) => node.type === 'text' && node.value.trim() === ''

const cell = (kind: 'prose' | 'code', children: RootContent[]): Element => ({
  type: 'element',
  tagName: 'div',
  properties: { className: [`sb-split-${kind}`] },
  children: children as ElementContent[],
})

export function rehypeSplit() {
  return (tree: Root, file: VFile) => {
    if (!pageData(file).split) return
    if (!tree.children.some((node) => isElement(node) && CODE.has(node.tagName))) return

    const out: RootContent[] = []
    let prose: RootContent[] = []
    let code: RootContent[] = []
    const flush = () => {
      if (prose.some((node) => !isBlank(node)) || code.length > 0) {
        out.push({
          type: 'element',
          tagName: 'div',
          properties: { className: ['sb-split'] },
          children: [cell('prose', prose), ...(code.length ? [cell('code', code)] : [])],
        })
      }
      prose = []
      code = []
    }

    for (const node of tree.children) {
      // MDX's imports and exports belong to the module, not to the page, and have to stay where they are.
      if ((node.type as string) === 'mdxjsEsm') {
        out.push(node)
        continue
      }
      if (isElement(node) && HEADING.test(node.tagName)) flush()
      if (isElement(node) && CODE.has(node.tagName)) code.push(node)
      else prose.push(node)
    }
    flush()
    tree.children = out
  }
}
