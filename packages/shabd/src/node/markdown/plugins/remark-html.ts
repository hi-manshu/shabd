/**
 * Notes what looks like a component in a `.md` page.
 *
 * HTML in a `.md` page is HTML, and is rendered as such: `<kbd>`, `<details>`,
 * a table written by hand. A component is not HTML. `<Tabs>` in a `.md` page
 * would reach the browser as an element called `tabs`, which means nothing
 * to it, so the page would show the words inside and none of the tabs.
 * Nothing is wrong enough to stop for, and the author should hear of it:
 * `shabd check` reports each one, with the remedy, which is to name the file
 * `.mdx`.
 */
import type { Root } from 'mdast'
import { visit } from 'unist-util-visit'
import type { VFile } from 'vfile'
import { pageData } from '../page-data.js'

/** An opening tag whose name starts with a capital, as a component's does and an HTML element's never. */
const COMPONENT = /<([A-Z][A-Za-z0-9]*)(?=[\s/>])/g

export function remarkHtml() {
  return (tree: Root, file: VFile) => {
    const data = pageData(file)
    visit(tree, 'html', (node) => {
      for (const match of node.value.matchAll(COMPONENT)) {
        // The line of the tag inside a block of HTML that may run over several.
        const before = node.value.slice(0, match.index).split('\n').length - 1
        const line = node.position ? node.position.start.line + before : undefined
        data.strays.push({ name: match[1]!, ...(line ? { line } : {}) })
      }
    })
  }
}
