/**
 * sidebar.yaml + the content tree → the sidebar the reader sees.
 *
 * Two rules decide the result:
 *
 *   1. What sidebar.yaml says is used exactly as written, in that order.
 *   2. A content folder that sidebar.yaml never mentions is appended as an
 *      auto-generated group, sorted alphabetically. A new folder of pages
 *      shows up in navigation without anyone editing YAML.
 *
 * "Mentions" means: a `file` entry points into the folder (at any depth), or
 * an `autogenerate` entry covers it. With no sidebar.yaml at all, the whole
 * content tree is generated.
 *
 * This module is pure: it takes parsed YAML and a list of pages, and returns
 * data. File access and error reporting live in the callers.
 */
import { isExternal, parentDir, refToSlug, titleize } from '../../shared/paths.js'
import {
  normalizeBadge,
  type Badge,
  type BadgeInput,
  type Frontmatter,
  type SidebarAutogenerate,
  type SidebarEntryInput,
  type SidebarInput,
} from '../../shared/schema.js'
import type { SidebarGroup, SidebarNode, SidebarPage } from '../../shared/types.js'

export { flattenSidebar } from '../../shared/sidebar.js'

/** What the resolver needs to know about a page. */
export interface SidebarPageInfo {
  slug: string
  path: string
  title: string
  /** True for `index.md` files: the page stands for its folder. */
  isIndex: boolean
  sidebar: Frontmatter['sidebar']
}

export interface SidebarWarning {
  message: string
  /** Path into sidebar.yaml, when the warning is about a specific entry. */
  path?: (string | number)[]
}

export interface ResolvedSidebar {
  sidebar: SidebarNode[]
  warnings: SidebarWarning[]
  /** Slugs of pages that are published but not reachable from the sidebar. */
  unlisted: string[]
}

interface Directory {
  pages: SidebarPageInfo[]
  subdirs: Set<string>
}

interface SortableEntry {
  node: SidebarNode
  label: string
  order: number
  isIndex: boolean
}

