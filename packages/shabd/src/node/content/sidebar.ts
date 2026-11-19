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

/**
 * An API whose pages were made from an OpenAPI description. Where a sidebar
 * is generated from its folder, it is laid out as the description is: the
 * overview, then the operations under their tags, in the order they were
 * written. A folder has neither the tags' names nor that order.
 */
export interface ApiGroups {
  /** The folder of its pages, as a slug: `api`. Empty for an API at the root of the site. */
  dir: string
  /** What the API is called. */
  title: string
  groups: { label: string; slugs: string[] }[]
}

export interface ResolveOptions {
  lang?: string
  apis?: readonly ApiGroups[]
  /**
   * The pages this sidebar answers for, on a site with more than one. Its
   * entries may name any page, but only folders that hold pages of its own
   * are added to it unasked, and only its own pages are reported as left out.
   */
  owns?: (page: SidebarPageInfo) => boolean
}

/** The pages of a site, by slug and by the folder they are in. It is the same for every sidebar of the site. */
interface ContentTree {
  pages: readonly SidebarPageInfo[]
  bySlug: Map<string, SidebarPageInfo>
  directories: Map<string, Directory>
}

/** The folder a page lives in. An index page lives in the folder it stands for. */
const directoryOf = (page: SidebarPageInfo) => (page.isIndex ? page.slug : parentDir(page.slug))

function contentTree(pages: readonly SidebarPageInfo[]): ContentTree {
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
  for (const page of pages) ensureDirectory(directoryOf(page)).pages.push(page)
  return { pages, bySlug: new Map(pages.map((page) => [page.slug, page])), directories }
}

export function resolveSidebar(input: SidebarInput, pages: readonly SidebarPageInfo[], options: ResolveOptions = {}): ResolvedSidebar {
  return resolveIn(contentTree(pages), input, options)
}

function resolveIn({ pages, bySlug, directories }: ContentTree, input: SidebarInput, options: ResolveOptions): ResolvedSidebar {
  const collator = new Intl.Collator(options.lang ?? 'en', { numeric: true, sensitivity: 'base' })
  const warnings: SidebarWarning[] = []
  const owns = options.owns ?? (() => true)

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

  /* ── APIs made from a description ── */

  /** Each API by its folder, with the pages that are its own and the folders that hold them. */
  const apis = new Map(
    (options.apis ?? []).map((api) => {
      const slugs = new Set([api.dir, ...api.groups.flatMap((group) => group.slugs)])
      const folders = new Set<string>()
      for (const slug of slugs) {
        for (let dir = parentDir(slug); dir !== api.dir && dir !== ''; dir = parentDir(dir)) folders.add(dir)
      }
      return [api.dir, { ...api, slugs, folders }] as const
    }),
  )

  /** An API as its description has it: the overview, then each tag's operations in the order they were written. */
  const fromDescription = (api: ApiGroups, collapsed: boolean): SidebarNode[] => {
    const entry = (slug: string): SidebarNode[] => {
      const page = bySlug.get(slug)
      // The home page is reached from the site title, here as in every generated group.
      if (!page || page.sidebar.exclude || page.slug === '') return []
      listed.add(page.slug)
      return [pageNode(page)]
    }
    const nodes = entry(api.dir)
    for (const group of api.groups) {
      const items = group.slugs.flatMap(entry)
      if (items.length === 0) continue
      // A description with no tags has one group, and its pages need no folder around them.
      if (api.groups.length === 1) nodes.push(...items)
      else nodes.push({ type: 'group', kind: 'folder', label: group.label, collapsed, items, auto: true })
    }
    return nodes
  }

  /**
   * Every page and sub-folder of a content directory, alphabetically. The
   * folder of an API starts with the API as its description lays it out, and
   * anything else the folder holds comes after.
   */
  const generate = (dir: string, collapsed: boolean): SidebarNode[] => {
    const directory = directories.get(dir)
    if (!directory) return []
    const api = apis.get(dir)
    const described = api ? fromDescription(api, collapsed) : []
    const entries: SortableEntry[] = []

    for (const page of directory.pages) {
      if (page.sidebar.exclude) continue
      if (page.slug === '') continue // the home page is reached from the site title
      if (api?.slugs.has(page.slug)) continue
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
      // The folder of one of the API's tags: its pages are in the API's own list, above.
      if (api?.folders.has(subdir)) continue
      const items = generate(subdir, collapsed)
      if (items.length === 0) continue
      // An API is called what its description calls it, and any other folder by its name.
      const label = apis.get(subdir)?.title ?? titleize(subdir.slice(subdir.lastIndexOf('/') + 1))
      const index = bySlug.get(subdir)
      const [only] = items
      // A folder that holds nothing but its own index page is that page: `terms/cache/index.md` is the
      // page "Cache", not a group called Cache with one entry called Cache.
      if (items.length === 1 && only?.type === 'page' && index?.isIndex && only.path === index.path) {
        entries.push({ node: only, label: only.label, order: index.sidebar.order ?? Number.POSITIVE_INFINITY, isIndex: false })
        continue
      }
      entries.push({
        node: { type: 'group', kind: 'folder', label, collapsed, items, auto: true },
        label,
        order: (index?.isIndex ? index.sidebar.order : undefined) ?? Number.POSITIVE_INFINITY,
        isIndex: false,
      })
    }

    return [...described, ...sortEntries(entries)]
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

    // The folders that hold a page of this sidebar's own, in them or below them. Worked out once:
    // asking every page about every folder is what made a large site with many sidebars slow.
    let own: Set<string> | undefined
    if (options.owns) {
      own = new Set()
      for (const page of pages) {
        if (!owns(page)) continue
        for (let dir = directoryOf(page); !own.has(dir); dir = parentDir(dir)) {
          own.add(dir)
          if (dir === '') break
        }
      }
    }

    const uncovered = [...directories.keys()]
      .filter((dir) => dir !== '' && !isCovered(dir))
      // Keep only the top of each unmentioned subtree; its children nest inside it.
      .filter((dir) => parentDir(dir) === '' || isCovered(parentDir(dir)))
      // On a site with several sidebars, a folder goes to the sidebar its pages belong to.
      .filter((dir) => own === undefined || own.has(dir))
      .sort(collator.compare)

    for (const dir of uncovered) {
      const items = generate(dir, false)
      if (items.length === 0) continue
      const group: SidebarGroup = {
        type: 'group',
        kind: 'category',
        label: apis.get(dir)?.title ?? dir.split('/').map(titleize).join(' / '),
        collapsed: false,
        items,
        auto: true,
      }
      sidebar.push(group)
    }
  }

  const unlisted = pages
    .filter((page) => owns(page) && page.slug !== '' && !listed.has(page.slug) && !page.sidebar.exclude)
    .map((page) => page.slug)
    .sort(collator.compare)

  return { sidebar, warnings, unlisted }
}

