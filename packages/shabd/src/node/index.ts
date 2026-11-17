/**
 * Programmatic API.
 *
 *     import { build, dev, loadConfig } from '@himanshoe/shabd'
 */
export { build, type BuildOptions } from './build/build.js'
export { preview, type PreviewOptions } from './build/preview.js'
export { check, collectProblems, type Problem } from './check.js'
export { isShabdError, ShabdError, type SourceIssue } from './config/errors.js'
export { loadConfig, loadSidebar, type ResolvedConfig } from './config/load.js'
export { themeToCss } from './config/theme-css.js'
export { ContentStore, type PageRecord } from './content/store.js'
export { resolveSidebar } from './content/sidebar.js'
export { compilePage, createContext, type ShabdContext } from './context.js'
export { dev, type DevOptions } from './dev.js'
export { MarkdownCompiler, type CompiledPage } from './markdown/compile.js'
export { liveDocs } from './mcp/live.js'
export { staticDocs } from './mcp/static.js'
export { shabd, type ShabdPluginOptions } from './vite/plugin.js'
export type { Frontmatter, ShabdConfig, ShabdConfigInput, SidebarInput } from '../shared/schema.js'
export type { PageMeta, SidebarNode, SiteData, TocEntry } from '../shared/types.js'
