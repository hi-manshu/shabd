/**
 * The Markdown/MDX pipeline.
 *
 *   source ──remark──▶ mdast ──remark-rehype──▶ hast ──recma──▶ ES module
 *            │                  │
 *            │                  ├─ rehypeHeadings   ids, outline, searchable sections
 *            │                  ├─ rehypeLinks      ./page.md → /page, link inventory
 *            │                  ├─ rehypeCode       Shiki highlighting, live sandboxes
 *            │                  └─ import media     ![](./img.png) → bundled asset
 *            ├─ frontmatter     skipped here (parsed by the content store)
 *            ├─ GFM             tables, task lists, footnotes, autolinks
 *            ├─ remarkLiftTitle leading `# h1` → page title
 *            └─ remarkCallouts  > [!NOTE] → <Callout>
 *
 * `.md` and `.mdx` go through the same MDX compiler (with `format` set), so
 * both become React components that take the same component map.
 *
 * Performance comes from doing work once:
 *   - one unified processor per format, built on first use and reused
 *   - one Shiki highlighter per site, with per-block memoisation
 *   - compiled output cached by content hash, in memory and on disk
 */
import { createProcessor } from '@mdx-js/mdx'
import rehypeMdxImportMedia from 'rehype-mdx-import-media'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import { VFile } from 'vfile'
import type { PageSection, TocEntry } from '../../shared/types.js'
import { ShabdError } from '../config/errors.js'
import { cacheKey, SlotCache } from './cache.js'
import { initPageData } from './page-data.js'
import { CodeHighlighter, rehypeCode, type CodeOptions } from './plugins/rehype-code.js'
import { rehypeHeadings } from './plugins/rehype-headings.js'
import { rehypeLinks } from './plugins/rehype-links.js'
import { remarkCallouts } from './plugins/remark-callouts.js'
import { remarkLiftTitle } from './plugins/remark-lift-title.js'

/** Compiled pages import their component map from here. Resolved by the Vite plugin. */
export const MDX_COMPONENTS_ID = 'virtual:shabd/mdx-components'

export interface CompilerOptions extends CodeOptions {
  /** Part of every cache key: changes when a setting that affects output changes. */
  fingerprint: string
  /** Directory for the on-disk cache. Omit to cache in memory only. */
  cacheDir?: string | undefined
}

export interface CompileInput {
  /** Absolute path, used in error messages and for resolving imports. */
  file: string
  source: string
  format: 'md' | 'mdx'
  /** Content-relative path. Undefined for partials that are not pages. */
  id?: string | undefined
  /** Route path of the page. */
  routePath?: string | undefined
  /** Hash of `source`, if the caller already has it. */
  hash?: string | undefined
  /** Use a leading `# heading` as the title and remove it from the body. */
  liftTitle?: boolean | undefined
}

export interface CompiledPage {
  /** ES module source. Default export is the page component. */
  code: string
  /** Set when a leading heading was lifted out of the body. */
  title?: string
  toc: TocEntry[]
  sections: PageSection[]
  /** Route paths this page links to. */
  links: string[]
  /** Heading ids on this page. */
  anchors: string[]
}

export interface CompileResult extends CompiledPage {
  cached: boolean
  /** Time spent in this call, in milliseconds. */
  ms: number
}

type Processor = ReturnType<typeof createProcessor>

export class MarkdownCompiler {
  readonly options: CompilerOptions
  readonly highlighter: CodeHighlighter
  readonly cache: SlotCache<CompiledPage>
  #processors = new Map<'md' | 'mdx', Processor>()
  #inFlight = new Map<string, Promise<CompiledPage>>()

  constructor(options: CompilerOptions) {
    this.options = options
    this.highlighter = new CodeHighlighter(options)
    this.cache = new SlotCache(options.cacheDir)
  }

  async compile(input: CompileInput): Promise<CompileResult> {
    const started = performance.now()
    const slot = input.id ?? input.file
    const key = cacheKey(
      this.options.fingerprint,
      input.format,
      input.routePath,
      input.liftTitle,
      input.hash ?? input.source,
    )

    const cached = await this.cache.get(slot, key)
    if (cached) return { ...cached, cached: true, ms: performance.now() - started }

    // Two callers asking for the same page at once (the dev server and the
    // search indexer, say) share one compilation.
    let pending = this.#inFlight.get(key)
    if (!pending) {
      pending = this.#run(input).finally(() => this.#inFlight.delete(key))
      this.#inFlight.set(key, pending)
    }
    const compiled = await pending
    this.cache.set(slot, key, compiled)
    return { ...compiled, cached: false, ms: performance.now() - started }
  }

  async #run(input: CompileInput): Promise<CompiledPage> {
    const file = new VFile({ value: input.source, path: input.file })
    const data = initPageData(file, {
      liftTitle: input.liftTitle ?? false,
      routePath: input.routePath,
      id: input.id,
    })

    try {
      await this.#processor(input.format).process(file)
    } catch (error) {
      throw toShabdError(error, input)
    }

    return {
      code: String(file.value),
      ...(data.title !== undefined ? { title: data.title } : {}),
      toc: data.toc,
      sections: data.sections,
      links: data.links,
      anchors: data.anchors,
    }
  }

  #processor(format: 'md' | 'mdx'): Processor {
    let processor = this.#processors.get(format)
    if (!processor) {
      processor = createProcessor({
        format,
        jsxImportSource: 'react',
        providerImportSource: MDX_COMPONENTS_ID,
        remarkPlugins: [remarkFrontmatter, remarkGfm, remarkLiftTitle, remarkCallouts],
        rehypePlugins: [rehypeHeadings, rehypeLinks, [rehypeCode, this.highlighter], rehypeMdxImportMedia],
      })
      this.#processors.set(format, processor)
    }
    return processor
  }
}

/** MDX reports syntax errors as VFileMessages. Present them like every other authoring error. */
function toShabdError(error: unknown, input: CompileInput): unknown {
  if (typeof error !== 'object' || error === null || !('reason' in error)) return error
  type Point = { line?: number | null; column?: number | null }
  const message = error as { reason: string; place?: (Point & { start?: Point }) | null } & Point
  // A message's position is a point, or a range with a start. Some MDX errors
  // (an unclosed tag) carry no position at all and only mention it in the text.
  const point = message.place?.start ?? message.place ?? message
  const inText = /\((\d+):(\d+)(?:-\d+:\d+)?\)\s*$/.exec(message.reason)
  const line = point.line ?? (inText ? Number(inText[1]) : undefined)
  const column = point.column ?? (inText ? Number(inText[2]) : undefined)
  return new ShabdError(
    input.file,
    [{ path: [], message: message.reason, ...(line ? { line, column: column ?? 1 } : {}) }],
    input.source,
  )
}
