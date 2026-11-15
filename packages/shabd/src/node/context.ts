/**
 * Everything a running Shabd process shares: the resolved config, the content
 * graph, and the Markdown compiler with its caches. The dev server, the build
 * and the MCP server each create one context and pass it around.
 */
import path from 'node:path'
import { loadConfig, type ResolvedConfig } from './config/load.js'
import { ContentStore } from './content/store.js'
import { MarkdownCompiler, type CompileResult } from './markdown/compile.js'
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
  const compiler = new MarkdownCompiler({
    themes: config.config.theme.code,
    sandbox: config.config.features.sandbox.enabled,
    fingerprint: config.compileFingerprint,
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
