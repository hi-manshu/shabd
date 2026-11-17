/**
 * The layout engine's data model.
 *
 * Built-in layouts are plain data in the same shape users write in YAML, so
 * "doc", "splash" and "api" are not special cases in any component: they are
 * three entries in a table that `shabd.config.yaml` can edit or add to.
 */
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
      main: blocks('breadcrumbs', 'page-header', 'content', 'page-footer', 'pagination'),
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
    regions: {
      sidebar: blocks('sidebar-nav'),
      main: blocks('breadcrumbs', 'page-header', 'api-endpoint', 'content', 'pagination'),
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
        ? { extends: builtin.extends, width: user.width ?? builtin.width, regions: { ...builtin.regions, ...user.regions } }
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
    const layout: ResolvedLayout = { name, width, regions: { ...parent?.regions, ...definition.regions } }
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

/**
 * Decide what a page renders: pick the layout named in frontmatter, then
 * apply the page's own switches (`sidebar: false`, `toc: false`, …).
 *
 * Pure and synchronous: the same function runs during prerendering and on
 * every client navigation, so server and client markup cannot disagree.
 */
export function resolvePageLayout(
  site: Pick<SiteData, 'layouts' | 'defaults'> & Partial<Pick<SiteData, 'site' | 'features' | 'palettes'>>,
  frontmatter: Pick<Frontmatter, 'layout' | 'sidebar' | 'toc' | 'pagination'> & Partial<Pick<Frontmatter, 'api'>>,
  toc: TocEntry[],
): ActiveLayout {
  const layout =
    site.layouts[frontmatter.layout ?? site.defaults.layout] ??
    site.layouts[site.defaults.layout] ??
    site.layouts.doc ??
    ({ name: 'doc', width: 'content', regions: {} } satisfies ResolvedLayout)

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
    if (!site.site.footer) hidden.add('footer')
    if (site.site.nav.length === 0) hidden.add('nav')
    if (site.site.social.length === 0) hidden.add('social')
  }
  if (site.features && !site.features.search.enabled) hidden.add('search')
  if (!site.palettes?.length) hidden.add('theme-menu')

  const regions: ActiveLayout['regions'] = {}
  for (const region of REGIONS) {
    if (region === 'sidebar' && frontmatter.sidebar.visible === false) continue
    const kept = layout.regions[region]?.filter((blockRef) => !hidden.has(blockRef.block))
    if (kept?.length) regions[region] = kept
  }

  return { name: layout.name, width: layout.width, regions, toc: visibleToc }
}
