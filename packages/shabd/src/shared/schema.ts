/**
 * Zod schemas for every YAML surface in Shabd:
 *
 *   shabd.config.yaml  → ConfigSchema
 *   sidebar.yaml       → SidebarSchema
 *   page frontmatter   → FrontmatterSchema
 *
 * The schemas are the single source of truth. TypeScript types are inferred
 * from them, and JSON Schemas for editor autocompletion are generated from
 * them (see scripts/gen-schemas.mjs).
 *
 * Conventions:
 *   - Config objects are strict: an unknown key is an error, not a silent no-op.
 *   - Every shorthand (`search: true`, `badge: New`, `toc: 3`) is normalized
 *     to one canonical shape here, so the rest of the codebase handles one form.
 */
import { z } from 'zod'
import { BADGE_VARIANTS, normalizeBadge, type Badge, type BadgeVariant } from './badge.js'
import { REGIONS } from './blocks.js'

export { BADGE_VARIANTS, normalizeBadge, type Badge, type BadgeVariant }

/* ────────────────────────────── primitives ────────────────────────────── */

export const BadgeInputSchema = z.union([
  z.string().min(1),
  z.strictObject({
    text: z.string().min(1),
    variant: z.enum(BADGE_VARIANTS).optional(),
  }),
])
export type BadgeInput = z.input<typeof BadgeInputSchema>

export const BadgeSchema = BadgeInputSchema.transform(normalizeBadge)

/**
 * Token values are written into a stylesheet, so they must not be able to
 * close a declaration or a rule. This is validation of shape, not of CSS.
 */
const cssValue = (what: string) =>
  z
    .string()
    .min(1)
    .regex(/^[^;{}<>]+$/, { error: `${what} must be a single CSS value (no ";", "{" or "}")` })

const color = cssValue('A colour')

/** `accent: "#2b36a8"` or `accent: { light: "#2b36a8", dark: "#b3bbff" }`. */
const modeColor = z
  .union([color, z.strictObject({ light: color, dark: color })])
  .transform((c) => (typeof c === 'string' ? { light: c, dark: c } : c))

export interface ModeColor {
  light: string
  dark: string
}

/** A page path such as `/guide/install`, or an absolute URL. */
const linkTarget = z.string().min(1)

/* ───────────────────────────────── site ───────────────────────────────── */

const LogoSchema = z
  .union([
    z.string().min(1),
    z.strictObject({
      src: z.string().min(1).optional(),
      light: z.string().min(1).optional(),
      dark: z.string().min(1).optional(),
      alt: z.string().optional(),
    }),
  ])
  .transform((logo, ctx) => {
    if (typeof logo === 'string') return { light: logo, dark: logo, alt: '' }
    const light = logo.light ?? logo.src ?? logo.dark
    const dark = logo.dark ?? logo.src ?? logo.light
    if (!light || !dark) {
      ctx.issues.push({ code: 'custom', message: 'A logo needs `src`, or `light` and `dark`', input: logo })
      return z.NEVER
    }
    return { light, dark, alt: logo.alt ?? '' }
  })

const RepoSchema = z
  .union([
    z.url(),
    z.strictObject({
      url: z.url(),
      /** Branch used for "Edit this page" links. */
      branch: z.string().min(1).default('main'),
      /** Path from the repository root to the site root, e.g. `docs`. */
      dir: z.string().default(''),
    }),
  ])
  .transform((repo) => (typeof repo === 'string' ? { url: repo, branch: 'main', dir: '' } : repo))

const SocialLinkSchema = z.strictObject({
  icon: z.string().min(1),
  href: z.url(),
  label: z.string().optional(),
})

/** `social: { github: https://… }` or a list of `{ icon, href, label }`. */
const SocialSchema = z
  .union([z.array(SocialLinkSchema), z.record(z.string(), z.url())])
  .transform((social) =>
    Array.isArray(social)
      ? social.map((s) => ({ icon: s.icon, href: s.href, label: s.label ?? s.icon }))
      : Object.entries(social).map(([icon, href]) => ({ icon, href, label: icon })),
  )

