/**
 * Data structures that cross the Node → browser boundary.
 * Everything here is plain JSON so it can be serialized into a virtual module.
 */
import type { Editions } from './editions.js'
import type { RegionName } from './blocks.js'
import type { Badge, BlockRef, Frontmatter, NavItem, ShabdConfig } from './schema.js'

/* ──────────────── sidebar (resolved from sidebar.yaml + content) ──────── */

export interface SidebarGroup {
  type: 'group'
  /** `category` = top-level section heading, `folder` = collapsible group. */
  kind: 'category' | 'folder'
  label: string
  collapsed: boolean
  badge?: Badge
  items: SidebarNode[]
  /** True when the group was generated from a content directory. */
  auto?: true
}

export interface SidebarPage {
  type: 'page'
  label: string
  /** Route path, e.g. `/guide/install`. */
  path: string
  badge?: Badge
}

export interface SidebarLink {
  type: 'link'
  label: string
  href: string
  external: boolean
  badge?: Badge
}

export type SidebarNode = SidebarGroup | SidebarPage | SidebarLink

/* ───────────────────────────────── pages ──────────────────────────────── */

export interface TocEntry {
  depth: number
  id: string
  text: string
}

/** The subset of a page every other page needs to know (navigation, search, pagination). */
export interface PageMeta {
  /** Content-relative file path, e.g. `guide/install.mdx`. */
  id: string
  /** Route path, e.g. `/guide/install`. */
  path: string
  title: string
  description: string
  /** The page was made by Shabd, from an OpenAPI description: there is no file of it to edit. */
  generated?: true
}

/** A section of a page, as indexed for search and served to AI agents. */
export interface PageSection {
  /** Heading anchor; empty for text before the first heading. */
  anchor: string
  heading: string
  depth: number
  text: string
}

/* ──────────────────────────────── layouts ─────────────────────────────── */

export type LayoutWidth = 'content' | 'wide' | 'full'

/** A layout with its `extends` chain already flattened. */
export interface ResolvedLayout {
  name: string
  width: LayoutWidth
  /** Pages of this layout are compiled with their code beside their prose. */
  split: boolean
  regions: Partial<Record<RegionName, BlockRef[]>>
}

/* ─────────────────────────── site data (client) ───────────────────────── */

/** One entry in the reader's theme menu. */
export interface PaletteChoice {
  /** A preset name. */
  name: string
  label: string
  /** Page, accent and highlight colour, for the swatch beside the label. */
  swatch: Record<'light' | 'dark', [string, string, string]>
  /** True when the preset changes more than colours: fonts, corners, how code is framed. */
  look: boolean
  /** Which syntax theme code takes under this preset, in the light and in the dark mode (`data-code`). */
  code: [light: string, dark: string]
}

export interface SiteData {
  /** `site:` from the config, without what only the HTML document needs. */
  site: Omit<ShabdConfig['site'], 'head'>
  colorMode: ShabdConfig['theme']['colorMode']
  /** The site's own palette first. Empty when `theme.picker` is off. */
  palettes: PaletteChoice[]
  defaults: ShabdConfig['defaults']
  features: ShabdConfig['features']
  layouts: Record<string, ResolvedLayout>
  /** The sidebar. On a site with several, the one for pages that are in none of `sidebars`. */
  sidebar: SidebarNode[]
  /**
   * Parts of the site that have a sidebar of their own, longest path first,
   * so that the first one a page is under is its own. Left out on a site
   * with one sidebar.
   */
  sidebars?: { prefix: string; sidebar: SidebarNode[] }[]
  /**
   * Every page by its route, while the dev server runs: the Studio and the hot updates find a page by
   * its file. A build leaves it out. At thousands of pages it was half of the first script every reader
   * is sent, and a reader's page needs none of it: a page brings its own title and description
   * (`usePage()`), and the sidebar has the pages in their order.
   */
  pagesInDev?: Record<string, PageMeta>
  /** The languages and the versions of the site, on a site that has more than one of either. */
  editions?: Editions
  /** The words of the site's own furniture in each language that gives some, by the language's code. */
  ui?: Record<string, Record<string, string>>
  /** What the site says of itself in each language that says it in its own way, by the language's code. */
  siteIn?: Record<string, SiteInLanguage>
  /** Content directory relative to the site root, used to build edit links. */
  contentDir: string
  /** Present in dev only, so token edits hot-swap without a reload. */
  themeCss?: string
}

/** A language's own header links and footer. What it leaves out is the site's own (`site.nav`, `site.footer`). */
export interface SiteInLanguage {
  nav?: NavItem[]
  footer?: string
}

/** The day a page was last changed. */
export interface PageUpdated {
  /** As a machine reads it: `2026-11-17`. */
  day: string
  /**
   * As a reader of the site's language reads it: "17 November 2026". It is
   * written out when the page is compiled, so that the server and every
   * browser show the same words.
   */
  text: string
}

/** What a compiled .md/.mdx module exports besides its default component. */
export interface PageExports {
  /** What the site knows of the page: its file, its address, its title and its description. */
  meta: PageMeta
  frontmatter: Frontmatter
  toc: TocEntry[]
  /** The colours of the page's code tokens, as a stylesheet. */
  codeCss: string
  /** Left out when the site does not show the day, or has none for this page. */
  updated?: PageUpdated
}

/** What the prerender bundle returns for one route. */
export interface RenderedPage {
  html: string
  /** False when the route matched no page (the not-found page was rendered). */
  found: boolean
  title: string
  description: string
}
