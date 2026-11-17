/**
 * Everything a running Shabd process shares: the resolved config, the content
 * graph, and the Markdown compiler with its caches. The dev server, the build
 * and the MCP server each create one context and pass it around.
 */
import { codeBackgrounds, codeThemePlan } from '../shared/presets.js'
import path from 'node:path'
import { loadConfig, type ResolvedConfig } from './config/load.js'
import { ContentStore } from './content/store.js'
import { MarkdownCompiler, type CompileResult } from './markdown/compile.js'
import { loadUserPlugins } from './markdown/user-plugins.js'
import type { PageRecord } from './content/store.js'

export interface ShabdContext {
  config: ResolvedConfig
  store: ContentStore
  compiler: MarkdownCompiler
  /** True for `shabd dev`: drafts are visible and pages register for hot updates. */
  dev: boolean
}

export async function createContext(root: string, options: { dev: boolean }): Promise<ShabdContext> {
  const config = await loadConfig(root)
  const store = await ContentStore.load(config, { drafts: options.dev })
  const { theme } = config.config
  const plugins = await loadUserPlugins(config)
  const compiler = new MarkdownCompiler({
    plugins,
    themes: { light: theme.code.light, dark: theme.code.dark },
    more: codeThemePlan(theme).themes.slice(2),
    backgrounds: codeBackgrounds(theme),
    minContrast: theme.code.minContrast,
    wrap: theme.code.wrap,
    lineNumbers: theme.code.lineNumbers,
    sandbox: config.config.features.sandbox.enabled,
    mermaid: config.config.markdown.mermaid,
    // A plugin that was edited or upgraded compiles pages differently from the one before it.
    fingerprint: plugins.fingerprint ? `${config.compileFingerprint}:${plugins.fingerprint}` : config.compileFingerprint,
    cacheDir: path.join(config.cacheDir, 'pages'),
  })
  return { config, store, compiler, dev: options.dev }
}

/** Compile a page from the store. Throws the page's frontmatter error if it has one. */
export function compilePage(context: ShabdContext, page: PageRecord): Promise<CompileResult> {
  if (page.error) throw page.error
  return context.compiler.compile({
    file: page.file,
    source: page.source,
    format: page.format,
    id: page.id,
    routePath: page.path,
    hash: page.hash,
    liftTitle: page.titleFromHeading,
  })
}
