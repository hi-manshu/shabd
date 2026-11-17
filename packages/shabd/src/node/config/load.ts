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
import { ConfigSchema, SidebarSchema, type ShabdConfig, type SidebarInput } from '../../shared/schema.js'
import type { ResolvedLayout } from '../../shared/types.js'
import { ShabdError, type SourceIssue } from './errors.js'
import { locateIssues, parseYamlWithSchema } from './yaml.js'

/** Bump when compiled page output changes shape, to invalidate on-disk caches. */
export const PIPELINE_VERSION = 6

export const CONFIG_FILE_NAMES = ['shabd.config.yaml', 'shabd.config.yml'] as const

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

  if (issues.length > 0) {
    throw new ShabdError(configFile, locateIssues(issues, yaml), source)
  }

  const contentDir = path.resolve(root, config.content.dir)
  const digest = (value: unknown) => createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 12)
  const structureFingerprint = digest([
    PIPELINE_VERSION,
    config.site.base,
    config.theme.code,
    // The presets in the theme menu decide which other syntax themes every code block is coloured in.
    codeThemePlan(config.theme).themes,
    config.features.sandbox.enabled,
    Object.keys(layouts).sort(),
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
    compileFingerprint,
    structureFingerprint,
  }
}

export interface LoadedSidebar {
  input: SidebarInput
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
  const { value, yaml } = parseYamlWithSchema(file, source, SidebarSchema, { emptyValue: [] })
  return { input: value, locate: (issues) => locateIssues(issues, yaml), source }
}
