/**
 * The content graph: every page, its frontmatter, and the sidebar derived
 * from them. One instance backs the dev server, the build, search indexing,
 * llms.txt and the MCP server.
 *
 * Updates are incremental. `upsert` re-parses a single file and reports how
 * much changed, so the dev server can decide between "swap one page module"
 * and "also refresh navigation" without rescanning the content directory.
 */
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileToSlug, isPageFile, slugToPath } from '../../shared/paths.js'
import { FrontmatterSchema, type Frontmatter } from '../../shared/schema.js'
import type { PageMeta, SiteData } from '../../shared/types.js'
import { isShabdError, ShabdError, type SourceIssue } from '../config/errors.js'
import { loadSidebar, type LoadedSidebar, type ResolvedConfig } from '../config/load.js'
import { paletteChoices, themeToCss } from '../config/theme-css.js'
import { leadingHeading, parseFrontmatter } from './frontmatter.js'
import { resolveSidebar, type ResolvedSidebar } from './sidebar.js'

export interface PageRecord {
  /** Content-relative POSIX path, e.g. `guide/install.mdx`. Stable identity of a page. */
  id: string
  /** Absolute file path. */
  file: string
  slug: string
  /** Route path, e.g. `/guide/install`. */
  path: string
  isIndex: boolean
  format: 'md' | 'mdx'
  source: string
  /** Hash of `source`; the key for every per-page cache. */
  hash: string
  frontmatter: Frontmatter
  /** The source without its frontmatter block. */
  body: string
  title: string
  /** The title came from a leading `# heading`, which the pipeline lifts out of the body. */
  titleFromHeading: boolean
  description: string
  /** Set when the frontmatter is invalid. The page keeps its route so the error can be shown there. */
  error?: ShabdError
}

/**
 * How much of a page changed:
 *   none  – same bytes
 *   body  – content only; navigation is unaffected
 *   meta  – title, description, or sidebar options changed; navigation must refresh
 *   added – a new page
 */
export type PageChange = 'none' | 'body' | 'meta' | 'added'

export interface StoreOptions {
  /** Include pages marked `draft: true`. On in dev, off in production builds. */
  drafts: boolean
}

const sha1 = (text: string) => createHash('sha1').update(text).digest('hex')
const toPosix = (file: string) => file.split(path.sep).join('/')

/** Files and folders starting with `_` or `.` are partials and private notes, not pages. */
function isRoutable(id: string): boolean {
  return isPageFile(id) && !id.split('/').some((segment) => segment.startsWith('_') || segment.startsWith('.'))
}

