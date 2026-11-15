/**
 * llms.txt and llms-full.txt (https://llmstxt.org).
 *
 *   llms.txt       a map of the site: every page, grouped like the sidebar,
 *                  each linking to a Markdown copy of the page
 *   llms-full.txt  every page's Markdown in one file
 *
 * Both are generated from the same sidebar the reader sees, so the order an
 * agent reads in is the order the author intended.
 */
import { withBase } from '../../shared/paths.js'
import type { SidebarNode, SidebarPage } from '../../shared/types.js'
import type { ShabdContext } from '../context.js'
import type { PageRecord } from '../content/store.js'
import { pageMarkdown } from './markdown.js'

/** Where a page's Markdown copy is served: `/guide/install` → `/guide/install.md`, `/` → `/index.md`. */
export function markdownPath(routePath: string): string {
  return routePath === '/' ? '/index.md' : `${routePath}.md`
}

/** Absolute when `site.url` is set, otherwise relative to the site root. */
export function publicUrl(context: ShabdContext, sitePath: string): string {
  const { url, base } = context.config.config.site
  const pathname = withBase(base, sitePath)
  return url ? new URL(pathname, url).href : pathname
}

interface Section {
  title: string
  pages: SidebarPage[]
}

/** Top-level sidebar groups become sections; pages nested in folders are listed under their group. */
function toSections(sidebar: SidebarNode[]): Section[] {
  const collect = (nodes: SidebarNode[]): SidebarPage[] =>
    nodes.flatMap((node) => (node.type === 'page' ? [node] : node.type === 'group' ? collect(node.items) : []))

  const sections: Section[] = []
  const loose: SidebarPage[] = []
  for (const node of sidebar) {
    if (node.type === 'group') sections.push({ title: node.label, pages: collect(node.items) })
    else if (node.type === 'page') loose.push(node)
  }
  if (loose.length) sections.unshift({ title: 'Docs', pages: loose })
  return sections.filter((section) => section.pages.length > 0)
}

export function renderLlmsTxt(context: ShabdContext): string {
  const { site, features } = context.config.config
  const byPath = new Map(context.store.pages().map((page) => [page.path, page]))
  const listed = new Set<string>()

  const line = (page: PageRecord, label = page.title) => {
    listed.add(page.path)
    const description = page.description ? `: ${page.description.replace(/\s+/g, ' ')}` : ''
    return `- [${label}](${publicUrl(context, markdownPath(page.path))})${description}`
  }

  const out: string[] = [`# ${site.title}`]
  if (site.description) out.push(`> ${site.description}`)
  if (features.llms.full) {
    out.push(`The complete documentation in one file: ${publicUrl(context, '/llms-full.txt')}`)
  }

  for (const section of toSections(context.store.sidebar.sidebar)) {
    const lines = section.pages.flatMap((entry) => {
      const page = byPath.get(entry.path)
      return page ? [line(page, entry.label)] : []
    })
    if (lines.length) out.push(`## ${section.title}`, lines.join('\n'))
  }

  // Pages outside the sidebar are still part of the site; the spec's "Optional"
  // section marks them as safe to skip when context is short.
  const rest = context.store.pages().filter((page) => !listed.has(page.path) && page.path !== '/')
  if (rest.length) out.push('## Optional', rest.map((page) => line(page)).join('\n'))

  return `${out.join('\n\n')}\n`
}

export function renderLlmsFull(context: ShabdContext): string {
  const { site } = context.config.config
  const byPath = new Map(context.store.pages().map((page) => [page.path, page]))
  // Sidebar order first, then anything the sidebar does not list.
  const ordered: PageRecord[] = []
  const seen = new Set<string>()
  for (const section of toSections(context.store.sidebar.sidebar)) {
    for (const entry of section.pages) {
      const page = byPath.get(entry.path)
      if (page && !seen.has(page.path)) {
        seen.add(page.path)
        ordered.push(page)
      }
    }
  }
  for (const page of context.store.pages()) if (!seen.has(page.path)) ordered.push(page)

  const out = [`# ${site.title}`, site.description ? `> ${site.description}` : '']
  for (const page of ordered) {
    out.push(`---\n\nSource: ${publicUrl(context, page.path)}\n\n${pageMarkdown(page).trim()}`)
  }
  return `${out.filter(Boolean).join('\n\n')}\n`
}
