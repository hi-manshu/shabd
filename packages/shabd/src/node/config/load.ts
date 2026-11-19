/**
 * Loads `shabd.config.yaml` and `sidebar.yaml` into a ResolvedConfig.
 *
 * Loading has three stages, each of which reports errors against the YAML
 * source rather than against an in-memory object:
 *
 *   1. parse     – YAML syntax
 *   2. validate  – shape, via the Zod schema (defaults and shorthands applied)
 *   3. resolve   – cross-references: layout inheritance, block names, file paths
 */
import { codeBackgrounds, codeThemePlan } from '../../shared/presets.js'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveLayouts } from '../../shared/layout.js'
import { isExternal, normalizePath } from '../../shared/paths.js'
import { ConfigSchema, SidebarsSchema, type ShabdConfig, type SidebarsInput } from '../../shared/schema.js'
import type { ResolvedLayout } from '../../shared/types.js'
import { flattenVars } from '../content/vars.js'
import { ShabdError, type SourceIssue } from './errors.js'
import { locateIssues, parseYamlWithSchema } from './yaml.js'

/** Bump when compiled page output changes shape, to invalidate on-disk caches. */
export const PIPELINE_VERSION = 11

export const CONFIG_FILE_NAMES = ['shabd.config.yaml', 'shabd.config.yml'] as const

/** One entry of `redirects:`, ready to use. */
export interface Redirect {
  /** The key as it is written in the config, for pointing at it. */
  key: string
  /** The route that has moved, e.g. `/old-page`. */
  from: string
  /** Where it leads in the end: a route, with its `#heading` if it has one, or a full address. */
  to: string
  /** True when `to` is on another site. */
  external: boolean
}

export interface ResolvedConfig {
  /** Absolute path of the site root (the folder holding shabd.config.yaml). */
  root: string
  configFile: string
  /** Absolute path of the sidebar file. It may not exist: the sidebar is then fully auto-generated. */
  sidebarFile: string
  /** Absolute path of the content directory. */
  contentDir: string
  cacheDir: string
  config: ShabdConfig
  /** Built-in and user layouts with `extends` chains flattened. */
  layouts: Record<string, ResolvedLayout>
  /** MDX component name → absolute file path. */
  components: Record<string, string>
  /** Custom block name → absolute file path. */
  blocks: Record<string, string>
  /** Absolute paths of the site's own stylesheets (`theme.css`). */
  stylesheets: string[]
  /** Absolute paths of the font files social pictures are set in. Empty: a font of this machine is looked for. */
  socialFonts: string[]
  /** `redirects:` with chains followed to their end. */
  redirects: Redirect[]
  /** `vars:` as one flat table of text: a nested value is `group.name`. */
  vars: Record<string, string>
  /** `openapi:`: each description's file as an absolute path, and the address its pages start at. */
  openapi: { spec: string; prefix: string; try: boolean }[]
  /**
   * The folder the pages made from those descriptions are written to. It is
   * in the site folder and never under `node_modules`: see src/node/openapi/site.ts.
   */
  generatedDir: string
  /** Where a key of the config is written, for problems found after it has loaded. */
  locate(path: (string | number)[]): { line: number; column: number } | undefined
  /** Changes whenever a setting that affects compiled pages changes. Part of every cache key. */
  compileFingerprint: string
  /**
   * The same without the colours behind code. When only those change, pages
   * need compiling again but nothing else about the site does: the dev
   * server recolours in place instead of restarting.
   */
  structureFingerprint: string
}

export function findConfigFile(root: string): string | undefined {
  return CONFIG_FILE_NAMES.map((name) => path.join(root, name)).find((file) => existsSync(file))
}

export async function loadConfig(rootDir: string): Promise<ResolvedConfig> {
  const root = path.resolve(rootDir)
  const configFile = findConfigFile(root)
  if (!configFile) {
    throw new ShabdError(path.join(root, CONFIG_FILE_NAMES[0]), [
      {
        path: [],
        message:
          `No ${CONFIG_FILE_NAMES[0]} found in ${root}.\n` +
          `  Create one with at least:\n\n    site:\n      title: My docs`,
      },
    ])
  }

  const source = await readFile(configFile, 'utf8')
  return resolveConfig(root, configFile, source)
}

