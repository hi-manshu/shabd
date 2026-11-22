/**
 * The content graph: every page, its frontmatter, and the sidebar derived
 * from them. One instance backs the dev server, the build, search indexing,
 * llms.txt and the MCP server.
 *
 * Updates are incremental. `upsert` re-parses a single file and reports how
 * much changed, so the dev server can decide between "swap one page module"
 * and "also refresh navigation" without rescanning the content directory.
 */
import { editionRoots, placeOf } from '../../shared/editions.js'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileToSlug, isPageFile, slugToPath } from '../../shared/paths.js'
import { FrontmatterSchema, type Frontmatter } from '../../shared/schema.js'
import type { PageMeta, PageUpdated, SiteData } from '../../shared/types.js'
import { isShabdError, ShabdError, type SourceIssue } from '../config/errors.js'
import { loadSidebar, type LoadedSidebar, type ResolvedConfig } from '../config/load.js'
import { paletteChoices, themeToCss } from '../config/theme-css.js'
import { leadingHeading, parseFrontmatter } from './frontmatter.js'
import { formatDay, lastCommitDates } from './git.js'
import { generatedId, writeApiPages, type ApiSection } from '../openapi/site.js'
import { substituteVars, type VariableNote } from './vars.js'
import { resolveSidebars, type ResolvedSidebars } from './sidebar.js'

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
  /** The text of the file, with the site's variables filled in. Everything made from the page is made from this. */
  source: string
  /** Hash of the file as it is on disk; the key for every per-page cache. */
  hash: string
  /** Names in the page that look like a mistyped variable, for `shabd check`. */
  notes: VariableNote[]
  frontmatter: Frontmatter
  /** The source without its frontmatter block. */
  body: string
  title: string
  /** The title came from a leading `# heading`, which the pipeline lifts out of the body. */
  titleFromHeading: boolean
  description: string
  /** The day the page was last changed: from its frontmatter, or from Git when the site shows the day. */
  updated?: PageUpdated
  /** Set when the frontmatter is invalid. The page keeps its route so the error can be shown there. */
  error?: ShabdError
  /**
   * The OpenAPI description the page was made from, as a path from the site
   * folder. Such a page has no file of its own to edit: `file` is what Shabd
   * wrote, and is written again when the description changes.
   */
  generated?: string
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

/** What the site knows of a page, as the page's own module carries it to the browser. */
export function pageMeta(page: PageRecord): PageMeta {
  return {
    id: page.id,
    path: page.path,
    title: page.title,
    description: page.description,
    ...(page.generated ? { generated: true } : {}),
  }
}

export class ContentStore {
  config: ResolvedConfig
  readonly options: StoreOptions
  #pages = new Map<string, PageRecord>()
  #sidebarSource: LoadedSidebar
  #sidebar: ResolvedSidebars | undefined
  #published: { list: readonly PageRecord[]; byPath: ReadonlyMap<string, PageRecord> } | undefined
  /** The OpenAPI descriptions pages were made from (`openapi:` in the config). */
  #apis: ApiSection[] = []
  #revision = 0
  /** File → the day of its last commit. Empty unless `defaults.lastUpdated` is on. */
  #commitDays = new Map<string, string>()
  /** Why Git gave no days, when the site asked for them and got none. */
  lastUpdatedNote: string | undefined

  constructor(config: ResolvedConfig, sidebar: LoadedSidebar, options: StoreOptions) {
    this.config = config
    this.options = options
    this.#sidebarSource = sidebar
  }

  /** Scan the content directory and read every page. */
  static async load(config: ResolvedConfig, options: StoreOptions): Promise<ContentStore> {
    const store = new ContentStore(config, await loadSidebar(config), options)
    if (config.config.defaults.lastUpdated) {
      const git = await lastCommitDates(config.contentDir)
      store.#commitDays = git.dates
      store.lastUpdatedNote = git.note
    }
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
    // The pages made from OpenAPI descriptions are written first, and then read like the rest.
    const apis = await writeApiPages(config)
    store.#apis = apis.sections
    await Promise.all([...files, ...apis.files].map((file) => store.upsert(file)))
    store.assertUniqueRoutes()
    return store
  }

  /* ─────────────────────────────── reads ─────────────────────────────── */

  /** Increases whenever a page's content changes. Derived data (the search index) is rebuilt when it moves. */
  get revision(): number {
    return this.#revision
  }