const NavItemSchema = z.strictObject({
  label: z.string().min(1),
  link: linkTarget,
  badge: BadgeSchema.optional(),
})

const SiteSchema = z.strictObject({
  title: z.string().min(1),
  description: z.string().default(''),
  /** Canonical origin, e.g. `https://docs.example.com`. Used by llms.txt and the MCP server. */
  url: z.url().optional(),
  /** Sub-path the site is served from. */
  base: z
    .string()
    .default('/')
    .transform((b) => `/${b.replace(/^\/+|\/+$/g, '')}/`.replace(/\/{2,}/g, '/')),
  lang: z.string().min(2).default('en'),
  logo: LogoSchema.optional(),
  favicon: z.string().optional(),
  repo: RepoSchema.optional(),
  social: SocialSchema.default([]),
  /** Links shown in the header. */
  nav: z.array(NavItemSchema).default([]),
  footer: z.string().optional(),
})

/* ──────────────────────────────── theme ───────────────────────────────── */

export const COLOR_MODES = ['system', 'light', 'dark'] as const

const ColorsSchema = z.strictObject({
  /** Links and interactive text. */
  accent: modeColor.default({ light: '#2b36a8', dark: '#b3bbff' }),
  /** Marks: the active page, text selection, the headline bar. */
  highlight: modeColor.default({ light: '#f6b40e', dark: '#ffc53d' }),
  background: modeColor.default({ light: '#ffffff', dark: '#13142c' }),
  surface: modeColor.default({ light: '#f3f4fa', dark: '#1c1e3d' }),
  text: modeColor.default({ light: '#1b1c3a', dark: '#e8e9f5' }),
  muted: modeColor.default({ light: '#5a5d7c', dark: '#a3a6c6' }),
  border: modeColor.default({ light: '#d9dbea', dark: '#2f3260' }),
  note: modeColor.default({ light: '#2563a8', dark: '#8fbdf5' }),
  tip: modeColor.default({ light: '#0c7a66', dark: '#6fd6bf' }),
  success: modeColor.default({ light: '#1a7a3c', dark: '#7ddc9c' }),
  caution: modeColor.default({ light: '#a8540a', dark: '#f5b267' }),
  danger: modeColor.default({ light: '#b8243a', dark: '#ff98a6' }),
})

const TypographySchema = z.strictObject({
  /** Font stack for prose and UI. */
  sans: cssValue('A font stack').default('"Anek Latin Variable", ui-sans-serif, system-ui, sans-serif'),
  /** Font stack for code. */
  mono: cssValue('A font stack').default('"Red Hat Mono Variable", ui-monospace, "SF Mono", Menlo, monospace'),
  /** Root font size. */
  baseSize: cssValue('A size').default('16px'),
  /** Modular scale ratio. Heading sizes are baseSize × scale^n. */
  scale: z.number().min(1).max(2).default(1.2),
  lineHeight: z.number().min(1).max(3).default(1.65),
})

const LayoutTokensSchema = z.strictObject({
  contentWidth: cssValue('A width').default('46rem'),
  sidebarWidth: cssValue('A width').default('17rem'),
  tocWidth: cssValue('A width').default('14rem'),
  headerHeight: cssValue('A height').default('3.75rem'),
})

const CodeThemeSchema = z.strictObject({
  /** Shiki theme names. */
  light: z.string().min(1).default('github-light'),
  dark: z.string().min(1).default('tokyo-night'),
})

const ThemeSchema = z.strictObject({
  colorMode: z
    .strictObject({
      /** Mode used on a visitor's first visit. */
      default: z.enum(COLOR_MODES).default('system'),
      /** Show the light/dark switch. */
      toggle: z.boolean().default(true),
    })
    .prefault({}),
  colors: ColorsSchema.prefault({}),
  typography: TypographySchema.prefault({}),
  layout: LayoutTokensSchema.prefault({}),
  radius: cssValue('A radius').default('8px'),
  code: CodeThemeSchema.prefault({}),
  /** Your own stylesheets, loaded after the theme. One path or a list. */
  css: z
    .union([z.string().min(1), z.array(z.string().min(1))])
    .default([])
    .transform((css) => (typeof css === 'string' ? [css] : css)),
})