export async function scanContent(contentDir: string): Promise<string[]> {
  const entries = await readdir(contentDir, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((file) => isRoutable(toPosix(path.relative(contentDir, file))))
    .sort()
}

export class ContentStore {
  config: ResolvedConfig
  readonly options: StoreOptions
  #pages = new Map<string, PageRecord>()
  #sidebarSource: LoadedSidebar
  #sidebar: ResolvedSidebar | undefined
  #revision = 0

  constructor(config: ResolvedConfig, sidebar: LoadedSidebar, options: StoreOptions) {
    this.config = config
    this.options = options
    this.#sidebarSource = sidebar
  }

  /** Scan the content directory and read every page. */
  static async load(config: ResolvedConfig, options: StoreOptions): Promise<ContentStore> {
    const store = new ContentStore(config, await loadSidebar(config), options)
    let files: string[]
    try {
      files = await scanContent(config.contentDir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      throw new ShabdError(config.configFile, [
        {
          path: ['content', 'dir'],
          message: `Content directory not found: ${config.contentDir}. Create it, or point content.dir at your Markdown folder.`,
        },
      ])
    }
    await Promise.all(files.map((file) => store.upsert(file)))
    store.assertUniqueRoutes()
    return store
  }

  /* ─────────────────────────────── reads ─────────────────────────────── */

  /** Increases whenever a page's content changes. Derived data (the search index) is rebuilt when it moves. */
  get revision(): number {
    return this.#revision
  }

  /** Published pages, in route order. */
  pages(): PageRecord[] {
    return [...this.#pages.values()]
      .filter((page) => this.options.drafts || !page.frontmatter.draft)
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  }

  byId(id: string): PageRecord | undefined {
    return this.#pages.get(id)
  }

  byFile(file: string): PageRecord | undefined {
    return this.#pages.get(this.idOf(file))
  }

  byPath(routePath: string): PageRecord | undefined {
    return this.pages().find((page) => page.path === routePath)
  }

  /** Pages whose frontmatter failed validation. */
  errors(): ShabdError[] {
    return this.pages().flatMap((page) => (page.error ? [page.error] : []))
  }

  /** True when `file` is inside the content directory and would be a page. */
  owns(file: string): boolean {
    const relative = path.relative(this.config.contentDir, file)
    return !relative.startsWith('..') && !path.isAbsolute(relative) && isRoutable(toPosix(relative))
  }

  idOf(file: string): string {
    return toPosix(path.relative(this.config.contentDir, file))
  }

  get sidebar(): ResolvedSidebar {
    this.#sidebar ??= resolveSidebar(
      this.#sidebarSource.input,
      this.pages().map((page) => ({
        slug: page.slug,
        path: page.path,
        title: page.title,
        isIndex: page.isIndex,
        sidebar: page.frontmatter.sidebar,
      })),
      { lang: this.config.config.site.lang },
    )
    return this.#sidebar
  }

  /** Sidebar warnings with line numbers in sidebar.yaml. */
  sidebarWarnings(): SourceIssue[] {
    return this.#sidebarSource.locate(
      this.sidebar.warnings.map((warning) => ({ path: warning.path ?? [], message: warning.message })),
    )
  }

  /** Everything the browser needs to render navigation and pick layouts. */
  siteData(options: { dev: boolean }): SiteData {
    const { config, layouts } = this.config
    const pages: Record<string, PageMeta> = {}
    for (const page of this.pages()) {
      pages[page.path] = { id: page.id, path: page.path, title: page.title, description: page.description }
    }
    return {
      site: config.site,
      colorMode: config.theme.colorMode,
      palettes: paletteChoices(config.theme),
      defaults: config.defaults,
      features: config.features,
      layouts,
      sidebar: this.sidebar.sidebar,
      pages,
      contentDir: config.content.dir,
      ...(options.dev ? { themeCss: themeToCss(config.theme) } : {}),
    }
  }

  /* ────────────────────────────── writes ─────────────────────────────── */

  /** Read (or accept) a file's current contents and update its record. */
  async upsert(file: string, source?: string): Promise<{ page: PageRecord; change: PageChange }> {
    const id = this.idOf(file)
    const text = source ?? (await readFile(file, 'utf8'))
    const hash = sha1(text)
    const previous = this.#pages.get(id)
    if (previous && previous.hash === hash) return { page: previous, change: 'none' }

    const page = this.#read(id, file, text, hash, previous)
    this.#pages.set(id, page)
    this.#revision++

    const change: PageChange = !previous ? 'added' : metaKey(previous) === metaKey(page) ? 'body' : 'meta'
    if (change !== 'body') this.#sidebar = undefined
    return { page, change }
  }

  remove(file: string): PageRecord | undefined {
    const id = this.idOf(file)
    const page = this.#pages.get(id)
    if (page) {
      this.#pages.delete(id)
      this.#sidebar = undefined
      this.#revision++
    }
    return page
  }

  /** Swap in a reloaded config. Only for changes that do not alter compiled pages or the page set. */
  setConfig(config: ResolvedConfig): void {
    this.config = config
    this.#sidebar = undefined
  }

  setSidebar(sidebar: LoadedSidebar): void {
    this.#sidebarSource = sidebar
    this.#sidebar = undefined
  }

  /** Two files that resolve to one URL (`a.md` and `a/index.md`) cannot both be served. */
  assertUniqueRoutes(): void {
    const byPath = new Map<string, PageRecord>()
    for (const page of this.pages()) {
      const other = byPath.get(page.path)
      if (other) {
        throw new ShabdError(page.file, [
          {
            path: [],
            message: `Two pages map to the same URL ${page.path}:\n    ${other.id}\n    ${page.id}\n  Rename or remove one of them.`,
          },
        ])
      }
      byPath.set(page.path, page)
    }
  }

  #read(id: string, file: string, source: string, hash: string, previous?: PageRecord): PageRecord {
    const format = id.toLowerCase().endsWith('.mdx') ? 'mdx' : 'md'
    const slug = fileToSlug(id)
    const fileName = id.slice(id.lastIndexOf('/') + 1).replace(/\.mdx?$/i, '')

    let frontmatter: Frontmatter
    let body = source
    let error: ShabdError | undefined
    try {
      ;({ frontmatter, body } = parseFrontmatter(file, source, Object.keys(this.config.layouts)))
    } catch (cause) {
      if (!isShabdError(cause)) throw cause
      error = cause
      // The route stays alive so the error can be shown on the page itself.
      // A page that was valid a moment ago keeps the title, layout and sidebar
      // entry it had: a half-typed line should not rearrange the navigation.
      if (previous) {
        return { ...previous, source, hash, error }
      }
      frontmatter = FrontmatterSchema.parse({})
    }

    const heading = frontmatter.title === undefined ? leadingHeading(body, format) : undefined
    const fallback = slug === '' ? this.config.config.site.title : titleFromFileName(fileName === 'index' ? slug : fileName)

    return {
      id,
      file,
      slug,
      path: slugToPath(slug),
      isIndex: fileName.toLowerCase() === 'index',
      format,
      source,
      hash,
      frontmatter,
      body,
      title: frontmatter.title ?? heading ?? fallback,
      titleFromHeading: heading !== undefined,
      description: frontmatter.description ?? '',
      ...(error ? { error } : {}),
    }
  }
}

function titleFromFileName(name: string): string {
  const last = name.slice(name.lastIndexOf('/') + 1)
  return last.replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

/** The parts of a page other pages depend on. If this is unchanged, navigation is unchanged. */
function metaKey(page: PageRecord): string {
  return JSON.stringify([
    page.path,
    page.title,
    page.description,
    page.frontmatter.sidebar,
    page.frontmatter.draft,
  ])
}