  /**
   * The published pages in route order, and the same pages by route. They are
   * worked out when first asked for and kept until a page changes: a build
   * asks for a page by its route for every link and every page it writes, and
   * sorting the whole site each time made a large site slow to build.
   */
  #view(): { list: readonly PageRecord[]; byPath: ReadonlyMap<string, PageRecord> } {
    if (!this.#published) {
      const list = [...this.#pages.values()]
        .filter((page) => this.options.drafts || !page.frontmatter.draft)
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      const byPath = new Map<string, PageRecord>()
      // Two files with one route are an error that is reported elsewhere. Until it is fixed, the first one answers.
      for (const page of list) if (!byPath.has(page.path)) byPath.set(page.path, page)
      this.#published = { list, byPath }
    }
    return this.#published
  }

  /** Published pages, in route order. The list is the store's own: copy it before changing it. */
  pages(): readonly PageRecord[] {
    return this.#view().list
  }

  byId(id: string): PageRecord | undefined {
    return this.#pages.get(id)
  }

  byFile(file: string): PageRecord | undefined {
    return this.#pages.get(this.idOf(file))
  }

  byPath(routePath: string): PageRecord | undefined {
    return this.#view().byPath.get(routePath)
  }

  /** Pages whose frontmatter failed validation. */
  errors(): ShabdError[] {
    return this.pages().flatMap((page) => (page.error ? [page.error] : []))
  }

  /** True when `file` would be a page: it is inside the content directory, or among the pages made from a description. */
  owns(file: string): boolean {
    const generated = generatedId(this.config, file)
    if (generated !== undefined) return isRoutable(generated)
    const relative = path.relative(this.config.contentDir, file)
    return !relative.startsWith('..') && !path.isAbsolute(relative) && isRoutable(toPosix(relative))
  }

  /** A generated page has the id it would have if its folder were the content folder: `api/pets/list-pets.md`. */
  idOf(file: string): string {
    return generatedId(this.config, file) ?? toPosix(path.relative(this.config.contentDir, file))
  }

  /** The OpenAPI descriptions pages were made from, with what of each could not be shown. */
  get apis(): readonly ApiSection[] {
    return this.#apis
  }