/* ─────────────────────────── more than one sidebar ───────────────────── */

/** One part of the site and its sidebar. */
export interface SidebarSection {
  /** The route the part starts at, without a slash at the end: `/guide`. */
  prefix: string
  sidebar: SidebarNode[]
}

export interface ResolvedSidebars {
  /** The sidebar of pages that are in no section. On a site with one sidebar, the sidebar. */
  sidebar: SidebarNode[]
  /** The parts of the site that have a sidebar of their own, longest path first. Empty on a site with one. */
  sections: SidebarSection[]
  /** Every sidebar's entries, in the order the file has them: the reading order of the whole site. */
  all: SidebarNode[]
  warnings: SidebarWarning[]
  unlisted: string[]
}

/** Is a route in the part of the site that starts at `prefix`? */
export function inSection(path: string, prefix: string): boolean {
  return prefix === '' || prefix === '/' || path === prefix || path.startsWith(`${prefix}/`)
}

/**
 * sidebar.yaml as a list is one sidebar. As a map it is several, each for
 * the part of the site its key names. A page belongs to the longest key it
 * is under, and `/` stands for every page that is under no other key. With
 * no `/`, those pages get a sidebar made from their folders, as a site with
 * no sidebar.yaml does.
 */
export function resolveSidebars(
  input: SidebarInput | Record<string, SidebarInput>,
  pages: readonly SidebarPageInfo[],
  options: { lang?: string; apis?: readonly ApiGroups[] } = {},
): ResolvedSidebars {
  if (Array.isArray(input)) {
    const one = resolveSidebar(input, pages, options)
    return { sidebar: one.sidebar, sections: [], all: one.sidebar, warnings: one.warnings, unlisted: one.unlisted }
  }

  const keys = Object.keys(input)
  const prefixOf = (key: string) => (key.length > 1 ? key.replace(/\/+$/, '') : key)
  const prefixes = new Set(keys.map(prefixOf).filter((prefix) => prefix !== '/'))

  // Which part each page is in, and which parts have a page at all. Each page is asked once, by walking
  // up its own path, so a site with many parts costs no more to sort out than a site with few.
  const section = new Map<SidebarPageInfo, string>()
  const peopled = new Set<string>()
  for (const page of pages) {
    let nearest: string | undefined
    // From the page's own route upwards, so the longest key is met first: /guide/advanced before /guide.
    for (let route = page.path; route !== '' && route !== '/'; route = route.slice(0, route.lastIndexOf('/'))) {
      if (!prefixes.has(route)) continue
      nearest ??= route
      peopled.add(route)
    }
    section.set(page, nearest ?? '/')
  }
  const sectionOf = (page: SidebarPageInfo) => section.get(page) ?? '/'

  const tree = contentTree(pages)
  const warnings: SidebarWarning[] = []
  const unlisted: string[] = []
  const sections: SidebarSection[] = []
  const all: SidebarNode[] = []
  let fallback: SidebarNode[] | undefined

  for (const key of keys) {
    const prefix = prefixOf(key)
    const resolved = resolveIn(tree, input[key]!, { ...options, owns: (page) => sectionOf(page) === prefix })
    // A warning says where in the file it is about, and the file now has the key above the list.
    warnings.push(...resolved.warnings.map((warning) => ({ ...warning, path: [key, ...(warning.path ?? [])] })))
    unlisted.push(...resolved.unlisted)
    all.push(...resolved.sidebar)
    if (prefix === '/') fallback = resolved.sidebar
    else {
      sections.push({ prefix, sidebar: resolved.sidebar })
      if (!peopled.has(prefix)) {
        warnings.push({ message: `No page is under ${prefix}, so this sidebar is never shown`, path: [key] })
      }
    }
  }

  if (!fallback) {
    // The pages that no sidebar answers for get one made from their folders.
    const rest = resolveSidebar([], pages.filter((page) => sectionOf(page) === '/'), options)
    fallback = rest.sidebar
    all.push(...rest.sidebar)
  }

  sections.sort((a, b) => b.prefix.length - a.prefix.length)
  return { sidebar: fallback, sections, all, warnings, unlisted }
}
