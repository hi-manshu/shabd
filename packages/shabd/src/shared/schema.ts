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
import { ADAPTERS } from './adapters.js'
import { BADGE_VARIANTS, normalizeBadge, type Badge, type BadgeVariant } from './badge.js'
import { REGIONS } from './blocks.js'
import { URL_STYLES } from './paths.js'
import {
  CODE_FRAMES,
  COLOR_TOKENS,
  CORNERS,
  DEFAULT_LOOK,
  DEFAULT_PRESET,
  HEADING_CASES,
  OPTIONAL_COLOR_TOKENS,
  PRESET_NAMES,
  THEME_PRESETS,
  type ColorToken,
  type ModeColor,
  type OptionalColorToken,
  type PresetLook,
  type PresetName,
} from './presets.js'

export { BADGE_VARIANTS, normalizeBadge, type Badge, type BadgeVariant }
export { CODE_FRAMES, CORNERS, HEADING_CASES, PRESET_NAMES, type ModeColor, type PresetName }

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

/** A page path such as `/guide/install`, or an absolute URL. */
const linkTarget = z.string().min(1)

/* ───────────────────────────────── site ───────────────────────────────── */

/** The height the header gives a logo that does not ask for one. */
const DEFAULT_LOGO_HEIGHT = '1.75rem'

const LogoSchema = z
  .union([
    z.string().min(1),
    z.strictObject({
      /** One image for both colour modes. */
      src: z.string().min(1).optional(),
      /** The image on a light page, and on a dark one. Give both, or `src`. */
      light: z.string().min(1).optional(),
      dark: z.string().min(1).optional(),
      /** Text for screen readers. Leave it empty when the site title is shown beside the logo. */
      alt: z.string().optional(),
      /** Height of the image in the header. The width follows from the image. */
      height: cssValue('A height').optional(),
      /** Where the logo and title link to. A page path or a URL. */
      href: z.string().min(1).optional(),
      /** Show the logo alone, without the site title beside it. */
      replacesTitle: z.boolean().optional(),
    }),
  ])
  .transform((logo, ctx) => {
    const defaults = { alt: '', height: DEFAULT_LOGO_HEIGHT, href: '/', replacesTitle: false }
    if (typeof logo === 'string') return { light: logo, dark: logo, ...defaults }
    const light = logo.light ?? logo.src ?? logo.dark
    const dark = logo.dark ?? logo.src ?? logo.light
    if (!light || !dark) {
      ctx.issues.push({ code: 'custom', message: 'A logo needs `src`, or `light` and `dark`', input: logo })
      return z.NEVER
    }
    return {
      light,
      dark,
      alt: logo.alt ?? defaults.alt,
      height: logo.height ?? defaults.height,
      href: logo.href ?? defaults.href,
      replacesTitle: logo.replacesTitle ?? defaults.replacesTitle,
    }
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

export const HEAD_TAGS = ['meta', 'link', 'script', 'style', 'noscript'] as const

/** Elements that have no closing tag, and so no content. */
const VOID_HEAD_TAGS: ReadonlySet<string> = new Set(['meta', 'link'])

/**
 * One tag for the `<head>` of every page: an analytics script, a
 * verification tag, a preconnect.
 *
 *   - { tag: meta, attrs: { name: google-site-verification, content: abc123 } }
 *   - { tag: script, attrs: { src: https://example.com/a.js, defer: true } }
 *   - { tag: script, content: "window.plausible = window.plausible || []" }
 */
const HeadTagSchema = z
  .strictObject({
    tag: z.enum(HEAD_TAGS),
    /** `true` writes the attribute with no value, `false` leaves it out. */
    attrs: z
      .record(
        z.string().regex(/^[A-Za-z_:][A-Za-z0-9_:.-]*$/, { error: 'An attribute name is letters, digits, "-", "_", ":" and "."' }),
        z.union([z.string(), z.number(), z.boolean()]),
      )
      .default({}),
    /** What goes between the opening and the closing tag. */
    content: z.string().optional(),
  })
  .check((ctx) => {
    const { tag, content } = ctx.value
    if (content === undefined) return
    if (VOID_HEAD_TAGS.has(tag)) {
      ctx.issues.push({
        code: 'custom',
        path: ['content'],
        message: `<${tag}> has no content. Write its values under \`attrs\``,
        input: content,
      })
    } else if (content.toLowerCase().includes(`</${tag}`)) {
      // The content is written into the page as it is, so it must not be able to end its own tag.
      ctx.issues.push({
        code: 'custom',
        path: ['content'],
        message: `The content of <${tag}> must not contain "</${tag}"`,
        input: content,
      })
    }
  })
export type HeadTag = z.output<typeof HeadTagSchema>

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
  /**
   * How a page's address is written. `clean`: `/guide/install`. `slash`:
   * `/guide/install/`. `html`: `/guide/install.html`, written as a file of
   * that name. Which one suits depends on the host.
   */
  urls: z.enum(URL_STYLES).default('clean'),
  lang: z.string().min(2).default('en'),
  logo: LogoSchema.optional(),
  favicon: z.string().optional(),
  /**
   * The picture other sites show when a page is shared: a path in `public/`
   * or a full address. A page can name its own with `image` in frontmatter.
   */
  image: z.string().min(1).optional(),
  repo: RepoSchema.optional(),
  social: SocialSchema.default([]),
  /** Links shown in the header. */
  nav: z.array(NavItemSchema).default([]),
  footer: z.string().optional(),
  /** Tags added to the `<head>` of every page, after Shabd's own. */
  head: z.array(HeadTagSchema).default([]),
  /**
   * Ask search engines not to list any page of this site: a staging copy, a
   * preview of a pull request. A page can ask for itself with `noindex` in
   * its frontmatter.
   */
  noindex: z.boolean().default(false),
  /**
   * robots.txt. `false` writes none. An object lists paths crawlers should
   * stay out of. Left out, the file is written when the site is served from
   * the root of its host, which is the only place crawlers read it.
   */
  robots: z
    .union([
      z.boolean(),
      z.strictObject({
        disallow: z
          .array(z.string().regex(/^\/\S*$/, { error: 'A path crawlers should stay out of starts with /, such as /drafts/' }))
          .default([]),
      }),
    ])
    .optional(),
})

