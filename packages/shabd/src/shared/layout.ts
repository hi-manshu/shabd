/**
 * The layout engine's data model.
 *
 * Built-in layouts are plain data in the same shape users write in YAML, so
 * "doc", "splash" and "api" are not special cases in any component: they are
 * three entries in a table that `shabd.config.yaml` can edit or add to.
 */
import { placeOf } from './editions.js'
import { BUILTIN_BLOCKS, REGIONS, type RegionName } from './blocks.js'
import type { BlockRef, Frontmatter, LayoutDefinition, ShabdConfig, TocOptions } from './schema.js'
import type { LayoutWidth, ResolvedLayout, SiteData, TocEntry } from './types.js'

const ref = (block: string): BlockRef => ({ block, props: {} })
const blocks = (...names: string[]): BlockRef[] => names.map(ref)

export const BUILTIN_LAYOUT_DEFINITIONS: Record<string, LayoutDefinition> = {
  /** Chrome shared by every built-in layout. Override this to change the header everywhere. */
  base: {
    regions: {
      header: blocks(
        'menu-toggle',
        'site-title',
        'nav',
        'spacer',
        'search',
        // Each is there on a site that has more than one version, or more than one language, and nowhere else.
        'version-menu',
        'language-menu',
        'studio-toggle',
        'social',
        'theme-menu',
        'theme-toggle',
      ),
      footer: blocks('footer'),
    },
  },
  doc: {
    extends: 'base',
    width: 'content',
    regions: {
      sidebar: blocks('sidebar-nav'),
      main: blocks('version-notice', 'breadcrumbs', 'page-header', 'page-actions', 'content', 'page-footer', 'pagination'),
      aside: blocks('toc'),
    },
  },
  splash: {
    extends: 'base',
    width: 'wide',
    regions: {
      main: blocks('hero', 'content'),
    },
  },
  api: {
    extends: 'base',
    width: 'full',
    // What a request looks like stays in view beside what is said about it.
    split: true,
    regions: {
      sidebar: blocks('sidebar-nav'),
      main: blocks('version-notice', 'breadcrumbs', 'page-header', 'page-actions', 'api-endpoint', 'content', 'pagination'),
    },
  },
}

export interface LayoutIssue {
  /** Path into the config document, for pointing at the offending YAML. */
  path: (string | number)[]
  message: string
}

/**
 * Merge user layouts over the built-ins and flatten every `extends` chain.
 *
 * A user layout that shares a built-in's name edits that built-in: its regions
 * replace the built-in's region by region. A layout with a new name starts
 * empty unless it says `extends`.
 */
export function resolveLayouts(
  userLayouts: Record<string, LayoutDefinition>,
  customBlocks: Iterable<string> = [],
): { layouts: Record<string, ResolvedLayout>; issues: LayoutIssue[] } {
  const issues: LayoutIssue[] = []
  const knownBlocks = new Set<string>([...BUILTIN_BLOCKS, ...customBlocks])
  const definitions: Record<string, LayoutDefinition> = { ...BUILTIN_LAYOUT_DEFINITIONS }

  for (const [name, user] of Object.entries(userLayouts)) {
    const builtin = BUILTIN_LAYOUT_DEFINITIONS[name]
    definitions[name] =
      builtin && user.extends === undefined
        ? {
            extends: builtin.extends,
            width: user.width ?? builtin.width,
            split: user.split ?? builtin.split,
            regions: { ...builtin.regions, ...user.regions },
          }
        : user

    for (const region of REGIONS) {
      user.regions[region]?.forEach((blockRef, index) => {
        if (!knownBlocks.has(blockRef.block)) {
          issues.push({
            path: ['layouts', name, 'regions', region, index],
            message: `Unknown block "${blockRef.block}". Available blocks: ${[...knownBlocks].sort().join(', ')}`,
          })
        }
      })
    }
  }

  const resolved: Record<string, ResolvedLayout> = {}

  const resolve = (name: string, chain: string[]): ResolvedLayout | undefined => {
    const done = resolved[name]
    if (done) return done
    const definition = definitions[name]
    if (!definition) return undefined

    let parent: ResolvedLayout | undefined
    if (definition.extends !== undefined) {
      if (chain.includes(definition.extends) || definition.extends === name) {
        issues.push({
          path: ['layouts', name, 'extends'],
          message: `Layouts extend each other in a loop: ${[...chain, name, definition.extends].join(' → ')}`,
        })
        return undefined
      }
      parent = resolve(definition.extends, [...chain, name])
      if (!parent && !issues.some((issue) => issue.path[1] === name && issue.path[2] === 'extends')) {
        issues.push({
          path: ['layouts', name, 'extends'],
          message: definitions[definition.extends]
            ? `Layout "${definition.extends}" could not be resolved`
            : `Layout "${definition.extends}" does not exist. Available layouts: ${Object.keys(definitions).sort().join(', ')}`,
        })
        return undefined
      }
    }

    const width: LayoutWidth = definition.width ?? parent?.width ?? 'content'
    const split = definition.split ?? parent?.split ?? false
    const layout: ResolvedLayout = { name, width, split, regions: { ...parent?.regions, ...definition.regions } }
    resolved[name] = layout
    return layout
  }

  for (const name of Object.keys(definitions)) resolve(name, [])
  return { layouts: resolved, issues }
}

/* ───────────────────────── per-page resolution ───────────────────────── */

export interface ActiveLayout {
  name: string
  width: LayoutWidth
  /** Only regions that have at least one block left after page overrides. */
  regions: Partial<Record<RegionName, BlockRef[]>>
  /** Table of contents entries within the page's depth range. */
  toc: TocEntry[]
}

