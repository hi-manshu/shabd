/**
 * What the four importers share above the level of a page: finding files,
 * and turning a source's navigation and site settings into the two YAML
 * files of a Shabd site.
 */
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { stringify } from 'yaml'
import { fileToSlug } from '../../shared/paths.js'
import { ConfigSchema, SidebarSchema, type SidebarEntryInput, type SidebarInput, type SidebarItemInput } from '../../shared/schema.js'
import { leadingHeading, splitFrontmatter } from '../content/frontmatter.js'
import { parseYaml } from '../config/yaml.js'
import { packageName } from '../paths.js'
import type { NavItem, SiteInput, SourcePage } from './types.js'

/**
 * Every file under `dir`, as paths from it with forward slashes, sorted.
 * Names that start with a dot (`.vitepress`, `.git`, `.DS_Store`) and
 * `node_modules` are left out: none of them is content.
 */
export async function listFiles(dir: string): Promise<string[]> {
  const found: string[] = []
  const walk = async (folder: string, prefix: string) => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      if (entry.isDirectory()) await walk(path.join(folder, entry.name), `${prefix}${entry.name}/`)
      else if (entry.isFile()) found.push(prefix + entry.name)
    }
  }
  if (existsSync(dir)) await walk(dir, '')
  return found.sort()
}

export const isPage = (file: string) => /\.mdx?$/i.test(file)

/** The path from one folder to a file in it, with forward slashes on every system: what the report shows. */
export const pathFrom = (folder: string, file: string) => path.relative(folder, file).split(path.sep).join('/')

/** The first of `names` that exists in `dir`. */
export function firstExisting(dir: string, names: string[]): string | undefined {
  return names.map((name) => path.join(dir, name)).find((file) => existsSync(file))
}

/** The address a page has when it is named by its path: `guide/index.md` → `guide`. */
export const routeOf = (id: string) => id.replace(/\.mdx?$/i, '').replace(/(^|\/)index$/i, '')

/** Maps for finding the page a link or a navigation entry means. */
export function indexPages(pages: SourcePage[]): { byFile: Map<string, string>; byRoute: Map<string, string> } {
  return {
    byFile: new Map(pages.map((page) => [page.source, page.id])),
    byRoute: new Map(pages.map((page) => [page.route, page.id])),
  }
}

/** A page's title as Shabd will find it: frontmatter, then a leading heading. */
export function titleOf(text: string, format: 'md' | 'mdx'): string | undefined {
  const block = splitFrontmatter(text)
  if (block) {
    try {
      const data = parseYaml('', block.yaml).data as { title?: unknown } | null
      if (typeof data?.title === 'string' && data.title) return data.title
    } catch {
      // Frontmatter Shabd will refuse: the check reports it.
    }
  }
  return leadingHeading(block ? block.body : text, format)
}

/* ────────────────────────────── site settings ───────────────────────── */

export const isUrl = (value: unknown): value is string => typeof value === 'string' && /^https?:\/\//i.test(value) && URL.canParse(value)

/** `https://example.com/docs/` → the origin for `site.url` and the path for `site.base`. */
export function splitUrl(address: unknown, base?: unknown): Pick<SiteInput, 'url' | 'base'> {
  const result: Pick<SiteInput, 'url' | 'base'> = {}
  let path = typeof base === 'string' ? base : ''
  if (isUrl(address)) {
    const url = new URL(address)
    result.url = url.origin
    if (!path) path = url.pathname
  }
  const trimmed = path.replace(/^\/+|\/+$/g, '')
  if (trimmed) result.base = `/${trimmed}/`
  return result
}

/** The name Shabd has an icon for, from whatever the source calls the network. */
export function socialName(name: string): string {
  const short = name.toLowerCase().split('/').at(-1)!.replace(/^(simple-icons|mdi|fa|fa6-brands):/, '')
  return short === 'twitter' || short === 'x-twitter' || short === 'x.com' ? 'x' : short
}

const HEADER = (tool: string) =>
  `# Written by \`shabd import\` from a ${tool} site. Only \`site.title\` is required.\n` +
  `# Shabd's documentation describes every key, under Configuration.\n`

