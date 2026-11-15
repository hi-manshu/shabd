/**
 * Data structures that cross the Node → browser boundary.
 * Everything here is plain JSON so it can be serialized into a virtual module.
 */
import type { RegionName } from './blocks.js'
import type { Badge, BlockRef, Frontmatter, ShabdConfig } from './schema.js'

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
  regions: Partial<Record<RegionName, BlockRef[]>>
}

/* ─────────────────────────── site data (client) ───────────────────────── */

export interface SiteData {
  site: ShabdConfig['site']
  colorMode: ShabdConfig['theme']['colorMode']
  defaults: ShabdConfig['defaults']
  features: ShabdConfig['features']
  layouts: Record<string, ResolvedLayout>
  sidebar: SidebarNode[]
  /** Keyed by route path. */
  pages: Record<string, PageMeta>
  /** Content directory relative to the site root, used to build edit links. */
  contentDir: string
  /** Present in dev only, so token edits hot-swap without a reload. */
  themeCss?: string
}

/** What a compiled .md/.mdx module exports besides its default component. */
export interface PageExports {
  frontmatter: Frontmatter
  toc: TocEntry[]
}

/** What the prerender bundle returns for one route. */
export interface RenderedPage {
  html: string
  /** False when the route matched no page (the not-found page was rendered). */
  found: boolean
  title: string
  description: string
}