/** Stages 2 and 3, split out so tests can pass YAML text directly. */
export function resolveConfig(root: string, configFile: string, source: string): ResolvedConfig {
  const { value: config, yaml } = parseYamlWithSchema(configFile, source, ConfigSchema)

  const issues: { path: (string | number)[]; message: string }[] = []

  const { layouts, issues: layoutIssues } = resolveLayouts(config.layouts, Object.keys(config.blocks))
  issues.push(...layoutIssues)

  if (!layouts[config.defaults.layout]) {
    issues.push({
      path: ['defaults', 'layout'],
      message: `Layout "${config.defaults.layout}" does not exist. Available layouts: ${Object.keys(layouts).sort().join(', ')}`,
    })
  }

  const resolveFiles = (section: 'components' | 'blocks') =>
    Object.fromEntries(
      Object.entries(config[section]).map(([name, file]) => {
        const absolute = path.resolve(root, file)
        if (!existsSync(absolute)) {
          issues.push({ path: [section, name], message: `File not found: ${file} (looked in ${absolute})` })
        }
        return [name, absolute]
      }),
    )
  const components = resolveFiles('components')
  const blocks = resolveFiles('blocks')
  const stylesheets = config.theme.css.map((file, index) => {
    const absolute = path.resolve(root, file)
    if (!existsSync(absolute)) {
      issues.push({ path: ['theme', 'css', index], message: `File not found: ${file} (looked in ${absolute})` })
    }
    return absolute
  })

  const redirects = resolveRedirects(config.redirects, issues)

  if (config.features.feed.enabled && !config.site.url) {
    issues.push({
      path: ['features', 'feed'],
      message: 'The feed needs `site.url`: a feed reader is given full addresses, such as https://docs.example.com/guide',
    })
  }

  if (config.features.socialImages.enabled && !config.site.url) {
    issues.push({
      path: ['features', 'socialImages'],
      message: 'Social pictures need `site.url`: the sites that show a picture fetch it by its full address',
    })
  }
  const socialFonts = config.features.socialImages.font.map((file, index) => {
    const absolute = path.resolve(root, file)
    const at = ['features', 'socialImages', 'font', index]
    if (!/\.(?:ttf|otf|ttc)$/i.test(file)) {
      issues.push({ path: at, message: `${file} is not a font that can be used here. Name a .ttf, .otf or .ttc file; web fonts (.woff2) cannot be read` })
    } else if (!existsSync(absolute)) {
      issues.push({ path: at, message: `File not found: ${file} (looked in ${absolute})` })
    }
    return absolute
  })

  // One description is written as a mapping and several as a list, and a problem is reported where it is written.
  const listed = Array.isArray((yaml.data as { openapi?: unknown } | null)?.openapi)
  const openapi = config.openapi.map((api, index) => {
    const at = (key: string) => (listed ? ['openapi', index, key] : ['openapi', key])
    const spec = path.resolve(root, api.spec)
    if (!existsSync(spec)) issues.push({ path: at('spec'), message: `File not found: ${api.spec} (looked in ${spec})` })
    const other = config.openapi.findIndex((earlier, position) => position < index && inPath(api.path, earlier.path))
    if (other >= 0) {
      const theirs = config.openapi[other]!.path
      issues.push({
        path: at('path'),
        message:
          api.path === theirs
            ? `Two descriptions have their pages at ${api.path}. Give each a \`path\` of its own.`
            : `${api.path} and ${theirs} are one inside the other, so the pages of one API would be among the pages of the other. Give each a \`path\` of its own.`,
      })
    }
    return { spec, prefix: api.path, try: api.try }
  })

  if (issues.length > 0) {
    throw new ShabdError(configFile, locateIssues(issues, yaml), source)
  }

  const contentDir = path.resolve(root, config.content.dir)
  const vars = flattenVars(config.vars)
  const digest = (value: unknown) => createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 12)
  const structureFingerprint = digest([
    PIPELINE_VERSION,
    config.site.base,
    // A page is read with its variables filled in, so another value is another page.
    vars,
    // The site's own plugins, their options, and whether maths is typeset.
    config.markdown,
    config.theme.code,
    // The presets in the theme menu decide which other syntax themes every code block is coloured in.
    codeThemePlan(config.theme).themes,
    config.features.sandbox.enabled,
    // Which layouts there are, and which of them set code beside prose: pages of those compile differently.
    Object.keys(layouts)
      .sort()
      .map((name) => [name, layouts[name]?.split]),
  ])
  // Token colours are held to a contrast floor against the colours code is drawn on.
  const compileFingerprint = digest([structureFingerprint, codeBackgrounds(config.theme)])

  return {
    root,
    configFile,
    sidebarFile: path.resolve(root, config.content.sidebar),
    contentDir,
    cacheDir: existsSync(path.join(root, 'node_modules'))
      ? path.join(root, 'node_modules', '.shabd')
      : path.join(root, '.shabd'),
    config,
    layouts,
    components,
    blocks,
    stylesheets,
    socialFonts,
    redirects,
    vars,
    openapi,
    generatedDir: path.join(root, '.shabd', 'openapi'),
    locate: (path) => yaml.locate(path, 'key'),
    compileFingerprint,
    structureFingerprint,
  }
}