export function resolveTocOptions(
  defaults: ShabdConfig['defaults'],
  frontmatter: Pick<Frontmatter, 'toc'>,
): TocOptions | null {
  if (frontmatter.toc === false) return null
  return { ...defaults.toc, ...frontmatter.toc }
}

const patterns = new Map<string, RegExp>()

/**
 * Does a path match a pattern such as `/guide/**`? `*` stands for one part
 * of a path and `**` for any number. `/guide/**` takes in `/guide` itself:
 * the page that stands for a folder belongs with what is in it.
 */
export function matchesPath(pattern: string, path: string): boolean {
  let regex = patterns.get(pattern)
  if (!regex) {
    const trimmed = pattern.length > 1 ? pattern.replace(/\/+$/, '') : pattern
    const escape = (text: string) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    const source = trimmed
      .split('**')
      .map((part) => part.split('*').map(escape).join('[^/]*'))
      .join('.*')
    // `/guide/.*` as written would leave `/guide` out.
    regex = new RegExp(`^${source.endsWith('/.*') ? `${source.slice(0, -3)}(?:/.*)?` : source}$`)
    patterns.set(pattern, regex)
  }
  return regex.test(path)
}

/** Is a block that has a `when:` shown on this page? */
export function meetsCondition(when: BlockRef['when'], path: string, frontmatter: Record<string, unknown>): boolean {
  if (!when) return true
  if (when.path) {
    const wanted = when.path.filter((pattern) => !pattern.startsWith('!'))
    const unwanted = when.path.filter((pattern) => pattern.startsWith('!')).map((pattern) => pattern.slice(1))
    if (wanted.length > 0 && !wanted.some((pattern) => matchesPath(pattern, path))) return false
    if (unwanted.some((pattern) => matchesPath(pattern, path))) return false
  }
  for (const [key, value] of Object.entries(when.frontmatter ?? {})) {
    // A list or a map in YAML is compared by what it holds.
    if (JSON.stringify(frontmatter[key]) !== JSON.stringify(value)) return false
  }
  return true
}

/**
 * Decide what a page renders: pick the layout named in frontmatter, then
 * apply the page's own switches (`sidebar: false`, `toc: false`, …) and the
 * conditions blocks were given (`when:`).
 *
 * Pure and synchronous: the same function runs during prerendering and on
 * every client navigation, so server and client markup cannot disagree.
 */
export function resolvePageLayout(
  site: Pick<SiteData, 'layouts' | 'defaults'> & Partial<Pick<SiteData, 'site' | 'features' | 'palettes' | 'editions' | 'siteIn'>>,
  frontmatter: Pick<Frontmatter, 'layout' | 'sidebar' | 'toc' | 'pagination'> & Partial<Pick<Frontmatter, 'api'>> & Record<string, unknown>,
  toc: TocEntry[],
  /** The page's route, for blocks that are shown on some paths only. */
  path = '/',
): ActiveLayout {
  const layout =
    site.layouts[frontmatter.layout ?? site.defaults.layout] ??
    site.layouts[site.defaults.layout] ??
    site.layouts.doc ??
    ({ name: 'doc', width: 'content', split: false, regions: {} } satisfies ResolvedLayout)

  const tocOptions = resolveTocOptions(site.defaults, frontmatter)
  const visibleToc = tocOptions
    ? toc.filter((entry) => entry.depth >= tocOptions.minDepth && entry.depth <= tocOptions.maxDepth)
    : []

  // Blocks with nothing to show are left out here rather than rendering
  // nothing, so that a region whose blocks are all empty (a footer on a site
  // with no footer text) is not drawn as an empty landmark.
  const hidden = new Set<string>()
  if (visibleToc.length === 0) hidden.add('toc')
  if ((frontmatter.pagination ?? site.defaults.pagination) === false) hidden.add('pagination')
  if (frontmatter.api === undefined) hidden.add('api-endpoint')
  if (site.site) {
    // A language can have a footer and links of its own (`languages[].footer`, `.nav`).
    const said = site.siteIn?.[placeOf(path, site.editions ?? {}).language?.lang ?? '']
    if (!(said?.footer ?? site.site.footer)) hidden.add('footer')
    if ((said?.nav ?? site.site.nav).length === 0) hidden.add('nav')
    if (site.site.social.length === 0) hidden.add('social')
  }
  if (site.features && !site.features.search.enabled) hidden.add('search')
  // The actions lead to the page's Markdown copy, which is written with llms.txt.
  if (site.features && !site.features.llms.enabled) hidden.add('page-actions')
  if (!site.palettes?.length) hidden.add('theme-menu')
  // A menu of versions or of languages is for a site with more than one, and the notice for a page of an older version.
  const versions = site.editions?.versions ?? []
  if (versions.length < 2) hidden.add('version-menu')
  if ((site.editions?.languages?.length ?? 0) < 2) hidden.add('language-menu')
  if (versions.length < 2 || (placeOf(path, site.editions ?? {}).version?.prefix ?? '') === '') hidden.add('version-notice')

  const regions: ActiveLayout['regions'] = {}
  for (const region of REGIONS) {
    if (region === 'sidebar' && frontmatter.sidebar.visible === false) continue
    const kept = layout.regions[region]?.filter(
      (blockRef) => !hidden.has(blockRef.block) && meetsCondition(blockRef.when, path, frontmatter),
    )
    if (kept?.length) regions[region] = kept
  }

  return { name: layout.name, width: layout.width, regions, toc: visibleToc }
}