/* ──────────────────────────────── theme ───────────────────────────────── */

export const COLOR_MODES = ['system', 'light', 'dark'] as const

/**
 * Every colour is optional: `theme.preset` supplies the twelve a page needs,
 * and what is written here is laid over it.
 */
const ColorsSchema = z.strictObject({
  /** Links and interactive text. */
  accent: modeColor.optional(),
  /** Marks: the active page, a highlighted line, the bar on a primary button. */
  highlight: modeColor.optional(),
  background: modeColor.optional(),
  /** Panels that sit on the page: code, cards, the search field. */
  surface: modeColor.optional(),
  text: modeColor.optional(),
  /** Secondary text. */
  muted: modeColor.optional(),
  border: modeColor.optional(),
  note: modeColor.optional(),
  tip: modeColor.optional(),
  success: modeColor.optional(),
  caution: modeColor.optional(),
  danger: modeColor.optional(),

  /** Links in prose. Defaults to `accent`. */
  link: modeColor.optional(),
  /** Page titles and headings. Defaults to `text`. */
  heading: modeColor.optional(),
  /** The headline bars that titles, code blocks and cards hang from. Defaults to `text`. */
  bar: modeColor.optional(),
  /** Background of a primary button. Defaults to `text`. Its label is drawn in `background`. */
  button: modeColor.optional(),
  /** Background of the header. Defaults to `background`. A translucent colour blurs the page behind it. */
  header: modeColor.optional(),
  /**
   * The colour of the title, the links and the buttons in the header, for a
   * header that is darker or lighter than the page. Defaults to `text`.
   */
  headerText: modeColor.optional(),
  /** Background of the sidebar. Defaults to `background`. A translucent colour blurs what is behind it. */
  sidebar: modeColor.optional(),
  /** Background of the content area, the outline beside it and the footer. See-through by default. */
  main: modeColor.optional(),
  /**
   * A picture behind the whole page: any CSS background, such as a gradient.
   * It shows only where a panel's own colour is translucent. None by default.
   */
  backdrop: modeColor.optional(),
  /** Background of code, inline and in blocks. Defaults to `surface`. */
  code: modeColor.optional(),
  /**
   * Colour of code that the syntax theme leaves uncoloured: plain text,
   * punctuation in some themes. Defaults to the syntax theme's own foreground.
   */
  codeText: modeColor.optional(),
  /** Background of selected text. Defaults to a tint of `highlight`. */
  selection: modeColor.optional(),
})

