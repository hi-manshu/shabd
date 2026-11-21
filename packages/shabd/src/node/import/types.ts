/**
 * What the parts of `shabd import` pass to each other.
 *
 * A module per source tool reads that tool's config and says where its pages
 * are (a SourceSite). Pages are then converted one at a time by pure
 * functions: text in, text and notes out (a Conversion).
 */
import type { BadgeInput } from '../../shared/schema.js'
import type { Line } from './text.js'

export const SOURCE_TOOLS = ['docusaurus', 'vitepress', 'starlight', 'mkdocs'] as const
export type SourceTool = (typeof SOURCE_TOOLS)[number]

export const TOOL_NAMES: Record<SourceTool, string> = {
  docusaurus: 'Docusaurus',
  vitepress: 'VitePress',
  starlight: 'Starlight',
  mkdocs: 'MkDocs',
}

/**
 * One thing that happened to a page. `converted` notes are counted in the
 * report; `manual` ones are listed, because the author has to look at them.
 */
export type Note =
  | { kind: 'converted'; what: Converted; line?: number | undefined }
  | { kind: 'manual'; message: string; line?: number | undefined }

/** The kinds of conversion the report counts. */
export type Converted = 'callout' | 'tab group' | 'code fence' | 'frontmatter key' | 'link' | 'component' | 'heading id' | 'comment'

export interface Conversion {
  text: string
  /** The page uses a component, so it has to be written as an .mdx file. */
  mdx: boolean
  notes: Note[]
}

/**
 * The wording of the notes more than one tool writes. The report lists the
 * places a note applies to under its message, so the same case has to be
 * said in the same words everywhere.
 */
export const MESSAGES = {
  component: (name: string) =>
    `\`<${name}>\` is not a component Shabd has. The page does not render until it is replaced, or the component is registered under \`components:\` in shabd.config.yaml.`,
  imported: (from: string) =>
    `An import from ${from}, which the new site cannot resolve. Remove the line, and register the component under \`components:\` if the page still uses it.`,
  headingId: (id: string) => `The heading id \`${id}\` is not kept: Shabd names a heading after its text. Links to #${id} need the new name.`,
  collapsible: 'A block that opens and closes is written as a callout, which is always open.',
  container: (name: string) => `A \`:::${name}\` block has no counterpart in Shabd, and is left as it is.`,
  slug: (slug: string) => `The page sets its own address (\`${slug}\`). In Shabd the address is the path of the file.`,
} as const

/** Rewrites the links of a page, given its lines before anything else has changed them. */
export type Relink = (lines: Line[], notes: Note[]) => Line[]

/** A note with the file it is about, relative to the folder named in the report. */
export interface FileNote {
  file: string
  line?: number | undefined
  message: string
}

/** Navigation as a source tool describes it, before it is written as sidebar.yaml. */
export type NavItem =
  | { type: 'page'; id: string; label?: string | undefined; badge?: BadgeInput | undefined }
  | { type: 'link'; href: string; label: string; badge?: BadgeInput | undefined }
  | { type: 'group'; label: string; collapsed?: boolean | undefined; badge?: BadgeInput | undefined; items: NavItem[] }
  | { type: 'generated'; label: string; directory: string; collapsed?: boolean | undefined }

/** `site:` in shabd.config.yaml, as far as an import fills it in. */
export interface SiteInput {
  title: string
  description?: string | undefined
  url?: string | undefined
  base?: string | undefined
  lang?: string | undefined
  logo?: string | { light: string; dark: string } | undefined
  favicon?: string | undefined
  repo?: string | { url: string; branch?: string; dir?: string } | undefined
  social?: Record<string, string> | undefined
  nav?: { label: string; link: string }[] | undefined
  footer?: string | undefined
}

/** A page of the source site and where it goes. */
export interface SourcePage {
  /** Path inside the source's content folder, with forward slashes: `guide/01-install.md`. */
  source: string
  /** Path inside the new `content/` folder, before a change of extension: `guide/install.md`. */
  id: string
  /** The address the source tool gives the page, without slashes at either end: `guide/install`. Empty for the home page. */
  route: string
}

/** How the source tool reads a link, so that it can be pointed at the same page in the new site. */
export interface LinkRules {
  /** A relative link starts from the folder the file is in, or from the page's own address (Starlight). */
  relative: 'file' | 'address'
  /** What an absolute link may carry in front of a page's path: the site's base, Docusaurus's `/docs`. */
  prefixes: string[]
}

/** What a tool's module found out about a site before any page is converted. */
export interface SourceSite {
  tool: SourceTool
  /** The folder of pages, absolute. */
  contentDir: string
  pages: SourcePage[]
  /** Folders whose files the source serves from the root of the site, absolute. They go into `public/`. */
  publicDirs: string[]
  /** Single files for `public/`, such as a logo kept among the pages. `to` is the path it gets there. */
  publicFiles?: { from: string; to: string }[] | undefined
  site: SiteInput
  /** Undefined when the source has no navigation of its own, or it could not be read. */
  nav?: NavItem[] | undefined
  /** In one sentence, where the navigation came from or why it could not be read. */
  navSource: string
  links: LinkRules
  /** Problems with the config and the parts of the site that were not imported. The file is relative to the source. */
  notes: FileNote[]
  /**
   * Where a file of the content folder that is not a page goes in the new
   * one, or undefined for a file that is not content. The same place when
   * left out.
   */
  place?: ((file: string) => string | undefined) | undefined
  /** Convert one page. `links` points the page's links at the pages of the new site. */
  convert(text: string, page: SourcePage, links: Relink): Conversion
}
