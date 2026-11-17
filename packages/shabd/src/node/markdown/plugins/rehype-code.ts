/**
 * Fenced code → highlighted code blocks, or live sandboxes.
 *
 * Highlighting happens here, at compile time, with Shiki. The browser
 * receives finished markup: no highlighter is shipped to readers.
 *
 * Every syntax theme a reader can see is applied at once. A token carries a
 * class, and the page's stylesheet gives that class its colour under each
 * theme, so switching colour mode or theme is a CSS change and needs no
 * re-render.
 *
 * A theme's colours are not always readable on the page's code background,
 * which belongs to the site's palette and not to the syntax theme. Colours
 * that fall short of `minContrast` are moved to it (see shared/color.ts).
 *
 * Results are memoised per block. Editing one paragraph of a page with
 * twenty code samples re-highlights none of them, which is most of what
 * keeps hot updates fast.
 */
import type { Element, Parent, Root } from 'hast'
import { toString } from 'hast-util-to-string'
import { bundledLanguages, createHighlighter, type BundledLanguage, type Highlighter } from 'shiki'
import { SKIP, visit } from 'unist-util-visit'
import type { VFile } from 'vfile'
import { ensureContrast } from '../../../shared/color.js'
import type { CodeBackgrounds } from '../../../shared/presets.js'
import { parseCodeMeta, type CodeMeta } from '../code-meta.js'
import { pageData } from '../page-data.js'

export interface CodeOptions {
  themes: { light: string; dark: string }
  /** Syntax themes of the presets a reader may pick, beyond the site's own two. */
  more?: string[]
  /** What code is drawn on, for each syntax theme in the order light, dark, then `more`. */
  backgrounds?: CodeBackgrounds
  /** The least contrast a token's colour may have against those backgrounds. Left out, colours are not changed. */
  minContrast?: number
  /** Wrap long lines unless a block says `noWrap`. */
  wrap?: boolean
  /** Number lines unless a block says `noLineNumbers`. */
  lineNumbers?: boolean
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
  /** What each theme is called on the page: `light` and `dark` for the site's own, then `t2`, `t3` and so on. */
  readonly keys: string[]
  /** Key → Shiki theme name, in the order of `keys`. */
  #themes: Record<string, string>
  #highlighter: Promise<Highlighter> | undefined
  #memo = new Map<string, Element>()
  /** Token class → its colour under each key, in the order of `keys`. */
  #colours = new Map<string, string[]>()
  #classes = new Map<string, string>()
  /** Theme index, kind of line and colour → the colour as it is written out. */
  #legible = new Map<string, string>()

  constructor(options: CodeOptions) {
    this.options = options
    const names = [options.themes.light, options.themes.dark, ...(options.more ?? [])]
    this.keys = names.map((_, index) => (index === 0 ? 'light' : index === 1 ? 'dark' : `t${index}`))
    this.#themes = Object.fromEntries(this.keys.map((key, index) => [key, names[index]!]))
  }

  /** Started lazily: sites and pages without code never pay for it. */
  #get(): Promise<Highlighter> {
    this.#highlighter ??= createHighlighter({
      themes: [...new Set(Object.values(this.#themes))],
      langs: [],
    })
    return this.#highlighter
  }

