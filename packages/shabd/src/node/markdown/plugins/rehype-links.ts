/**
 * Rewrites links between pages to route paths.
 *
 * Authors link the way they would on GitHub (`[Install](./install.md)`), so
 * the Markdown works in both places. Every internal link is also recorded so
 * `shabd check` can report links that point at pages which do not exist.
 */
import path from 'node:path'
import type { Element, Root } from 'hast'
import { visit } from 'unist-util-visit'
import type { VFile } from 'vfile'
import { fileToSlug, isExternal, normalizePath, slugToPath } from '../../../shared/paths.js'
import { pageData } from '../page-data.js'

const PAGE_FILE = /\.mdx?$/i
const OTHER_FILE = /\.[a-z0-9]{1,8}$/i

/** Resolve an href written in a page to a route path. Returns undefined for links to leave alone. */
export function resolvePageLink(href: string, id: string | undefined): string | undefined {
  if (!href || isExternal(href) || href.startsWith('#') || href.startsWith('?')) return undefined

  const hashIndex = href.indexOf('#')
  const target = hashIndex === -1 ? href : href.slice(0, hashIndex)
  const hash = hashIndex === -1 ? '' : href.slice(hashIndex)
  const isPageFile = PAGE_FILE.test(target)

  // Links to assets (`./diagram.pdf`) are not pages.
  if (!isPageFile && OTHER_FILE.test(target)) return undefined

  let route: string
  if (target.startsWith('/')) {
    route = isPageFile ? slugToPath(fileToSlug(target)) : normalizePath(target)
  } else {
    if (id === undefined) return undefined
    // Relative links resolve against the file's folder, as they do on disk.
    const joined = path.posix.join(path.posix.dirname(id), target)
    if (joined.startsWith('..')) return undefined
    route = isPageFile ? slugToPath(fileToSlug(joined)) : normalizePath(`/${joined === '.' ? '' : joined}`)
  }
  return route + hash
}

export function rehypeLinks() {
  return (tree: Root, file: VFile) => {
    const data = pageData(file)
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'a' || typeof node.properties.href !== 'string') return
      const resolved = resolvePageLink(node.properties.href, data.id)
      if (resolved === undefined) return
      node.properties.href = resolved
      data.links.push(resolved)
    })
  }
}