/** shabd.config.yaml. Anything the schema would refuse is dropped and named in `dropped`. */
export function writeConfig(site: SiteInput, tool: string): { text: string; dropped: string[] } {
  const dropped: string[] = []
  const input: Record<string, unknown> = { ...site }
  for (const key of Object.keys(input)) {
    const value = input[key]
    if (value === undefined || (Array.isArray(value) && value.length === 0) || (typeof value === 'object' && value !== null && Object.keys(value).length === 0)) {
      delete input[key]
    }
  }
  // One key at a time, so that a bad value costs that key and not the site.
  for (const key of Object.keys(input)) {
    if (key !== 'title' && !ConfigSchema.safeParse({ site: { title: site.title, [key]: input[key] } }).success) {
      dropped.push(`site.${key}`)
      delete input[key]
    }
  }
  const body = stringify({ site: input }, { lineWidth: 0 })
  const features =
    '\nfeatures:\n  search:\n' +
    '    # Search matches keywords. To also match by meaning, install @huggingface/transformers\n' +
    '    # and set this to true.\n' +
    '    semantic: false\n'
  const schema = `# yaml-language-server: $schema=./node_modules/${packageName()}/schemas/config.schema.json\n#\n`
  return { text: `${schema}${HEADER(tool)}\n${body}${features}`, dropped }
}

/* ─────────────────────────────── navigation ─────────────────────────── */

/**
 * The source's navigation as sidebar.yaml entries.
 *
 * A group at the top is a `category`, the heading of a section, unless the
 * source says in so many words that it starts closed: then it is a `folder`,
 * which can. A group inside a group is always a `folder`. A page keeps the
 * label the source gave it only where that differs from its title, which is
 * the label Shabd uses anyway.
 */
export function toSidebar(nav: NavItem[], titles: ReadonlyMap<string, string>): SidebarInput {
  const ref = (id: string) => id.replace(/\.mdx?$/i, '')
  const item = (entry: NavItem, top: boolean): SidebarEntryInput | undefined => {
    if (entry.type === 'page') {
      const label = entry.label && entry.label !== titles.get(entry.id) ? entry.label : undefined
      if (!label && entry.badge === undefined) return ref(entry.id)
      return { file: ref(entry.id), ...(label ? { label } : {}), ...(entry.badge !== undefined ? { badge: entry.badge } : {}) }
    }
    if (entry.type === 'link') {
      return { link: entry.href, label: entry.label, ...(entry.badge !== undefined ? { badge: entry.badge } : {}) }
    }
    const items = entry.type === 'group' ? entry.items.flatMap((child) => (item(child, false) as SidebarItemInput | undefined) ?? []) : []
    // Shabd leaves out a group with no pages, with a warning. It is not written to begin with.
    if (entry.type === 'group' && items.length === 0) return undefined
    const source = entry.type === 'generated' ? { autogenerate: entry.directory || '.' } : { items }
    const badge = entry.type === 'group' && entry.badge !== undefined ? { badge: entry.badge } : {}
    if (top && entry.collapsed !== true) return { category: entry.label, ...badge, ...source }
    return { folder: entry.label, ...(entry.collapsed === true ? { collapsed: true } : {}), ...badge, ...source }
  }
  return nav.flatMap((entry) => item(entry, true) ?? [])
}

/** sidebar.yaml, with a comment that says where it came from. An empty list leaves the sidebar to Shabd. */
export function writeSidebar(sidebar: SidebarInput, origin: string): string {
  const valid = SidebarSchema.safeParse(sidebar)
  const comment =
    `# The navigation, in the order written here. ${origin}\n` +
    `# A page is named by its path under content/, without the extension. Folders that are not\n` +
    `# mentioned are added at the end, in alphabetical order.\n`
  if (!valid.success || sidebar.length === 0) {
    return `${comment}#\n# There are no entries, so Shabd generates the whole sidebar from the folders of content/.\n`
  }
  return `${comment}\n${stringify(sidebar, { lineWidth: 0 })}`
}

/** Two pages that would get the same address in Shabd, which refuses both. */
export function sameAddress(ids: string[]): [string, string][] {
  const seen = new Map<string, string>()
  const clashes: [string, string][] = []
  for (const id of ids) {
    const slug = fileToSlug(id)
    const other = seen.get(slug)
    if (other) clashes.push([other, id])
    else seen.set(slug, id)
  }
  return clashes
}