  /**
   * A colour of the theme at `index` as the page gets it: the theme's own,
   * unless that is too faint to read where it is drawn. A token is drawn on
   * the code background or, on a highlighted line, on the tint over it. The
   * themes' foregrounds are inherited by both kinds of line, so they answer
   * to both.
   */
  #readable(index: number, colour: string, on: 'code' | 'highlighted' | 'both'): string {
    const floor = this.options.minContrast ?? 0
    const all = this.options.backgrounds
    if (floor <= 1 || !all) return colour
    const code = all.code[index] ?? []
    const tinted = all.highlighted[index] ?? []
    // A tint that could not be worked out (a `highlight` colour we cannot read) leaves the plain background to go by.
    const backgrounds = on === 'both' ? [...code, ...tinted] : on === 'highlighted' && tinted.length ? tinted : code
    if (backgrounds.length === 0) return colour
    const id = `${index} ${on} ${colour}`
    let result = this.#legible.get(id)
    if (result === undefined) this.#legible.set(id, (result = ensureContrast(colour, backgrounds, floor)))
    return result
  }

  /** Forget what was highlighted before: the options changed, and blocks come out differently now. */
  forget(): void {
    this.#memo.clear()
    this.#legible.clear()
  }

  /**
   * The class for a token that has these colours, one per key. Tokens are
   * not styled inline: a page of code repeats a few dozen colour
   * combinations hundreds of times, and with a theme menu each combination
   * is a colour per theme. The name is a hash of the colours, so the same
   * combination has the same class on every page and in every build.
   */
  #classFor(colours: string[]): string {
    const id = colours.join(',')
    let name = this.#classes.get(id)
    if (!name) {
      let hash = 0x811c9dc5
      for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 0x01000193)
      name = `sbk-${(hash >>> 0).toString(36)}`
      while (this.#colours.has(name)) name += 'x' // two combinations with one hash: keep them apart
      this.#classes.set(id, name)
      this.#colours.set(name, colours)
    }
    return name
  }

  /**
   * The stylesheet for a page that uses these token classes. Each class sets
   * `--sb-tok`, which the theme's stylesheet reads as the token's colour:
   * first for the site's light theme, then for its dark one, then for each
   * theme a preset from the menu brings (`data-code` on the root element
   * says which). The rules are nested to state each condition once.
   *
   * Only the light theme's colours apply off the screen. A printed page is
   * white, whatever colour mode and preset the reader has on.
   */
  cssFor(classes: Iterable<string>): string {
    const names = [...new Set(classes)].filter((name) => this.#colours.has(name)).sort()
    if (names.length === 0) return ''
    const rules = (index: number) => names.map((name) => `.${name}{--sb-tok:${this.#colours.get(name)![index]}}`).join('')
    const dark = rules(1)
    let screen = `[data-theme=dark]{${dark}}`
    if (this.keys.length > 2) this.keys.forEach((key, index) => (screen += `:root[data-code=${key}]{${rules(index)}}`))
    // Without JavaScript nothing sets data-theme, and the page follows the device.
    return `${rules(0)}@media screen{${screen}}@media screen and (prefers-color-scheme:dark){:root:not([data-theme]){${dark}}}`
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
    const { flags } = block.meta
    const numbered = flags.has('showLineNumbers') || (this.options.lineNumbers === true && !flags.has('noLineNumbers'))
    const wrapped = flags.has('wrap') || (this.options.wrap === true && !flags.has('noWrap'))

    // The colour of code that a theme leaves alone: its foreground, for each key.
    const keys = this.keys
    const readable = (index: number, colour: string, on: 'code' | 'highlighted' | 'both') => this.#readable(index, colour, on)
    const plain = keys.map((key, index) => readable(index, highlighter.getTheme(this.#themes[key]!).fg.toLowerCase(), 'both'))
    const classFor = (colours: string[]) => this.#classFor(colours)

    const tree = highlighter.codeToHast(block.code, {
      lang,
      themes: this.#themes,
      defaultColor: false,
      transformers: [
        {
          name: 'shabd',
          line(node, line) {
            if (highlighted.has(line)) this.addClassToHast(node, 'sb-line-highlight')
          },
          // Shiki writes a token's colour in each theme as inline variables. Swap them for a class.
          // A token in the themes' own foreground is marked plain instead, so that a site's theme
          // can colour plain code itself (`colors.codeText`); it inherits its colour from the <pre>.
          span(node, line) {
            const style = typeof node.properties.style === 'string' ? node.properties.style : ''
            delete node.properties.style
            const given = new Map(
              style.split(';').map((declaration) => {
                const colon = declaration.indexOf(':')
                return [declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim().toLowerCase()] as const
              }),
            )
            const on = highlighted.has(line) ? 'highlighted' : 'code'
            const colours = keys.map((key, index) => {
              const colour = given.get(`--shiki-${key}`)
              return colour === undefined ? plain[index]! : readable(index, colour, on)
            })
            const isPlain = colours.every((colour, index) => colour === plain[index])
            this.addClassToHast(node, isPlain ? 'sb-plain' : classFor(colours))
          },
          pre(node) {
            // The foregrounds go on the <pre>, as a class like any token's. Shiki's own class list
            // names every theme, and its inline style carries backgrounds the page does not use.
            delete node.properties.style
            node.properties.class = `shiki ${classFor(plain)}`
            node.properties['data-lang'] = block.lang || 'text'
            if (block.meta.title) node.properties['data-title'] = block.meta.title
            if (numbered) node.properties['data-line-numbers'] = ''
            if (wrapped) node.properties['data-wrap'] = ''
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
  return async (tree: Root, file: VFile) => {
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

    const classes = new Set<string>()
    await Promise.all(
      blocks.map(async (block) => {
        const live = highlighter.options.sandbox && block.meta.flags.has('live') && SANDBOX_LANGUAGES.has(block.lang)
        if (live) {
          block.parent.children[block.index] = sandboxElement(block)
          return
        }
        const pre = await highlighter.highlight(block)
        block.parent.children[block.index] = pre
        visit(pre, 'element', (node) => {
          // Shiki keeps `class` as a string where it wrote one and as a list where a transformer added to it.
          const value = node.properties.class
          const names = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\s+/) : []
          for (const name of names) if (typeof name === 'string' && name.startsWith('sbk-')) classes.add(name)
        })
      }),
    )
    // The page carries the colours of exactly the tokens it shows.
    pageData(file).codeCss = highlighter.cssFor(classes)
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
