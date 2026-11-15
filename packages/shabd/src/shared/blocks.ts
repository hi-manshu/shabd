/**
 * The vocabulary of the YAML layout engine.
 *
 * A layout is a set of *regions*; a region is an ordered list of *blocks*.
 * These names are shared by the config validator (Node) and the block
 * registry (browser) so a typo in YAML fails at load time, not at render time.
 */

export const REGIONS = ['banner', 'header', 'sidebar', 'main', 'aside', 'footer'] as const
export type RegionName = (typeof REGIONS)[number]

export const BUILTIN_BLOCKS = [
  // header
  'menu-toggle',
  'site-title',
  'nav',
  'spacer',
  'search',
  'social',
  'theme-toggle',
  'studio-toggle',
  // sidebar
  'sidebar-nav',
  // main
  'breadcrumbs',
  'page-header',
  'api-endpoint',
  'hero',
  'content',
  'page-footer',
  'pagination',
  // aside
  'toc',
  // footer
  'footer',
] as const
export type BuiltinBlockName = (typeof BUILTIN_BLOCKS)[number]

/** Names of the layouts that ship with Shabd. Users may override or extend them in YAML. */
export const BUILTIN_LAYOUTS = ['base', 'doc', 'splash', 'api'] as const
export type BuiltinLayoutName = (typeof BUILTIN_LAYOUTS)[number]