const fontWeight = z.number().int().min(100).max(900)
/** A font's width axis, in percent of normal. Fonts without one ignore it. */
const fontWidth = z.number().min(50).max(200)

/*
 * Settings marked "from the preset" have no default here. The preset may set
 * them (`macos` sets most), and Shabd's own defaults fill in what is left.
 */
const TypographySchema = z.strictObject({
  /** Font stack for prose and UI. From the preset; otherwise Anek Latin, then system fonts. */
  sans: cssValue('A font stack').optional(),
  /** Font stack for code. From the preset; otherwise Red Hat Mono, then system fonts. */
  mono: cssValue('A font stack').optional(),
  /** Font stack for titles and headings. From the preset; otherwise the same as `sans`. */
  heading: cssValue('A font stack').optional(),
  /** `uppercase` sets titles and headings in capitals. From the preset; otherwise `none`. */
  headingCase: z.enum(HEADING_CASES).optional(),
  /** Extra space between the letters of titles and headings, such as `0.04em`. From the preset; otherwise none. */
  headingTracking: cssValue('A length').optional(),
  /** Root font size. */
  baseSize: cssValue('A size').default('16px'),
  /** Modular scale ratio. Heading sizes are baseSize × scale^n. */
  scale: z.number().min(1).max(2).default(1.2),
  lineHeight: z.number().min(1).max(3).default(1.65),
  /** Weight of body text. From the preset; otherwise 400. */
  weight: fontWeight.optional(),
  /**
   * Weight of a second-level heading. Larger headings are a little heavier,
   * smaller ones a little lighter. From the preset; otherwise 700.
   */
  headingWeight: fontWeight.optional(),
  /** Width of headings, in percent. From the preset; otherwise 112. */
  headingWidth: fontWidth.optional(),
  /** Width of the largest titles (the site title, page titles, the hero). From the preset; otherwise 125. */
  displayWidth: fontWidth.optional(),
})

const LayoutTokensSchema = z.strictObject({
  /** Width of the text column on a `doc` page. */
  contentWidth: cssValue('A width').default('46rem'),
  /** Width of the main column on a `splash` page. */
  wideWidth: cssValue('A width').default('68rem'),
  sidebarWidth: cssValue('A width').default('17rem'),
  tocWidth: cssValue('A width').default('14rem'),
  headerHeight: cssValue('A height').default('3.75rem'),
})

const CodeThemeSchema = z.strictObject({
  /** Shiki theme names. Default to the pair that goes with the preset. */
  light: z.string().min(1).optional(),
  dark: z.string().min(1).optional(),
  /**
   * `bar`: a code block hangs from a rule. `window`: it sits in a window, with
   * a title bar and the three window buttons. From the preset; otherwise `bar`.
   */
  frame: z.enum(CODE_FRAMES).optional(),
  /** Wrap long lines in every code block. A block can opt out with `noWrap`. */
  wrap: z.boolean().default(false),
  /** Number the lines of every code block. A block can opt out with `noLineNumbers`. */
  lineNumbers: z.boolean().default(false),
  /**
   * The least contrast a token's colour may have against the code background, as a WCAG ratio.
   * A colour the syntax theme draws fainter than this is made darker or lighter, keeping its hue,
   * until it reaches it. 0 leaves the syntax themes exactly as they are.
   */
  minContrast: z.number().min(0).max(21).default(4.5),
})

const pickOptionalColors = (colors: Partial<Record<OptionalColorToken, ModeColor>>) =>
  Object.fromEntries(
    OPTIONAL_COLOR_TOKENS.flatMap((token) => (colors[token] ? [[token, colors[token]]] : [])),
  ) as Partial<Record<OptionalColorToken, ModeColor>>