export function resolveSidebar(
  input: SidebarInput,
  pages: SidebarPageInfo[],
  options: { lang?: string } = {},
): ResolvedSidebar {
  const collator = new Intl.Collator(options.lang ?? 'en', { numeric: true, sensitivity: 'base' })
  const warnings: SidebarWarning[] = []
  const bySlug = new Map(pages.map((page) => [page.slug, page]))

  /* ── index the content tree by directory ── */

  const directories = new Map<string, Directory>([['', { pages: [], subdirs: new Set() }]])
  const ensureDirectory = (dir: string): Directory => {
    let directory = directories.get(dir)
    if (!directory) {
      directory = { pages: [], subdirs: new Set() }
      directories.set(dir, directory)
      ensureDirectory(parentDir(dir)).subdirs.add(dir)
    }
    return directory
  }
  /** The folder a page lives in. An index page lives in the folder it stands for. */
  const directoryOf = (page: SidebarPageInfo) => (page.isIndex ? page.slug : parentDir(page.slug))
  for (const page of pages) ensureDirectory(directoryOf(page)).pages.push(page)

  /* ── track which folders sidebar.yaml accounts for ── */

  /** Folders with an entry pointing into them, plus all their ancestors. */
  const mentioned = new Set<string>()
  /** Folders handed to `autogenerate`: everything beneath them is accounted for. */
  const generatedRoots: string[] = []
  const listed = new Set<string>()

  const mention = (dir: string) => {
    for (let current = dir; ; current = parentDir(current)) {
      mentioned.add(current)
      if (current === '') break
    }
  }
  const isCovered = (dir: string) =>
    mentioned.has(dir) || generatedRoots.some((root) => root === '' || dir === root || dir.startsWith(`${root}/`))

  /* ── building blocks ── */

  const badgeOf = (badge: BadgeInput | Badge | undefined): { badge: Badge } | object =>
    badge === undefined ? {} : { badge: normalizeBadge(badge) }

  const pageNode = (page: SidebarPageInfo, overrides: { label?: string; badge?: BadgeInput } = {}): SidebarPage => ({
    type: 'page',
    label: overrides.label ?? page.sidebar.label ?? page.title,
    path: page.path,
    ...badgeOf(overrides.badge ?? page.sidebar.badge),
  })

  const sortEntries = (entries: SortableEntry[]): SidebarNode[] =>
    entries
      .sort((a, b) => {
        if (a.isIndex !== b.isIndex) return a.isIndex ? -1 : 1
        if (a.order !== b.order) return a.order < b.order ? -1 : 1
        return collator.compare(a.label, b.label)
      })
      .map((entry) => entry.node)

  /** Every page and sub-folder of a content directory, alphabetically. */
  const generate = (dir: string, collapsed: boolean): SidebarNode[] => {
    const directory = directories.get(dir)
    if (!directory) return []
    const entries: SortableEntry[] = []

    for (const page of directory.pages) {
      if (page.sidebar.exclude) continue
      if (page.slug === '') continue // the home page is reached from the site title
      listed.add(page.slug)
      const node = pageNode(page)
      entries.push({
        node,
        label: node.label,
        order: page.sidebar.order ?? Number.POSITIVE_INFINITY,
        isIndex: page.isIndex,
      })
    }

    for (const subdir of directory.subdirs) {
      const items = generate(subdir, collapsed)
      if (items.length === 0) continue
      const label = titleize(subdir.slice(subdir.lastIndexOf('/') + 1))
      const index = bySlug.get(subdir)
      entries.push({
        node: { type: 'group', kind: 'folder', label, collapsed, items, auto: true },
        label,
        order: (index?.isIndex ? index.sidebar.order : undefined) ?? Number.POSITIVE_INFINITY,
        isIndex: false,
      })
    }

    return sortEntries(entries)
  }

  const fromAutogenerate = (
    autogenerate: SidebarAutogenerate,
    path: (string | number)[],
  ): { items: SidebarNode[]; collapsed: boolean | undefined } => {
    const options = typeof autogenerate === 'string' ? { directory: autogenerate } : autogenerate
    const dir = refToSlug(options.directory === '.' ? '' : options.directory)
    if (!directories.has(dir)) {
      warnings.push({
        message: `autogenerate: "${options.directory}" is not a folder with pages in the content directory`,
        path: [...path, 'autogenerate'],
      })
      return { items: [], collapsed: options.collapsed }
    }
    generatedRoots.push(dir)
    mention(dir)
    return { items: generate(dir, false), collapsed: options.collapsed }
  }

  /* ── explicit entries ── */

  const resolveEntry = (entry: SidebarEntryInput, path: (string | number)[]): SidebarNode | null => {
    if (typeof entry === 'string' || 'file' in entry) {
      const ref = typeof entry === 'string' ? entry : entry.file
      const page = bySlug.get(refToSlug(ref))
      if (!page) {
        warnings.push({ message: `"${ref}" does not match any page in the content directory`, path })
        return null
      }
      if (listed.has(page.slug)) {
        warnings.push({ message: `"${ref}" is listed more than once`, path })
      }
      listed.add(page.slug)
      mention(directoryOf(page))
      return typeof entry === 'string' ? pageNode(page) : pageNode(page, entry)
    }

    if ('link' in entry) {
      return {
        type: 'link',
        label: entry.label,
        href: entry.link,
        external: isExternal(entry.link),
        ...badgeOf(entry.badge),
      }
    }

    const isCategory = 'category' in entry
    const label = isCategory ? entry.category : entry.folder
    let collapsed = isCategory ? false : (entry.collapsed ?? false)
    let items: SidebarNode[]

    if (entry.autogenerate !== undefined) {
      const generated = fromAutogenerate(entry.autogenerate, path)
      items = generated.items
      if (!isCategory && entry.collapsed === undefined) collapsed = generated.collapsed ?? false
    } else {
      items = (entry.items ?? []).flatMap((item, index) => resolveEntry(item, [...path, 'items', index]) ?? [])
    }

    if (items.length === 0) {
      warnings.push({ message: `"${label}" has no pages and was left out`, path })
      return null
    }

    return {
      type: 'group',
      kind: isCategory ? 'category' : 'folder',
      label,
      collapsed,
      ...badgeOf(entry.badge),
      items,
    }
  }

  let sidebar: SidebarNode[]

  if (input.length === 0) {
    // No sidebar.yaml: generate everything. Top-level folders become categories.
    generatedRoots.push('')
    sidebar = generate('', false).map((node) =>
      node.type === 'group' ? { ...node, kind: 'category' as const } : node,
    )
  } else {
    sidebar = input.flatMap((entry, index) => resolveEntry(entry, [index]) ?? [])

    /* ── fallback: folders sidebar.yaml never mentions ── */

    const uncovered = [...directories.keys()]
      .filter((dir) => dir !== '' && !isCovered(dir))
      // Keep only the top of each unmentioned subtree; its children nest inside it.
      .filter((dir) => parentDir(dir) === '' || isCovered(parentDir(dir)))
      .sort(collator.compare)

    for (const dir of uncovered) {
      const items = generate(dir, false)
      if (items.length === 0) continue
      const group: SidebarGroup = {
        type: 'group',
        kind: 'category',
        label: dir.split('/').map(titleize).join(' / '),
        collapsed: false,
        items,
        auto: true,
      }
      sidebar.push(group)
    }
  }

  const unlisted = pages
    .filter((page) => page.slug !== '' && !listed.has(page.slug) && !page.sidebar.exclude)
    .map((page) => page.slug)
    .sort(collator.compare)

  return { sidebar, warnings, unlisted }
}
