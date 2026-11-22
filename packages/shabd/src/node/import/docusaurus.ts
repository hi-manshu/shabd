/**
 * Docusaurus.
 *
 * Three things set it apart from the other sources:
 *
 *   - A `.md` file is MDX there. One that holds a tag, an import or an
 *     expression is written as `.mdx`, or Shabd would drop what MDX read.
 *   - A page is named in the navigation by its id, not its path, and a
 *     number at the front of a file or folder name (`01-intro.md`) orders
 *     the sidebar and is left out of the address. The same is done here:
 *     the file is written without the number, which becomes `sidebar.order`.
 *   - The navigation may be generated from the folders, with a label and a
 *     position for each folder in a `_category_.json` beside its pages.
 *     Shabd has no place for a folder's label but sidebar.yaml, so generated
 *     navigation is written out in full.
 *
 * Not imported: the blog, pages under `src/pages`, versioned docs and
 * translations. The report says so when a site has them.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { fileToSlug } from '../../shared/paths.js'
import { splitFrontmatter } from '../content/frontmatter.js'
import { asString, evaluateConfig, isRecord, reason } from './evaluate.js'
import { asNumber, convertPage } from './frontmatter.js'
import { firstExisting, isPage, isUrl, listFiles, pathFrom, splitUrl } from './site.js'
import {
  attr,
  attribute,
  containerAlert,
  convertContainers,
  filterImports,
  makeMdxSafe,
  dropHeadingIds,
  mapProse,
  rewriteTags,
  spaceBlocks,
  stringValue,
  type Alert,
  type Line,
} from './text.js'
import { MESSAGES, type Conversion, type FileNote, type NavItem, type Note, type Relink, type SiteInput, type SourcePage, type SourceSite } from './types.js'

const { posix } = path

/* ──────────────────────────────── pages ─────────────────────────────── */

const ALERTS: Record<string, Alert> = {
  note: 'NOTE',
  info: 'NOTE',
  secondary: 'NOTE',
  tip: 'TIP',
  success: 'TIP',
  important: 'IMPORTANT',
  warning: 'WARNING',
  // Docusaurus 2 called its yellow box "caution" and its red one "danger".
  caution: 'WARNING',
  danger: 'CAUTION',
}
const PLAIN = new Set(['note', 'info', 'tip', 'important', 'warning', 'caution', 'danger'])
const CALLOUT_TYPES: Record<string, string> = { note: 'note', info: 'note', tip: 'tip', success: 'tip', important: 'important', warning: 'warning', caution: 'warning', danger: 'caution' }

/** Imports that bring in what Shabd has built in. They are removed, with the tags renamed below. */
const BUILT_IN = new Set(['@theme/Tabs', '@theme/TabItem', '@theme/Admonition'])

export interface DocusaurusPageOptions {
  /** `sidebar.order` for a page that names no position of its own: the number its file name starts with. */
  position?: number | undefined
  /** False when the site reads `.md` as plain Markdown (`markdown.format: detect`). */
  mdxInMd?: boolean | undefined
  /** Points links at the pages of the new site. Given by the import, which knows them all. */
  links?: Relink | undefined
  /** The address the page gets in the new site, such as `/guide/install`. A `slug` that says the same is not worth a note. */
  address?: string | undefined
}