const ThemeSchema = z
  .strictObject({
    /** A built-in palette. `colors` and `code` are laid over it. */
    preset: z.enum(PRESET_NAMES).default(DEFAULT_PRESET),
    /**
     * Let readers choose a palette from a menu in the header: `true` for
     * every preset, or a list of preset names. The choice is kept in their
     * browser.
     */
    picker: z.union([z.boolean(), z.array(z.enum(PRESET_NAMES)).min(1)]).default(false),
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
    /** How round corners are. From the preset; otherwise 8px. */
    radius: cssValue('A radius').optional(),
    /**
     * `hang`: flat on top and round underneath, like a letter under its
     * headline. `round`: round all the way. From the preset; otherwise `hang`.
     */
    corners: z.enum(CORNERS).optional(),
    /** Thickness of the rule above a code block, a card or a callout. From the preset; otherwise 2px. */
    rule: cssValue('A thickness').optional(),
    /** Thickness of every other border. From the preset; otherwise 1px. */
    line: cssValue('A thickness').optional(),
    /**
     * A CSS box-shadow for panels and buttons: code blocks, callouts, the
     * search field. From the preset; otherwise none.
     */
    shadow: cssValue('A shadow').optional(),
    /** Draw the heavy bar above page titles and the hero. From the preset; otherwise true. */
    bars: z.boolean().optional(),
    code: CodeThemeSchema.prefault({}),
    /** Your own stylesheets, loaded after the theme. One path or a list. */
    css: z
      .union([z.string().min(1), z.array(z.string().min(1))])
      .default([])
      .transform((css) => (typeof css === 'string' ? [css] : css)),
  })
  .transform((theme) => {
    const preset = THEME_PRESETS[theme.preset]
    // Each setting: the site's own, else the preset's, else Shabd's.
    const look: PresetLook = preset.look ?? {}
    const sans = theme.typography.sans ?? look.sans ?? DEFAULT_LOOK.sans
    const colors = Object.fromEntries(
      COLOR_TOKENS.map((token) => [token, theme.colors[token] ?? preset.colors[token]]),
    ) as Record<ColorToken, ModeColor>
    // The site's own palette is always in the menu, and comes first.
    const offered = theme.picker === true ? PRESET_NAMES : theme.picker === false ? [] : theme.picker
    const picker: PresetName[] = offered.length ? [...new Set<PresetName>([theme.preset, ...offered])] : []
    return {
      ...theme,
      picker,
      colors: { ...colors, ...pickOptionalColors({ ...look.colors, ...pickOptionalColors(theme.colors) }) },
      typography: {
        ...theme.typography,
        sans,
        mono: theme.typography.mono ?? look.mono ?? DEFAULT_LOOK.mono,
        // A site that names its own text font gets it for headings too, not the preset's heading font.
        heading: theme.typography.heading ?? (theme.typography.sans === undefined ? look.heading : undefined) ?? sans,
        headingCase: theme.typography.headingCase ?? look.headingCase ?? DEFAULT_LOOK.headingCase,
        headingTracking: theme.typography.headingTracking ?? look.headingTracking ?? DEFAULT_LOOK.headingTracking,
        weight: theme.typography.weight ?? look.weight ?? DEFAULT_LOOK.weight,
        headingWeight: theme.typography.headingWeight ?? look.headingWeight ?? DEFAULT_LOOK.headingWeight,
        headingWidth: theme.typography.headingWidth ?? look.headingWidth ?? DEFAULT_LOOK.headingWidth,
        displayWidth: theme.typography.displayWidth ?? look.displayWidth ?? DEFAULT_LOOK.displayWidth,
      },
      radius: theme.radius ?? look.radius ?? DEFAULT_LOOK.radius,
      corners: theme.corners ?? look.corners ?? DEFAULT_LOOK.corners,
      rule: theme.rule ?? look.rule ?? DEFAULT_LOOK.rule,
      line: theme.line ?? look.line ?? DEFAULT_LOOK.line,
      shadow: theme.shadow ?? look.shadow ?? DEFAULT_LOOK.shadow,
      bars: theme.bars ?? look.bars ?? DEFAULT_LOOK.bars,
      code: {
        ...theme.code,
        light: theme.code.light ?? preset.code.light,
        dark: theme.code.dark ?? preset.code.dark,
        frame: theme.code.frame ?? look.codeFrame ?? DEFAULT_LOOK.codeFrame,
      },
    }
  })

/* ─────────────────────────────── layouts ──────────────────────────────── */

/** The pages a block is shown on. Left out, it is shown on every page whose layout places it. */
export interface BlockCondition {
  /**
   * Paths the page may have: `/guide/**`. `*` stands for one part of a path
   * and `**` for any number of them. A pattern that starts with `!` takes
   * pages away again: `['/**', '!/blog/**']`.
   */
  path?: string[] | undefined
  /** Frontmatter the page must have: each key listed here must equal the page's value. */
  frontmatter?: Record<string, unknown> | undefined
}

