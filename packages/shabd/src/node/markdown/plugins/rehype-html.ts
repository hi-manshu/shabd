/**
 * Reads the HTML an author wrote in a `.md` page.
 *
 * Markdown lets HTML stand among its own syntax: `<kbd>`, `<details>`, a
 * table written by hand. To the MDX compiler, which every page goes
 * through, such HTML in a `.md` page is text it has no use for, and it
 * leaves it out without a word. So it is read here first.
 *
 * Reading it means parsing the whole page as HTML again, because a tag may
 * open in one place and close in another with Markdown in between. An HTML
 * parser knows nothing of what is not HTML, and would spoil two things the
 * page already holds:
 *
 *   - Elements that stand for components (`Callout`), whose names it would
 *     put in lower case, where no component answers to them.
 *   - What follows the language of a code fence (`title="…"`, `{2}`,
 *     `live`), which is kept beside the tree and not in it.
 *
 * Both are tucked into attributes for the parse and put back afterwards. A
 * page with no HTML in it, which is most pages, is not parsed at all.
 */
import type { Element, Root } from 'hast'
import { raw } from 'hast-util-raw'
import { EXIT, visit } from 'unist-util-visit'
import type { VFile } from 'vfile'

/** What a component's element is called while the parser has it, and where its real name is kept. */
const HOLDER = 'sb-component'

export function rehypeHtml() {
  return (tree: Root, file: VFile): Root | undefined => {
    let found = false
    visit(tree, (node) => {
      if ((node.type as string) !== 'raw') return undefined
      found = true
      return EXIT
    })
    if (!found) return undefined

    visit(tree, 'element', (node: Element) => {
      if (/^[A-Z]/.test(node.tagName)) {
        node.properties.dataSbName = node.tagName
        node.tagName = HOLDER
      }
      const meta = (node.data as { meta?: unknown } | undefined)?.meta
      if (node.tagName === 'code' && typeof meta === 'string') node.properties.dataSbMeta = meta
    })

    const parsed = raw(tree, { file }) as Root

    visit(parsed, 'element', (node: Element) => {
      if (node.tagName === HOLDER && typeof node.properties.dataSbName === 'string') {
        node.tagName = node.properties.dataSbName
        delete node.properties.dataSbName
      }
      if (node.tagName === 'code' && typeof node.properties.dataSbMeta === 'string') {
        node.data = { ...node.data, meta: node.properties.dataSbMeta } as Element['data']
        delete node.properties.dataSbMeta
      }
    })
    return parsed
  }
}