/* ─────────────────────────────── layouts ──────────────────────────────── */

export interface BlockRef {
  block: string
  props: Record<string, unknown>
}

/** `- toc` or `- { block: toc, props: { title: Contents } }`. */
const BlockRefSchema = z
  .union([
    z.string().min(1),
    z.strictObject({
      block: z.string().min(1),
      props: z.record(z.string(), z.unknown()).default({}),
    }),
  ])
  .transform((ref): BlockRef => (typeof ref === 'string' ? { block: ref, props: {} } : ref))

export const LAYOUT_WIDTHS = ['content', 'wide', 'full'] as const

const LayoutSchema = z.strictObject({
  /** Start from another layout and replace only the regions listed here. */
  extends: z.string().min(1).optional(),
  /** Width of the main column. */
  width: z.enum(LAYOUT_WIDTHS).optional(),
  regions: z.partialRecord(z.enum(REGIONS), z.array(BlockRefSchema)).default({}),
})
export type LayoutDefinition = z.output<typeof LayoutSchema>

/* ───────────────────────── page options & defaults ────────────────────── */

const headingDepth = z.int().min(1).max(6)

export interface TocOptions {
  minDepth: number
  maxDepth: number
}

/** `toc: false`, `toc: 3` (deepest heading level), or `{ minDepth, maxDepth }`. */
const TocInputSchema = z.union([
  z.boolean(),
  headingDepth,
  z.strictObject({ minDepth: headingDepth.optional(), maxDepth: headingDepth.optional() }),
])

function normalizeToc(toc: z.output<typeof TocInputSchema> | undefined): false | Partial<TocOptions> | undefined {
  if (toc === undefined || toc === true) return undefined
  if (toc === false) return false
  if (typeof toc === 'number') return { maxDepth: toc }
  return toc
}

const DefaultsSchema = z.strictObject({
  /** Layout used when a page does not name one. */
  layout: z.string().min(1).default('doc'),
  toc: z
    .strictObject({ minDepth: headingDepth.default(2), maxDepth: headingDepth.default(3) })
    .prefault({})
    .refine((t) => t.minDepth <= t.maxDepth, { error: 'toc.minDepth must not be greater than toc.maxDepth' }),
  editLink: z.boolean().default(true),
  pagination: z.boolean().default(true),
})

/* ─────────────────────────────── features ─────────────────────────────── */

/** Accept `feature: true|false` as shorthand for `feature: { enabled: … }`. */
function feature<T extends z.ZodType<{ enabled: boolean }, { enabled?: boolean | undefined }>>(
  options: T,
  enabledByDefault: boolean,
) {
  return z
    .union([z.boolean(), options])
    .default(enabledByDefault)
    .transform((value): z.output<T> => (typeof value === 'boolean' ? options.parse({ enabled: value }) : value))
}

const SearchFeatureSchema = z.strictObject({
  enabled: z.boolean().default(true),
  /** On-device semantic ("AI") search. Needs `@huggingface/transformers` installed. */
  semantic: z.boolean().default(true),
  /** Embedding model, loaded by Transformers.js at build time and in the visitor's browser. */
  model: z.string().min(1).default('Xenova/all-MiniLM-L6-v2'),
  maxResults: z.int().min(1).max(50).default(8),
  /** How similar a section must be to a query to count as a semantic match. Depends on the model. */
  minSimilarity: z.number().min(0).max(1).default(0.35),
  /**
   * How the index is held in the reader's browser. `memory` loads it as JSON.
   * `sqlite` ships it as a SQLite database, searched with FTS5 and kept in the
   * browser's private file system. Needs `@sqlite.org/sqlite-wasm` installed.
   */
  store: z.enum(['memory', 'sqlite']).default('memory'),
})

const McpFeatureSchema = z.strictObject({
  enabled: z.boolean().default(true),
  route: z
    .string()
    .regex(/^\/[\w\-/]*$/, { error: 'route must be an absolute path such as /mcp' })
    .default('/mcp'),
})

