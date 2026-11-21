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
import { initPageData, type PageData } from './page-data.js'
import { CodeHighlighter, rehypeCode, type CodeOptions } from './plugins/rehype-code.js'
import { rehypeHeadings } from './plugins/rehype-headings.js'
import { rehypeHtml } from './plugins/rehype-html.js'
import { rehypeLinks } from './plugins/rehype-links.js'
import { rehypeSplit } from './plugins/rehype-split.js'
import { remarkCallouts } from './plugins/remark-callouts.js'
import { remarkHtml } from './plugins/remark-html.js'
import { remarkLiftTitle } from './plugins/remark-lift-title.js'
import type { UserPlugins } from './user-plugins.js'

/** Compiled pages import their component map from here. Resolved by the Vite plugin. */
export const MDX_COMPONENTS_ID = 'virtual:shabd/mdx-components'

export interface CompilerOptions extends CodeOptions {
  /** Part of every cache key: changes when a setting that affects output changes. */
  fingerprint: string
  /** Directory for the on-disk cache. Omit to cache in memory only. */
  cacheDir?: string | undefined
  /** The site's own plugins, and those an option brings. They run after Shabd's. */
  plugins?: Pick<UserPlugins, 'remark' | 'rehype' | 'rehypeBeforeCode'> | undefined
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
  /** Set code beside prose, as the page's layout asks (`split: true`). */
  split?: boolean | undefined
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
  /** The line each of `links` is written on, in the same order. Zero where it is not known. */
  linkLines: number[]
  /** Links to other sites, and pictures with no alternative text: what `shabd check` asks about. */
  external: PageData['external']
  unlabelled: PageData['unlabelled']
  /** Tags in a `.md` page that are written like components. */
  strays: PageData['strays']
  /** The page's live snippets, which `shabd check` tries. */
  snippets: PageData['snippets']
  /** Heading ids on this page. */
  anchors: string[]
  /** The colours of the page's code tokens in the site's own syntax themes, as a stylesheet. The page module exports it. */
  codeCss: string
  /**
   * The same tokens under every syntax theme the theme menu can reach. A
   * build gathers these from every page into one stylesheet for the site.
   */
  codeColours: Record<string, string[]>
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

  /**
   * The colours behind code changed, as they do when a palette is edited
   * while the dev server runs. Pages compile to something else from here on:
   * the new fingerprint keeps them apart from what is cached.
   */
  recolour(backgrounds: CodeOptions['backgrounds'], fingerprint: string): void {
    this.options.backgrounds = backgrounds
    this.options.fingerprint = fingerprint
    this.highlighter.forget()
  }

  /** Where a page is kept in the cache, and what it was compiled from and with. */
  #place(input: CompileInput): { slot: string; key: string } {
    return {
      slot: input.id ?? input.file,
      key: cacheKey(this.options.fingerprint, input.format, input.routePath, input.liftTitle, input.split === true, input.hash ?? input.source),
    }
  }

  /** Is the page compiled already, as it is now and as the site is set up now? */
  async has(input: CompileInput): Promise<boolean> {
    const { slot, key } = this.#place(input)
    return (await this.cache.get(slot, key)) !== undefined
  }

  async compile(input: CompileInput): Promise<CompileResult> {
    const started = performance.now()
    const { slot, key } = this.#place(input)

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
      split: input.split,
    })

    try {
      await this.#processor(input.format).process(file)
    } catch (error) {
      throw toShabdError(error, input)
    }
    // KaTeX does not stop at maths it cannot read: it leaves the source on the page in red and says so
    // in a message. A mistake in a page is reported where it is, like any other.
    const maths = file.messages.find((message) => message.source === 'rehype-katex')
    if (maths) {
      const why = (maths.cause as Error | undefined)?.message?.replace(/^KaTeX parse error: /, '') ?? maths.reason
      throw new ShabdError(
        input.file,
        [{ path: [], message: `This maths could not be typeset. ${why}`, ...(maths.line ? { line: maths.line, column: maths.column ?? 1 } : {}) }],
        input.source,
      )
    }

    return {
      code: String(file.value),
      ...(data.title !== undefined ? { title: data.title } : {}),
      toc: data.toc,
      sections: data.sections,
      links: data.links,
      linkLines: data.linkLines,
      external: data.external,
      unlabelled: data.unlabelled,
      strays: data.strays,
      snippets: data.snippets,
      anchors: data.anchors,
      codeCss: data.codeCss,
      codeColours: data.codeColours,
    }
  }

  #processor(format: 'md' | 'mdx'): Processor {
    let processor = this.#processors.get(format)
    if (!processor) {
      const user = this.options.plugins
      // HTML written in a .md page is text to the MDX compiler, which would leave it out of the page
      // without a word. It is read as HTML here, before anything else looks at the page, so that a
      // heading written as a tag gets its id and a link written as one is rewritten like any other.
      // An .mdx page has none of it to read: there a tag is JSX from the start.
      const html = format === 'md' ? { remark: [remarkHtml], rehype: [rehypeHtml] } : { remark: [], rehype: [] }
      processor = createProcessor({
        format,
        jsxImportSource: 'react',
        providerImportSource: MDX_COMPONENTS_ID,
        // The site's plugins are loaded by name, so all that is known of one is that it is a function.
        remarkPlugins: [remarkFrontmatter, remarkGfm, remarkLiftTitle, remarkCallouts, ...html.remark, ...(user?.remark ?? [])] as NonNullable<
          Parameters<typeof createProcessor>[0]
        >['remarkPlugins'],
        rehypePlugins: [
          ...html.rehype,
          // First, while the page is still as its author wrote it: the outline, what is searched, the links.
          rehypeHeadings,
          rehypeLinks,
          ...(user?.rehypeBeforeCode ?? []),
          [rehypeCode, this.highlighter],
          ...(user?.rehype ?? []),
          // Last of all, once every piece of the page is what it will be: this one only moves them.
          rehypeSplit,
          rehypeMdxImportMedia,
        ] as NonNullable<Parameters<typeof createProcessor>[0]>['rehypePlugins'],
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
