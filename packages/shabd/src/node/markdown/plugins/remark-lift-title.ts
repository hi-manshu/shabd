/**
 * A page that opens with `# Title` and has no `title` in frontmatter uses
 * that heading as its title. The layout renders the title (with badges), so
 * the heading is lifted out of the body to avoid a second <h1>.
 */
import type { Root } from 'mdast'
import { toString } from 'mdast-util-to-string'
import type { VFile } from 'vfile'
import { pageData } from '../page-data.js'

const SKIPPED = new Set(['yaml', 'toml', 'mdxjsEsm'])

export function remarkLiftTitle() {
  return (tree: Root, file: VFile) => {
    const data = pageData(file)
    if (!data.liftTitle) return
    const index = tree.children.findIndex((node) => !SKIPPED.has(node.type))
    const first = tree.children[index]
    if (first?.type === 'heading' && first.depth === 1) {
      data.title = toString(first)
      tree.children.splice(index, 1)
    }
  }
}