const LlmsFeatureSchema = z.strictObject({
  enabled: z.boolean().default(true),
  /** Also write llms-full.txt (every page in one file). */
  full: z.boolean().default(true),
})

const StudioFeatureSchema = z.strictObject({
  enabled: z.boolean().default(true),
  /** Share unsaved drafts with other tabs, or with invited peers over WebRTC. */
  sync: z.enum(['off', 'tabs', 'peers']).default('tabs'),
})

const SandboxFeatureSchema = z.strictObject({
  enabled: z.boolean().default(true),
})

const FeaturesSchema = z.strictObject({
  search: feature(SearchFeatureSchema, true),
  mcp: feature(McpFeatureSchema, true),
  llms: feature(LlmsFeatureSchema, true),
  studio: feature(StudioFeatureSchema, true),
  sandbox: feature(SandboxFeatureSchema, true),
})

/* ──────────────────────────────── content ─────────────────────────────── */

const ContentSchema = z.strictObject({
  /** Folder of .md / .mdx files, relative to the site root. */
  dir: z.string().min(1).default('content'),
  /** Sidebar definition, relative to the site root. */
  sidebar: z.string().min(1).default('sidebar.yaml'),
})

/* ───────────────────────────── shabd.config.yaml ───────────────────────── */

const componentName = z
  .string()
  .regex(/^[A-Z][A-Za-z0-9]*$/, { error: 'Component names must be PascalCase, e.g. Counter' })
const blockName = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/, { error: 'Block names must be kebab-case, e.g. announcement-bar' })

export const ConfigSchema = z.strictObject({
  site: SiteSchema,
  content: ContentSchema.prefault({}),
  theme: ThemeSchema.prefault({}),
  defaults: DefaultsSchema.prefault({}),
  /** Override a built-in layout, or define a new one for `layout:` frontmatter. */
  layouts: z.record(z.string().min(1), LayoutSchema).default({}),
  features: FeaturesSchema.prefault({}),
  /** Components available in every .mdx file without an import. Name → file path. */
  components: z.record(componentName, z.string().min(1)).default({}),
  /** Custom layout blocks. Name → file path. */
  blocks: z.record(blockName, z.string().min(1)).default({}),
})

export type ShabdConfigInput = z.input<typeof ConfigSchema>
export type ShabdConfig = z.output<typeof ConfigSchema>
export type ThemeConfig = ShabdConfig['theme']
export type FeaturesConfig = ShabdConfig['features']

/* ─────────────────────────────── sidebar.yaml ─────────────────────────── */

/**
 * Four kinds of entry, told apart by their key:
 *
 *   - guide/install                     a file (label comes from the page title)
 *   - file: guide/install               a file, with overrides
 *   - link: https://…                   an external or absolute link
 *   - folder: Writing                   a collapsible group
 *   - category: Guide                   a top-level section heading
 *
 * A folder or category lists `items`, or names a content directory to
 * `autogenerate` from.
 */
export type SidebarAutogenerate = string | { directory: string; collapsed?: boolean | undefined }

export interface SidebarFileInput {
  file: string
  label?: string | undefined
  badge?: BadgeInput | undefined
}
export interface SidebarLinkInput {
  link: string
  label: string
  badge?: BadgeInput | undefined
}
export interface SidebarFolderInput {
  folder: string
  collapsed?: boolean | undefined
  badge?: BadgeInput | undefined
  items?: SidebarItemInput[] | undefined
  autogenerate?: SidebarAutogenerate | undefined
}
export interface SidebarCategoryInput {
  category: string
  badge?: BadgeInput | undefined
  items?: SidebarItemInput[] | undefined
  autogenerate?: SidebarAutogenerate | undefined
}
export type SidebarItemInput = string | SidebarFileInput | SidebarLinkInput | SidebarFolderInput
export type SidebarEntryInput = SidebarItemInput | SidebarCategoryInput

const AutogenerateSchema = z.union([
  z.string().min(1),
  z.strictObject({ directory: z.string().min(1), collapsed: z.boolean().optional() }),
])