/** Is one address the other, or inside it or around it? `/api` and `/api/v2` are; `/api` and `/api-v2` are not. */
function inPath(a: string, b: string): boolean {
  const within = (inner: string, outer: string) => outer === '/' || inner === outer || inner.startsWith(`${outer}/`)
  return within(a, b) || within(b, a)
}

/** The page a redirect target names, without its `#heading`. */
export function redirectRoute(target: string): string {
  return normalizePath(target.split('#')[0] ?? '/')
}

/**
 * Follow each redirect to where it ends. `/a → /b` and `/b → /c` make `/a`
 * lead straight to `/c`, so a reader is never sent on twice. Two that lead to
 * each other lead nowhere, which is an error.
 */
function resolveRedirects(
  written: Record<string, string>,
  issues: { path: (string | number)[]; message: string }[],
): Redirect[] {
  const bySource = new Map<string, { key: string; to: string }>()
  for (const [key, to] of Object.entries(written)) {
    const from = normalizePath(key)
    const other = bySource.get(from)
    if (other) {
      issues.push({ path: ['redirects', key], message: `"${key}" and "${other.key}" are the same address. Keep one of them.` })
      continue
    }
    bySource.set(from, { key, to })
  }

  const redirects: Redirect[] = []
  for (const [from, { key, to }] of bySource) {
    let target = to
    const visited = [from]
    while (!isExternal(target)) {
      const route = redirectRoute(target)
      const next = bySource.get(route)
      if (!next) break
      if (visited.includes(route)) {
        issues.push({ path: ['redirects', key], message: `Redirects lead in a circle: ${[...visited, route].join(' → ')}` })
        target = ''
        break
      }
      visited.push(route)
      target = next.to
    }
    if (target) redirects.push({ key, from, to: target, external: isExternal(target) })
  }
  return redirects
}

export interface LoadedSidebar {
  /** One sidebar, as a list, or several, keyed by the part of the site each belongs to. */
  input: SidebarsInput
  /** Map a sidebar.yaml data path to a source issue with line and column. */
  locate(issues: { path: (string | number)[]; message: string }[]): SourceIssue[]
  source: string | undefined
}

/** Read and validate sidebar.yaml. A missing file is not an error: everything is auto-generated. */
export async function loadSidebar(config: Pick<ResolvedConfig, 'sidebarFile'>): Promise<LoadedSidebar> {
  if (!existsSync(config.sidebarFile)) {
    return { input: [], locate: (issues) => issues, source: undefined }
  }
  const source = await readFile(config.sidebarFile, 'utf8')
  return parseSidebar(config.sidebarFile, source)
}

export function parseSidebar(file: string, source: string): LoadedSidebar {
  const { value, yaml } = parseYamlWithSchema(file, source, SidebarsSchema, { emptyValue: [] })
  return { input: value, locate: (issues) => locateIssues(issues, yaml), source }
}