export function convertDocusaurusPage(source: string, format: 'md' | 'mdx', options: DocusaurusPageOptions = {}): Conversion {
  const isMdx = format === 'mdx' || options.mdxInMd !== false
  return convertPage(source, {
    frontmatter(frontmatter) {
      frontmatter.move('sidebar_label', (value) => {
        if (typeof value !== 'string' && typeof value !== 'number') return false
        frontmatter.setSidebar('label', String(value))
        return true
      })
      frontmatter.move('sidebar_position', (value) => {
        const order = asNumber(value)
        if (order === undefined) return false
        frontmatter.setSidebar('order', order)
        return true
      })
      frontmatter.move('hide_table_of_contents', (value) => {
        if (value === true) frontmatter.set('toc', false)
        return typeof value === 'boolean'
      })
      const minDepth = asNumber(frontmatter.get('toc_min_heading_level'))
      const maxDepth = asNumber(frontmatter.get('toc_max_heading_level'))
      if ((minDepth !== undefined || maxDepth !== undefined) && frontmatter.get('toc') !== false) {
        frontmatter.delete('toc_min_heading_level')
        frontmatter.delete('toc_max_heading_level')
        frontmatter.set('toc', { ...(minDepth !== undefined ? { minDepth } : {}), ...(maxDepth !== undefined ? { maxDepth } : {}) })
        frontmatter.converted++
      }
      // Docusaurus hides one link at a time. Shabd shows both or neither.
      if (frontmatter.get('pagination_next') === null && frontmatter.get('pagination_prev') === null) {
        frontmatter.delete('pagination_next')
        frontmatter.delete('pagination_prev')
        frontmatter.set('pagination', false)
        frontmatter.converted++
      }
      frontmatter.move('custom_edit_url', (value) => {
        if (value !== null) return false
        frontmatter.set('editLink', false)
        return true
      })
      frontmatter.move('unlisted', (value) => {
        if (value !== true) return false
        frontmatter.setSidebar('exclude', true)
        frontmatter.set('noindex', true)
        return true
      })
      if (options.position !== undefined) {
        const sidebar = frontmatter.get('sidebar')
        if (!isRecord(sidebar) || sidebar.order === undefined) frontmatter.setSidebar('order', options.position)
      }
      const slug = asString(frontmatter.get('slug'))
      const same = (address: string | undefined) => address?.replace(/\/+$/, '')
      if (slug && same(slug) !== same(options.address)) frontmatter.manual.push({ key: 'slug', message: MESSAGES.slug(slug) })
    },
    body(lines, notes) {
      let needsMdx = format === 'mdx'
      let out = dropHeadingIds(options.links ? options.links(lines, notes) : lines, notes)
      if (!isMdx) return { lines: spaceBlocks(convertCallouts(out, notes)), mdx: false }

      out = filterImports(out, ({ from, line }) => {
        needsMdx = true
        if (BUILT_IN.has(from)) return false
        notes.push({ kind: 'manual', message: MESSAGES.imported(from), line: line.number })
        return true
      })

      /** `value` → label, from the `values` of the `<Tabs>` being read: the older way to label tabs. */
      let labels = new Map<string, string>()
      out = rewriteTags(out, (tag, line) => {
        needsMdx = true
        if (tag.name === 'Tabs') {
          if (tag.closing) return '</Tabs>'
          labels = new Map(
            [...(attr(tag, 'values') ?? '').matchAll(/\{[^{}]*\}/g)].flatMap(([item]) => {
              const label = /label:\s*(["'`])(.*?)\1/.exec(item)?.[2]
              const value = /value:\s*(["'`])(.*?)\1/.exec(item)?.[2]
              return label !== undefined && value !== undefined ? [[value, label] as [string, string]] : []
            }),
          )
          notes.push({ kind: 'converted', what: 'tab group', line: line.number })
          return '<Tabs>'
        }
        if (tag.name === 'TabItem') {
          if (tag.closing) return '</Tab>'
          const written = attr(tag, 'label')
          const value = stringValue(attr(tag, 'value'))
          const label = stringValue(written) ?? (written === undefined ? ((value !== undefined ? labels.get(value) : undefined) ?? value ?? 'Tab') : undefined)
          // A label that is an expression is kept as one.
          return label !== undefined ? `<Tab label="${attribute(label)}">` : `<Tab label=${written}>`
        }
        if (tag.name === 'Admonition') {
          if (tag.closing) return '</Callout>'
          const type = CALLOUT_TYPES[stringValue(attr(tag, 'type')) ?? 'note'] ?? 'note'
          const title = stringValue(attr(tag, 'title'))
          notes.push({ kind: 'converted', what: 'callout', line: line.number })
          return `<Callout type="${type}"${title ? ` title="${attribute(title)}"` : ''}>`
        }
        if (/^[A-Z]/.test(tag.name) && !tag.closing) notes.push({ kind: 'manual', message: MESSAGES.component(tag.name), line: line.number })
        return undefined
      })
      if (!needsMdx) {
        // An export, or an expression in braces, is MDX as well.
        needsMdx = out.some((line) => !line.code && (/^export\s/.test(line.text) || hasExpression(line.text)))
      }
      out = convertCallouts(out, notes)
      if (needsMdx) {
        const safe = makeMdxSafe(out, { commentsOnly: true })
        out = safe.lines
        for (let count = 0; count < safe.comments; count++) notes.push({ kind: 'converted', what: 'comment' })
      }
      return { lines: spaceBlocks(out), mdx: needsMdx }
    },
  })
}

/** True when a line holds `{…}` outside inline code: an expression, to MDX. */
function hasExpression(text: string): boolean {
  let found = false
  mapProse(text, (prose) => {
    found ||= /(^|[^\\])\{[^}]*\}/.test(prose)
    return prose
  })
  return found
}

function convertCallouts(lines: Line[], notes: Note[]): Line[] {
  return convertContainers(lines, (container) => containerAlert(container, ALERTS, PLAIN, notes))
}

/* ───────────────────────────── navigation ───────────────────────────── */

/** What the navigation needs to know about the docs. */
export interface DocusaurusDocs {
  /** Doc id, as sidebars name a page (`guide/install`) → the id of the page in the new site. */
  ids: ReadonlyMap<string, string>
  /** The entries of one folder of the docs, in the order Docusaurus generates them. `.` is the docs folder itself. */
  generate(dirName: string): NavItem[]
}

/**
 * One sidebar of a `sidebars.js`. `problems` collects what has no
 * counterpart. Docusaurus starts a category closed unless told otherwise;
 * at the top that is not passed on, so that the sections of the sidebar
 * stay headings (see `toSidebar`).
 */
export function docusaurusSidebar(items: unknown, docs: DocusaurusDocs, problems: string[], top = true): NavItem[] {
  const page = (id: unknown, label?: unknown): NavItem[] => {
    const found = typeof id === 'string' ? docs.ids.get(id) : undefined
    if (found === undefined) {
      problems.push(`The sidebar names the page "${String(id)}", which was not found. It was left out.`)
      return []
    }
    return [{ type: 'page', id: found, label: asString(label) }]
  }
  const group = (label: string, children: unknown, entry: Record<string, unknown> = {}): NavItem => {
    const link = isRecord(entry.link) ? entry.link : undefined
    if (link?.type === 'generated-index') problems.push(`The category "${label}" has a generated index page, which Shabd has no counterpart for.`)
    return {
      type: 'group',
      label,
      collapsed: top ? entry.collapsed === true || undefined : entry.collapsed !== false,
      items: [...(link?.type === 'doc' ? page(link.id) : []), ...docusaurusSidebar(children, docs, problems, false)],
    }
  }

  // `{ Guide: ['a', 'b'] }` is a short way to write categories.
  if (isRecord(items)) return Object.entries(items).map(([label, children]) => group(label, children))
  if (!Array.isArray(items)) return []
  return items.flatMap((item): NavItem[] => {
    if (typeof item === 'string') return page(item)
    if (!isRecord(item)) return []
    switch (item.type) {
      case 'doc':
      case 'ref':
        return page(item.id, item.label)
      case 'link':
        return typeof item.href === 'string' ? [{ type: 'link', href: item.href, label: asString(item.label) ?? item.href }] : []
      case 'category':
        return [group(asString(item.label) ?? 'Untitled', item.items, item)]
      case 'autogenerated':
        return docs.generate(asString(item.dirName) ?? '.')
      case 'html':
        problems.push('The sidebar holds an entry of raw HTML, which was left out.')
        return []
      default:
        return item.type === undefined ? Object.entries(item).map(([label, children]) => group(label, children)) : []
    }
  })
}

/* ──────────────────────────────── site ──────────────────────────────── */

/** `01-intro` → 1 and `intro`. A date or a version at the front of a name is not a position. */
export function numberPrefix(name: string): { position?: number; name: string } {
  const match = /^(\d+)\s*[-_.]+\s*([^-_.\s].*)$/.exec(name)
  if (!match || /^\d+[-_.]\d+/.test(name)) return { name }
  return { position: Number(match[1]), name: match[2]! }
}

interface Doc extends SourcePage {
  /** The folder of the page in the new site: `guide`, or empty at the top. */
  dir: string
  position: number | undefined
  /** The page stands for its folder. */
  index: boolean
}

/** What a `_category_` file says about a folder. The position is the number its name starts with, when the file gives none. */
interface Category {
  label?: string | undefined
  position?: number | undefined
  collapsed?: boolean | undefined
}

/** Generated navigation: pages and folders together, by position and then by name, a folder's own page first inside it. */
function generator(docs: Doc[], categories: ReadonlyMap<string, Category>): DocusaurusDocs['generate'] {
  const entries = (dir: string, top: boolean): NavItem[] => {
    const sortable: { item: NavItem; position: number; name: string }[] = []
    for (const doc of docs) {
      // Inside a folder, the folder's own page is put first by the caller.
      if (doc.dir !== dir || (doc.index && !top)) continue
      sortable.push({ item: { type: 'page', id: doc.id }, position: doc.position ?? Number.POSITIVE_INFINITY, name: doc.source })
    }
    const below = new Set(docs.filter((doc) => doc.dir.startsWith(dir ? `${dir}/` : '') && doc.dir !== dir).map((doc) => doc.dir.slice(dir ? dir.length + 1 : 0).split('/')[0]!))
    for (const name of below) {
      const sub = dir ? `${dir}/${name}` : name
      const category = categories.get(sub) ?? {}
      const index = docs.find((doc) => doc.dir === sub && doc.index)
      const items: NavItem[] = [...(index ? [{ type: 'page' as const, id: index.id }] : []), ...entries(sub, false)]
      if (items.length === 0) continue
      sortable.push({
        item: { type: 'group', label: category.label ?? name, collapsed: top ? category.collapsed === true || undefined : category.collapsed !== false, items },
        position: category.position ?? index?.position ?? Number.POSITIVE_INFINITY,
        name: sub,
      })
    }
    return sortable.sort((a, b) => a.position - b.position || (a.name < b.name ? -1 : 1)).map((entry) => entry.item)
  }
  return (dirName) => {
    const dir = posix.normalize(dirName).replace(/^\.$/, '').replace(/\/$/, '').split('/').map((part) => numberPrefix(part).name).join('/')
    return entries(dir, true)
  }
}

const CONFIG_FILES = ['ts', 'mts', 'js', 'mjs', 'cjs'].map((extension) => `docusaurus.config.${extension}`)
const SIDEBAR_FILES = ['ts', 'js', 'mjs', 'cjs', 'json'].map((extension) => `sidebars.${extension}`)

export async function readDocusaurus(root: string): Promise<SourceSite> {
  const notes: FileNote[] = []
  const configFile = firstExisting(root, CONFIG_FILES)
  let config: Record<string, unknown> = {}
  if (configFile) {
    try {
      const evaluated = await evaluateConfig(configFile)
      if (isRecord(evaluated.config)) config = evaluated.config
    } catch (error) {
      notes.push({ file: path.basename(configFile), message: `The config could not be run (${reason(error)}), so the title, the header links and the place of the sidebar file were not read from it.` })
    }
  }

  // The docs plugin is configured inside the preset: `presets: [['classic', { docs: { … } }]]`.
  const preset = (Array.isArray(config.presets) ? config.presets : []).map((entry) => (Array.isArray(entry) ? entry[1] : undefined)).find(isRecord)
  const docsOptions = isRecord(preset?.docs) ? preset.docs : {}
  const contentDir = path.resolve(root, asString(docsOptions.path) ?? 'docs')
  const routeBase = (asString(docsOptions.routeBasePath) ?? 'docs').replace(/^\/+|\/+$/g, '')
  const markdown = isRecord(config.markdown) ? config.markdown : {}
  const mdxInMd = markdown.format !== 'detect' && markdown.format !== 'md'

  /* ── pages ── */

  const files = await listFiles(contentDir)
  const categories = new Map<string, Category>()
  const docs: Doc[] = []
  /** Doc id, as sidebars name a page → the id of the page in the new site. */
  const docIds = new Map<string, string>()
  const positions = new Map<string, number | undefined>()
  /** A folder of the source as it is named in the new site, without the numbers its parts start with. */
  const cleanDir = (dir: string) => (dir === '.' ? '' : dir.split('/').map((part) => numberPrefix(part).name).join('/'))
  /** The number a folder's name starts with, which places it among its neighbours. */
  const folderPosition = (dir: string) => numberPrefix(posix.basename(dir)).position

  for (const source of files) {
    const dir = cleanDir(posix.dirname(source))
    const file = posix.basename(source)
    if (/^_category_\.(json|ya?ml)$/.test(file)) {
      try {
        const data = parseYaml(await readFile(path.join(contentDir, source), 'utf8')) as unknown
        if (isRecord(data)) {
          categories.set(dir, { ...categories.get(dir), label: asString(data.label), collapsed: typeof data.collapsed === 'boolean' ? data.collapsed : undefined })
          if (asNumber(data.position) !== undefined) categories.get(dir)!.position = asNumber(data.position)
        }
      } catch (error) {
        notes.push({ file: posix.join(pathFrom(root, contentDir), source), message: `Could not be read (${reason(error)}), so the folder keeps its own name in the sidebar.` })
      }
      continue
    }
    // Docusaurus leaves out anything whose name starts with an underscore: partials.
    if (!isPage(file) || source.split('/').some((part) => part.startsWith('_'))) continue
    // Every folder above the page, with the place its name gives it.
    for (let above = posix.dirname(source); above !== '.'; above = posix.dirname(above)) {
      const clean = cleanDir(above)
      if (categories.get(clean)?.position === undefined && folderPosition(above) !== undefined) {
        categories.set(clean, { ...categories.get(clean), position: folderPosition(above) })
      }
    }

    const text = await readFile(path.join(contentDir, source), 'utf8')
    let frontmatter: Record<string, unknown> = {}
    try {
      const block = splitFrontmatter(text.replace(/\r\n?/g, '\n'))
      const data = block ? (parseYaml(block.yaml.slice(block.yaml.indexOf('\n') + 1)) as unknown) : undefined
      if (isRecord(data)) frontmatter = data
    } catch {
      // The page is reported when it is converted.
    }
    const extension = posix.extname(file)
    const prefix = numberPrefix(file.slice(0, -extension.length))
    const index = /^(index|readme)$/i.test(prefix.name) || prefix.name === posix.basename(dir)
    const name = index ? 'index' : prefix.name
    const id = posix.join(dir, `${name}${extension}`)
    const docId = posix.join(dir, asString(frontmatter.id) ?? prefix.name)
    const slug = asString(frontmatter.slug)
    const route = (slug === undefined ? posix.join(dir, index ? '' : prefix.name) : slug.startsWith('/') ? slug : posix.join(dir, slug)).replace(/^\.$/, '').replace(/^\/+|\/+$/g, '')
    docs.push({ source, id, route, dir, index, position: asNumber(frontmatter.sidebar_position) ?? prefix.position })
    positions.set(source, prefix.position)
    docIds.set(docId, id)
  }

  // A page that Docusaurus serves as the first page of the docs (`slug: /`) is the home page of the new site.
  const home = docs.find((doc) => doc.route === '')
  if (home && !docs.some((doc) => doc.id === 'index.md' || doc.id === 'index.mdx')) {
    const id = `index${posix.extname(home.id)}`
    for (const [docId, pageId] of docIds) if (pageId === home.id) docIds.set(docId, id)
    Object.assign(home, { id, dir: '', index: true })
  }

  /* ── navigation ── */

  const generate = generator(docs, categories)
  const sidebarPath = docsOptions.sidebarPath
  const sidebarFile =
    typeof sidebarPath === 'string' ? path.resolve(root, sidebarPath) : sidebarPath === false ? undefined : firstExisting(root, SIDEBAR_FILES)
  let nav: NavItem[] | undefined = generate('.')
  let navSource = 'Generated from the folders of the docs, their `_category_` files and the position of each page, as Docusaurus does without a sidebar file.'
  if (sidebarFile && existsSync(sidebarFile)) {
    const name = pathFrom(root, sidebarFile)
    try {
      const { config: sidebars } = await evaluateConfig(sidebarFile)
      if (!isRecord(sidebars)) throw new Error('it does not export an object of sidebars')
      const problems: string[] = []
      nav = Object.values(sidebars).flatMap((items) => docusaurusSidebar(items, { ids: docIds, generate }, problems))
      navSource = `From ${name}.`
      const names = Object.keys(sidebars)
      if (names.length > 1) problems.push(`The site has ${names.length} sidebars (${names.join(', ')}). Shabd has one, so they follow each other in that order.`)
      for (const message of problems) notes.push({ file: name, message })
    } catch (error) {
      nav = undefined
      navSource = `${name} could not be run (${reason(error)}), so there are no entries: Shabd generates the sidebar from the folders.`
      notes.push({ file: name, message: `Could not be run (${reason(error)}). The sidebar was not imported.` })
    }
  }

  /* ── site settings ── */

  const theme = isRecord(config.themeConfig) ? config.themeConfig : {}
  const navbar = isRecord(theme.navbar) ? theme.navbar : {}
  /** A file in static/, as the path it is served from. Undefined when there is no such file. */
  const address = (value: unknown) => {
    if (typeof value !== 'string' || /^https?:\/\//i.test(value)) return undefined
    const file = value.replace(/^\/+/, '')
    return existsSync(path.join(root, 'static', file)) ? `/${file}` : undefined
  }
  const site: SiteInput = {
    title: asString(config.title) ?? asString(navbar.title) ?? path.basename(root),
    description: asString(config.tagline),
    ...splitUrl(config.url, config.baseUrl),
    lang: asString(isRecord(config.i18n) ? config.i18n.defaultLocale : undefined),
    favicon: address(config.favicon),
    logo: address(isRecord(navbar.logo) ? navbar.logo.src : undefined),
  }
  const footer = isRecord(theme.footer) ? asString(theme.footer.copyright) : undefined
  if (footer && !/[<{]/.test(footer)) site.footer = footer

  const byRoute = new Map(docs.map((doc) => [doc.route, doc.id]))
  const prefixes = [site.base?.replace(/\/$/, '') ?? '', routeBase ? `/${routeBase}` : ''].filter(Boolean)
  const links: { label: string; link: string }[] = []
  const social: Record<string, string> = {}
  for (const item of Array.isArray(navbar.items) ? navbar.items : []) {
    if (!isRecord(item)) continue
    const label = asString(item.label)
    const href = asString(item.href)
    if (href && isUrl(href)) {
      if (/github\.com/.test(href)) {
        social.github = href
        site.repo ??= /^https:\/\/github\.com\/[^/]+\/[^/]+/.exec(href)?.[0]
      } else if (label) links.push({ label, link: href })
      continue
    }
    if (!label) continue
    // A link to a page of the docs: by id, by sidebar, or by address.
    let target = item.type === 'doc' ? docIds.get(String(item.docId)) : undefined
    if (item.type === 'docSidebar' && nav) {
      const first = (entries: NavItem[]): string | undefined => entries.flatMap((entry) => (entry.type === 'page' ? [entry.id] : entry.type === 'group' ? (first(entry.items) ?? []) : []))[0]
      target = first(nav)
    }
    const to = asString(item.to)
    if (!target && to) {
      let rest = to
      for (const prefix of prefixes) if (rest === prefix || rest.startsWith(`${prefix}/`)) rest = rest.slice(prefix.length)
      target = byRoute.get(rest.replace(/^\/+|\/+$/g, ''))
    }
    if (target) links.push({ label, link: `/${target.replace(/\.mdx?$/, '').replace(/(^|\/)index$/, '')}`.replace(/(.)\/$/, '$1') })
    else notes.push({ file: configFile ? path.basename(configFile) : 'docusaurus.config.js', message: `The header link "${label}" leads to something that was not imported, and was left out.` })
  }
  site.nav = links
  site.social = social

  for (const [folder, what] of [
    ['blog', 'The blog was not imported: Shabd has no blog.'],
    ['src/pages', 'Pages under src/pages were not imported. They are React or stand-alone pages outside the docs.'],
    ['versioned_docs', 'Older versions of the docs were not imported, only the current one.'],
    ['i18n', 'Translations were not imported.'],
  ] as const) {
    if (existsSync(path.join(root, folder))) notes.push({ file: folder, message: what })
  }

  return {
    tool: 'docusaurus',
    contentDir,
    pages: docs.map(({ source, id, route }) => ({ source, id, route })),
    publicDirs: [path.join(root, 'static')],
    site,
    nav,
    navSource,
    links: { relative: 'file', prefixes },
    notes,
    // A picture beside a page moves with it when the folder loses its number. `_category_` files have been read.
    place: (file) => (/^_category_\./.test(posix.basename(file)) ? undefined : posix.join(cleanDir(posix.dirname(file)), posix.basename(file))),
    convert: (text, page, links) =>
      convertDocusaurusPage(text, /\.mdx$/i.test(page.source) ? 'mdx' : 'md', {
        position: positions.get(page.source),
        mdxInMd,
        links,
        address: `/${fileToSlug(page.id)}`,
      }),
  }
}