const itemsOrAutogenerate = {
  error: 'Give either `items` or `autogenerate`, not both and not neither',
}
const hasExactlyOneSource = (g: { items?: unknown; autogenerate?: unknown }) =>
  (g.items === undefined) !== (g.autogenerate === undefined)

const SidebarFileSchema = z.strictObject({
  file: z.string().min(1),
  label: z.string().min(1).optional(),
  badge: BadgeInputSchema.optional(),
})

const SidebarLinkSchema = z.strictObject({
  link: linkTarget,
  label: z.string().min(1),
  badge: BadgeInputSchema.optional(),
})

const SidebarItemSchema: z.ZodType<SidebarItemInput> = z.lazy(() =>
  z.union([z.string().min(1), SidebarFileSchema, SidebarLinkSchema, SidebarFolderSchema]),
)

const SidebarFolderSchema: z.ZodType<SidebarFolderInput> = z
  .strictObject({
    folder: z.string().min(1),
    collapsed: z.boolean().optional(),
    badge: BadgeInputSchema.optional(),
    items: z.array(SidebarItemSchema).optional(),
    autogenerate: AutogenerateSchema.optional(),
  })
  .refine(hasExactlyOneSource, itemsOrAutogenerate)

const SidebarCategorySchema: z.ZodType<SidebarCategoryInput> = z
  .strictObject({
    category: z.string().min(1),
    badge: BadgeInputSchema.optional(),
    items: z.array(SidebarItemSchema).optional(),
    autogenerate: AutogenerateSchema.optional(),
  })
  .refine(hasExactlyOneSource, itemsOrAutogenerate)

/** Categories are section headings, so they are only valid at the top level. */
export const SidebarSchema = z.array(
  z.union([z.string().min(1), SidebarFileSchema, SidebarLinkSchema, SidebarFolderSchema, SidebarCategorySchema]),
)
export type SidebarInput = SidebarEntryInput[]

/* ─────────────────────────────── frontmatter ──────────────────────────── */

const HeroSchema = z.strictObject({
  /** Defaults to the page title. */
  title: z.string().min(1).optional(),
  tagline: z.string().optional(),
  image: z.string().optional(),
  actions: z
    .array(
      z.strictObject({
        label: z.string().min(1),
        link: linkTarget,
        variant: z.enum(['primary', 'secondary']).default('primary'),
      }),
    )
    .default([]),
})

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

const ApiSchema = z.strictObject({
  method: z.enum(HTTP_METHODS),
  path: z.string().min(1),
  baseUrl: z.string().optional(),
  auth: z.string().optional(),
  deprecated: z.boolean().default(false),
})

const PageSidebarSchema = z
  .union([
    z.boolean(),
    z.strictObject({
      /** Show the sidebar on this page. */
      visible: z.boolean().optional(),
      /** This page's label in the sidebar. Defaults to the title. */
      label: z.string().min(1).optional(),
      /** Position among siblings in auto-generated groups. Lower comes first. */
      order: z.number().optional(),
      badge: BadgeSchema.optional(),
      /** Leave this page out of auto-generated groups. */
      exclude: z.boolean().optional(),
    }),
  ])
  .optional()
  .transform((s) => (typeof s === 'boolean' ? { visible: s } : (s ?? {})))

/**
 * Frontmatter is loose: authors may add their own keys for custom blocks
 * and components. The keys Shabd understands are validated strictly.
 */
export const FrontmatterSchema = z.looseObject({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  /** `doc`, `splash`, `api`, or a layout defined under `layouts:` in the config. */
  layout: z.string().min(1).optional(),
  sidebar: PageSidebarSchema,
  toc: TocInputSchema.optional().transform(normalizeToc),
  /** Badges shown beside the page title. */
  badges: z.array(BadgeSchema).default([]),
  /** Drafts are visible in dev and left out of production builds. */
  draft: z.boolean().default(false),
  hero: HeroSchema.optional(),
  api: ApiSchema.optional(),
  editLink: z.boolean().optional(),
  pagination: z.boolean().optional(),
})

export type FrontmatterInput = z.input<typeof FrontmatterSchema>
export type Frontmatter = z.output<typeof FrontmatterSchema>