export interface BlockRef {
  block: string
  props: Record<string, unknown>
  when?: BlockCondition | undefined
}

const BlockConditionSchema = z.strictObject({
  path: z
    .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
    .optional()
    .transform((path) => (typeof path === 'string' ? [path] : path)),
  frontmatter: z.record(z.string(), z.unknown()).optional(),
})

/** `- toc`, or `- { block: toc, props: { title: Contents }, when: { path: /guide/** } }`. */
const BlockRefSchema = z
  .union([
    z.string().min(1),
    z.strictObject({
      block: z.string().min(1),
      props: z.record(z.string(), z.unknown()).default({}),
      when: BlockConditionSchema.optional(),
    }),
  ])
  .transform((ref): BlockRef => (typeof ref === 'string' ? { block: ref, props: {} } : ref))

export const LAYOUT_WIDTHS = ['content', 'wide', 'full'] as const

const LayoutSchema = z.strictObject({
  /** Start from another layout and replace only the regions listed here. */
  extends: z.string().min(1).optional(),
  /** Width of the main column. */
  width: z.enum(LAYOUT_WIDTHS).optional(),
  /**
   * Set a page's code samples beside its prose, section by section, on a
   * screen wide enough for both. The built-in `api` layout does.
   */
  split: z.boolean().optional(),
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
  /** Show the day each page was last changed, read from the Git history of its file. */
  lastUpdated: z.boolean().default(false),
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
  /**
   * Where the visitor's browser gets the model from. `huggingface` downloads
   * it from the Hugging Face Hub, and the runtime that executes it from
   * jsDelivr. `site` serves both from the site itself: the build copies them
   * into the output, and the browser asks no other host for anything.
   */
  modelSource: z.enum(['huggingface', 'site']).default('huggingface'),
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
  /**
   * Let `search_docs` rank by meaning as well as by keyword where a Node process serves the endpoint:
   * `shabd dev`, `shabd preview` and `shabd mcp`. It takes effect when `search.semantic` is on and
   * `@huggingface/transformers` is installed. `false` keeps the endpoint to keywords, and that process
   * never loads the embedding model.
   */
  semantic: z.boolean().default(true),
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

/** `date-fns`, or `{ name: charts, file: ./components/charts.ts }` for a file of the site's own. */
const SandboxModuleSchema = z
  .union([z.string().min(1), z.strictObject({ name: z.string().min(1), file: z.string().min(1) })])
  .transform((module): SandboxModule => (typeof module === 'string' ? { name: module } : module))

export interface SandboxModule {
  /** What a snippet writes after `from`. */
  name: string
  /** A file of the site that the name stands for. Left out, the name is a package the site has installed. */
  file?: string | undefined
}

const SandboxFeatureSchema = z.strictObject({
  enabled: z.boolean().default(true),
  /**
   * What a live snippet may import, besides React and Shabd's own client:
   * packages the site has installed, and files of its own under a name.
   */
  modules: z.array(SandboxModuleSchema).default([]),
})

const FeedFeatureSchema = z.strictObject({
  enabled: z.boolean().default(false),
  /** The feed's own title. Defaults to the site's. */
  title: z.string().min(1).optional(),
  /** A content folder whose pages make up the feed, such as `changelog`. Left out, every page with a day is in it. */
  directory: z.string().min(1).optional(),
  /** How many pages the feed holds, newest first. */
  limit: z.int().min(1).max(500).default(20),
})

const SocialImagesFeatureSchema = z.strictObject({
  enabled: z.boolean().default(false),
  /**
   * The font files the pictures are set in: TrueType or OpenType, a regular
   * and a bold face. Left out, a font of the machine that builds is used.
   */
  font: z
    .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
    .default([])
    .transform((font) => (typeof font === 'string' ? [font] : font)),
})

const OfflineFeatureSchema = z.strictObject({
  enabled: z.boolean().default(false),
})

const FeaturesSchema = z.strictObject({
  search: feature(SearchFeatureSchema, true),
  mcp: feature(McpFeatureSchema, true),
  llms: feature(LlmsFeatureSchema, true),
  studio: feature(StudioFeatureSchema, true),
  sandbox: feature(SandboxFeatureSchema, true),
  /** rss.xml: the pages that have a day, newest first. Needs `site.url`. */
  feed: feature(FeedFeatureSchema, false),
  /** A picture for each page, shown where the page is shared. Needs `site.url` and `@resvg/resvg-js`. */
  socialImages: feature(SocialImagesFeatureSchema, false),
  /** Keep the built site in the reader's browser after a first visit, so that it can be read without a connection. */
  offline: feature(OfflineFeatureSchema, false),
})

/* ──────────────────────────────── content ─────────────────────────────── */

const ContentSchema = z.strictObject({
  /** Folder of .md / .mdx files, relative to the site root. */
  dir: z.string().min(1).default('content'),
  /** Sidebar definition, relative to the site root. */
  sidebar: z.string().min(1).default('sidebar.yaml'),
})

/* ───────────────────────────────── build ──────────────────────────────── */

const BuildSchema = z.strictObject({
  /**
   * The host the site is deployed to: `cloudflare`, `vercel` or `netlify`.
   * A build then also writes what that host needs to answer the MCP route
   * and to redirect addresses that have moved. `shabd build --adapter`
   * takes the same names, and wins over this.
   */
  adapter: z.enum(ADAPTERS).optional(),
  /**
   * How many threads compile pages, in a build and in `shabd check`. `auto`
   * is as many as are of use on the machine, up to eight. `1` compiles on
   * the thread that does the rest, as a small site is compiled whatever
   * this says.
   */
  threads: z.union([z.literal('auto'), z.number().int().min(1).max(64)]).default('auto'),
})

/* ─────────────────────────────── redirects ────────────────────────────── */

/** Where a redirect starts: a path on this site. */
const redirectSource = z
  .string()
  .regex(/^\/[^?#\s]*$/, { error: 'A redirect starts from a path on this site, such as /old-page' })

/** Where it leads: a page path, with a `#heading` if wanted, or a full address. */
const redirectTarget = z
  .string()
  .regex(/^(?:\/(?!\/)\S*|https?:\/\/\S+)$/i, {
    error: 'A redirect leads to a path on this site, such as /new-page, or to an address that starts with https://',
  })

/* ───────────────────────────────── check ──────────────────────────────── */

/** How `shabd check` treats what a rule finds. Only `error` makes the check fail. */
export const CHECK_LEVELS = ['off', 'note', 'warning', 'error'] as const
export type CheckLevel = (typeof CHECK_LEVELS)[number]

/**
 * The rules of `shabd check` that are a matter of the site's own standards.
 * What is plainly wrong (a link to a page that is not there) is always an
 * error and is not listed here.
 */
const CheckSchema = z.strictObject({
  /** A picture with no alternative text, which says nothing to a reader who cannot see it. */
  altText: z.enum(CHECK_LEVELS).default('warning'),
  /** A page with no description. Search results, llms.txt and shared links show one where there is one. */
  descriptions: z.enum(CHECK_LEVELS).default('off'),
  /** A link to another site that does not answer. It needs the network and takes time: `--external` asks for it once. */
  externalLinks: z.enum(CHECK_LEVELS).default('off'),
})

/* ──────────────────────────────── openapi ─────────────────────────────── */

const OpenApiSchema = z.strictObject({
  /** The description of the API: a YAML or JSON file, by its path from the site folder. OpenAPI 3.0 or 3.1. */
  spec: z.string().min(1),
  /** Where its pages are on the site: the overview at this address, and a page for each operation under it. */
  path: z
    .string()
    .regex(/^\/[^?#]*$/, 'Write the address as it is on the site, starting with a slash: /api')
    .default('/api')
    .transform((address) => address.replace(/\/+$/, '') || '/'),
  /** Offer each request to be sent from its page: the "Try it" form of an API page. */
  try: z.boolean().default(false),
})

export type OpenApiConfig = z.output<typeof OpenApiSchema>

/* ──────────────────────────────── markdown ────────────────────────────── */

export interface PluginRef {
  /** A package name, or a path to a file of the site's own. */
  name: string
  options: Record<string, unknown> | undefined
}

/** `remark-emoji`, or `[remark-toc, { heading: contents }]` to give the plugin options. */
const PluginRefSchema = z
  .union([z.string().min(1), z.tuple([z.string().min(1), z.record(z.string(), z.unknown())])])
  .transform((ref): PluginRef => (typeof ref === 'string' ? { name: ref, options: undefined } : { name: ref[0], options: ref[1] }))

const MarkdownSchema = z.strictObject({
  /**
   * remark plugins, which work on the Markdown, and rehype plugins, which
   * work on the HTML made from it. They run after Shabd's own, in the order
   * written.
   */
  remarkPlugins: z.array(PluginRefSchema).default([]),
  rehypePlugins: z.array(PluginRefSchema).default([]),
  /** Typeset maths written between dollar signs. Needs `remark-math` and `rehype-katex` installed. */
  math: z.boolean().default(false),
  /** Draw ```` ```mermaid ```` fences as diagrams, in the reader's browser. Needs `mermaid` installed. */
  mermaid: z.boolean().default(false),
})

/* ──────────────────────────────── variables ───────────────────────────── */

export type VarsInput = { [name: string]: string | number | boolean | VarsInput }

const varName = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_-]*$/, { error: 'A variable name is letters, digits, "-" and "_", and does not start with a digit' })

/** Values a page uses by name, as `{{name}}`. A group of values is written `{{group.name}}`. */
const VarsSchema: z.ZodType<VarsInput> = z.lazy(() =>
  z.record(varName, z.union([z.string(), z.number(), z.boolean(), VarsSchema])),
)

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
  /** What a build writes besides the static site. */
  build: BuildSchema.prefault({}),
  /** Components available in every .mdx file without an import. Name → file path. */
  components: z.record(componentName, z.string().min(1)).default({}),
  /** Custom layout blocks. Name → file path. */
  blocks: z.record(blockName, z.string().min(1)).default({}),
  /** Addresses that have moved. Old path → new path, or a full address. */
  redirects: z.record(redirectSource, redirectTarget).default({}),
  /** Values every page can use by name: `{{version}}`. */
  vars: VarsSchema.default({}),
  /** How Markdown is read: the site's own plugins, and maths. */
  markdown: MarkdownSchema.prefault({}),
  /** How strict `shabd check` is about what is a matter of taste. */
  check: CheckSchema.prefault({}),
  /** Pages made from an OpenAPI description: one description, or a list of them. */
  openapi: z
    .union([OpenApiSchema, z.array(OpenApiSchema)])
    .default([])
    .transform((written) => (Array.isArray(written) ? written : [written])),
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

/**
 * sidebar.yaml is one sidebar, written as a list, or several, written as a
 * map from the part of the site each belongs to:
 *
 *   /guide/:
 *     - guide/introduction
 *   /reference/:
 *     - reference/cli
 *
 * A page gets the sidebar of the longest path it is under. `/` is the
 * sidebar of every page that is under none of the others.
 */
export const SidebarsSchema = z.union([
  SidebarSchema,
  z.record(
    z.string().regex(/^\/\S*$/, { error: 'A sidebar is named by the part of the site it belongs to, such as /guide/' }),
    SidebarSchema,
  ),
])
export type SidebarsInput = SidebarInput | Record<string, SidebarInput>

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
  /**
   * Let a reader send the request from the page, and see what the API answers.
   * The pages made from an OpenAPI description set it when asked to.
   */
  try: z.boolean().default(false),
  /** A body for the request to start from, for a reader who tries it: any value, written as YAML. */
  body: z.unknown().optional(),
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

/** A calendar day. YAML reads `2026-11-17` without quotes as text, so that is how it is written. */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'A day is written as year-month-day, such as 2026-11-17' })

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
  /** Ask search engines not to list this page. It stays in the site's own search and navigation. */
  noindex: z.boolean().default(false),
  hero: HeroSchema.optional(),
  api: ApiSchema.optional(),
  editLink: z.boolean().optional(),
  pagination: z.boolean().optional(),
  /**
   * The day this page was last changed, as `2026-11-17`, in place of the day
   * Git has for it. `false` shows no day on this page.
   */
  lastUpdated: z.union([z.literal(false), day]).optional(),
  /** The day this page was published, as `2026-11-17`. The feed lists the page under it. */
  date: day.optional(),
  /** The picture other sites show when this page is shared: a path in `public/` or a full address. */
  image: z.string().min(1).optional(),
})

export type FrontmatterInput = z.input<typeof FrontmatterSchema>
export type Frontmatter = z.output<typeof FrontmatterSchema>
