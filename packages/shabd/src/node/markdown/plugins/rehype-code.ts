/**
 * Fenced code → highlighted code blocks, or live sandboxes.
 *
 * Highlighting happens here, at compile time, with Shiki. The browser
 * receives finished markup: no highlighter is shipped to readers.
 *
 * Both colour modes are emitted at once as CSS variables on each token
 * (`--shiki-light`, `--shiki-dark`), so switching theme is a CSS change and
 * needs no re-render.
 *
 * Results are memoised per block. Editing one paragraph of a page with
 * twenty code samples re-highlights none of them, which is most of what
 * keeps hot updates fast.
 */
import type { Element, Parent, Root } from 'hast'
import { toString } from 'hast-util-to-string'
import { bundledLanguages, createHighlighter, type BundledLanguage, type Highlighter } from 'shiki'
import { SKIP, visit } from 'unist-util-visit'
import { parseCodeMeta, type CodeMeta } from '../code-meta.js'

export interface CodeOptions {
  themes: { light: string; dark: string }
  /** Turn ```` ```tsx live ```` fences into <Sandbox> components. */
  sandbox: boolean
}

const PLAIN_LANGUAGES = new Set(['', 'text', 'txt', 'plain', 'plaintext'])
const SANDBOX_LANGUAGES = new Set(['jsx', 'tsx'])
const MEMO_LIMIT = 2000

interface Block {
  parent: Parent
  index: number
  code: string
  lang: string
  meta: CodeMeta
  rawMeta: string
}

/** A highlighter plus a memo of blocks it has already rendered. Create one per site and reuse it. */
export class CodeHighlighter {
  readonly options: CodeOptions
  #highlighter: Promise<Highlighter> | undefined
  #memo = new Map<string, Element>()

  constructor(options: CodeOptions) {
    this.options = options
  }

  /** Started lazily: sites and pages without code never pay for it. */
  #get(): Promise<Highlighter> {
    this.#highlighter ??= createHighlighter({
      themes: [this.options.themes.light, this.options.themes.dark],
      langs: [],
    })
    return this.#highlighter
  }

  /** Load the highlighter ahead of the first page, off the critical path. */
  warm(): void {
    void this.#get().catch(() => {})
  }

  async highlight(block: Pick<Block, 'code' | 'lang' | 'meta' | 'rawMeta'>): Promise<Element> {
    const key = `${block.lang}\u0000${block.rawMeta}\u0000${block.code}`
    const cached = this.#memo.get(key)
    if (cached) return structuredClone(cached)

    const highlighter = await this.#get()
    const lang = await this.#language(highlighter, block.lang)
    const highlighted = new Set(block.meta.highlight)

    const tree = highlighter.codeToHast(block.code, {
      lang,
      themes: this.options.themes,
      defaultColor: false,
      transformers: [
        {
          name: 'shabd',
          line(node, line) {
            if (highlighted.has(line)) this.addClassToHast(node, 'sb-line-highlight')
          },
          pre(node) {
            node.properties['data-lang'] = block.lang || 'text'
            if (block.meta.title) node.properties['data-title'] = block.meta.title
            if (block.meta.flags.has('showLineNumbers')) node.properties['data-line-numbers'] = ''
            if (block.meta.flags.has('wrap')) node.properties['data-wrap'] = ''
          },
        },
      ],
    })

    const pre = tree.children.find((node): node is Element => node.type === 'element' && node.tagName === 'pre')
    if (!pre) throw new Error('Shiki returned no <pre> element')

    if (this.#memo.size >= MEMO_LIMIT) this.#memo.delete(this.#memo.keys().next().value!)
    this.#memo.set(key, pre)
    return structuredClone(pre)
  }

  async #language(highlighter: Highlighter, lang: string): Promise<string> {
    if (PLAIN_LANGUAGES.has(lang) || !(lang in bundledLanguages)) return 'text'
    if (!highlighter.getLoadedLanguages().includes(lang)) {
      await highlighter.loadLanguage(lang as BundledLanguage)
    }
    return lang
  }
}

export function rehypeCode(highlighter: CodeHighlighter) {
  return async (tree: Root) => {
    const blocks: Block[] = []

    visit(tree, 'element', (node, index, parent) => {
      if (node.tagName !== 'pre' || !parent || index === undefined) return
      const code = node.children.find(
        (child): child is Element => child.type === 'element' && child.tagName === 'code',
      )
      if (!code) return

      const classes = Array.isArray(code.properties.className) ? code.properties.className : []
      const langClass = classes.find((name) => typeof name === 'string' && name.startsWith('language-'))
      const lang = typeof langClass === 'string' ? langClass.slice('language-'.length).toLowerCase() : ''
      const rawMeta = typeof code.data?.meta === 'string' ? code.data.meta : ''

      blocks.push({
        parent,
        index,
        code: toString(code).replace(/\n$/, ''),
        lang,
        meta: parseCodeMeta(rawMeta),
        rawMeta,
      })
      return SKIP
    })

    await Promise.all(
      blocks.map(async (block) => {
        const live = highlighter.options.sandbox && block.meta.flags.has('live') && SANDBOX_LANGUAGES.has(block.lang)
        block.parent.children[block.index] = live ? sandboxElement(block) : await highlighter.highlight(block)
      }),
    )
  }
}

/** A `live` fence becomes a <Sandbox>, resolved from the MDX component map. */
function sandboxElement(block: Block): Element {
  return {
    type: 'element',
    tagName: 'Sandbox',
    properties: {
      code: block.code,
      lang: block.lang,
      ...(block.meta.title ? { title: block.meta.title } : {}),
      ...(block.meta.attrs.group ? { group: block.meta.attrs.group } : {}),
    },
    children: [],
  }
}