  /** The description a generated page came from. */
  #apiOf(id: string): ApiSection | undefined {
    return this.#apis.find((api) => api.dir === '' || id.startsWith(`${api.dir}/`))
  }

  /** The site's sidebar, or its sidebars: the one for pages in no section, and one for each section. */
  get sidebar(): ResolvedSidebars {
    this.#sidebar ??= resolveSidebars(
      this.#sidebarSource.input,
      this.pages().map((page) => ({
        slug: page.slug,
        path: page.path,
        title: page.title,
        isIndex: page.isIndex,
        sidebar: page.frontmatter.sidebar,
      })),
      { lang: this.config.config.site.lang, apis: this.#apis, roots: editionRoots(this.config.editions) },
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
    if (options.dev) for (const page of this.pages()) pages[page.path] = pageMeta(page)
    const hasEditions = (this.config.editions.languages?.length ?? 0) > 1 || (this.config.editions.versions?.length ?? 0) > 1
    // The words a language gives for the site's own furniture. A language that gives none is left out.
    const ui = Object.fromEntries(config.languages.filter((language) => Object.keys(language.ui).length > 0).map((language) => [language.code, language.ui]))
    // The header's links and the footer, in each language that has its own.
    const siteIn = Object.fromEntries(
      config.languages.flatMap((language) => {
        const said = { ...(language.nav ? { nav: language.nav } : {}), ...(language.footer !== undefined ? { footer: language.footer } : {}) }
        return Object.keys(said).length > 0 ? [[language.code, said]] : []
      }),
    )
    // The tags for <head> are written into each document. Leaving them out here keeps them out of the script.
    const { head: _head, ...site } = config.site
    return {
      site,
      colorMode: config.theme.colorMode,
      palettes: paletteChoices(config.theme),
      defaults: config.defaults,
      features: config.features,
      layouts,
      sidebar: this.sidebar.sidebar,
      ...(this.sidebar.sections.length ? { sidebars: this.sidebar.sections } : {}),
      ...(hasEditions ? { editions: this.config.editions } : {}),
      ...(Object.keys(ui).length > 0 ? { ui } : {}),
      ...(Object.keys(siteIn).length > 0 ? { siteIn } : {}),
      contentDir: config.content.dir,
      // The whole table of pages is for the dev server. A build sends each page what is known of it, with the page.
      ...(options.dev ? { pagesInDev: pages, themeCss: themeToCss(config.theme) } : {}),
    }
  }

  /* ────────────────────────────── writes ─────────────────────────────── */

  /** Read (or accept) a file's current contents and update its record. */
  async upsert(file: string, source?: string): Promise<{ page: PageRecord; change: PageChange }> {
    const id = this.idOf(file)
    const text = source ?? (await readFile(file, 'utf8'))
    const hash = sha1(text)
    const previous = this.#pages.get(id)
    // A page made from a description has the id of the file it would be in the content folder, and a
    // site can have that file too. Neither may quietly take the place of the other.
    // Compared as the file system sees them: the dev server names a file with forward slashes on every system.
    if (previous && path.resolve(previous.file) !== path.resolve(file)) {
      const relative = (other: string) => toPosix(path.relative(this.config.root, other))
      const made = previous.generated ?? this.#apiOf(id)?.spec
      throw new ShabdError(previous.generated ? file : previous.file, [
        {
          path: [],
          message:
            `Two pages map to the same URL ${previous.path}:\n    ${relative(previous.file)}\n    ${relative(file)}\n` +
            `  One of them is made from an OpenAPI description${made ? ` (${relative(path.resolve(this.config.root, made))})` : ''}. ` +
            'Move the other, or give the API another `path`.',
        },
      ])
    }
    if (previous && previous.hash === hash) return { page: previous, change: 'none' }

    const page = this.#read(id, file, text, hash, previous)
    this.#pages.set(id, page)
    this.#published = undefined
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
      this.#published = undefined
      this.#revision++
    }
    return page
  }

  /**
   * Make the pages of the OpenAPI descriptions again, after one of them
   * changed, and take them into the store. Gives back the pages that are new,
   * the ones whose text changed and the ones that are gone, so that the dev
   * server can tell the browser.
   *
   * A description that can no longer be read throws, and the pages stay as
   * they were.
   */
  async regenerate(): Promise<{ added: PageRecord[]; changed: PageRecord[]; removed: PageRecord[] }> {
    const written = await writeApiPages(this.config)
    this.#apis = written.sections
    // The names and the order of an API's groups are part of the sidebar, whether or not a page changed.
    this.#sidebar = undefined
    const removed = written.removed.flatMap((file) => this.remove(file) ?? [])
    const read = async (files: string[]) => Promise.all(files.map(async (file) => (await this.upsert(file)).page))
    return { added: await read(written.added), changed: await read(written.changed), removed }
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

  #read(id: string, file: string, text: string, hash: string, previous?: PageRecord): PageRecord {
    const api = generatedId(this.config, file) === undefined ? undefined : this.#apiOf(id)
    const generated = api ? toPosix(path.relative(this.config.root, api.spec)) : undefined
    // A description is somebody else's text, and braces in it are braces: the site's variables are for its own pages.
    const { text: source, notes } = generated ? { text, notes: [] } : substituteVars(text, this.config.vars)
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
        return { ...previous, source, hash, notes, error }
      }
      frontmatter = FrontmatterSchema.parse({})
    }

    const heading = frontmatter.title === undefined ? leadingHeading(body, format) : undefined
    const fallback = slug === '' ? this.config.config.site.title : titleFromFileName(fileName === 'index' ? slug : fileName)
    // A day written in the page is the author's word and is always shown. Git's is shown when the site asks for it.
    const day = frontmatter.lastUpdated === false ? undefined : (frontmatter.lastUpdated ?? this.#commitDays.get(file))

    return {
      id,
      file,
      slug,
      path: slugToPath(slug),
      isIndex: fileName.toLowerCase() === 'index',
      format,
      source,
      hash,
      notes,
      frontmatter,
      body,
      title: frontmatter.title ?? heading ?? fallback,
      titleFromHeading: heading !== undefined,
      description: frontmatter.description ?? '',
      // The day is written as the page's own language writes one: `21. November 2026` on a German page.
      ...(day ? { updated: { day, text: formatDay(day, placeOf(slugToPath(slug), this.config.editions).language?.lang ?? this.config.config.site.lang) } } : {}),
      ...(error ? { error } : {}),
      ...(generated ? { generated } : {}),
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
