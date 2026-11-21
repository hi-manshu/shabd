/**
 * Text from an OpenAPI description, written into a page.
 *
 * The text is somebody else's. It is of two kinds, and each has its own way
 * in:
 *
 *   plain text   a summary, a name, a value. Whatever would mean something
 *                in Markdown is escaped (`escapeText`), or the text is
 *                written as code (`code`).
 *   Markdown     every `description`, which OpenAPI says is CommonMark. It
 *                is kept as it is written (`keep`, `inline`), apart from
 *                what a page could not hold.
 *
 * What a page could not hold: HTML, which a `.md` page drops without a word
 * and an `.mdx` page refuses, so `<` is escaped and the reader sees what was
 * written. A brace, which is an expression in MDX and half of a variable in
 * Shabd. A dollar sign, which is maths on a site that has maths on. A
 * picture with a relative path, which the build would try to import from a
 * folder that does not exist. A code block that is never closed, which would
 * take the rest of the page into its code.
 *
 * Descriptions are read with the parser that pages are compiled with, so
 * what is taken for code here is what will be code on the page.
 */
import { createProcessor } from '@mdx-js/mdx'
import type { Code, Heading, Nodes, Root } from 'mdast'
import remarkGfm from 'remark-gfm'
import { SKIP, visit } from 'unist-util-visit'
import { stringify } from 'yaml'

/* ──────────────────────────────── plain text ──────────────────────────── */

/** Text on one line: a line break in a title or a table cell would end it. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Text that ends its sentence, so that the sentence written after it does not run on from it. */
export function ended(text: string): string {
  return text === '' || /[.!?:;…]$/.test(text) ? text : `${text}.`
}

/** Plain text as Markdown that shows the same characters and means nothing more. */
export function escapeText(text: string): string {
  return (
    text
      .replace(/[\\`*[\]<>{}$~|]/g, '\\$&')
      // An underscore inside a word is only an underscore, and API names are full of them.
      .replace(/(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu, '\\_')
      // `&amp;` would be read as the character it names.
      .replace(/&(?=#?\w+;)/g, '\\&')
      // A `#` that could open a heading, or close one.
      .replace(/(^|\s)#/g, '$1\\#')
      // What would start a list or underline a heading, were it first on its line.
      .replace(/^[+=-]/, '\\$&')
      .replace(/^(\d+)([.)])/, '$1\\$2')
  )
}

/** The longest run of backticks in a text. Code is marked off by a longer one. */
const longestRun = (text: string) => Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length))

/**
 * Text as code: `like this`. Nothing inside code is read as Markdown, which
 * is why names and values from a description are written this way.
 *
 * Two things cannot be written as code. `{{` is where a variable of the site
 * starts, and code has no way to escape it. And in a table a backslash before
 * a `|` is taken as escaping it, even in code, so the backslash would be
 * lost. Text with either is written plain, and escaped.
 */
export function code(text: string): string {
  const flat = text.replace(/\s/g, ' ')
  if (flat.trim() === '') return ''
  if (flat.includes('{{') || flat.includes('\\|')) return escapeText(flat)
  const ticks = '`'.repeat(longestRun(flat) + 1)
  // A space each side is taken off again when the code is read, and keeps a backtick at either end apart from the marks.
  const pad = flat.startsWith('`') || flat.endsWith('`') || (flat.startsWith(' ') && flat.endsWith(' ')) ? ' ' : ''
  return `${ticks}${pad}${flat}${pad}${ticks}`
}

/**
 * A value as it is written: text as it stands, anything else as JSON. Text
 * that could be taken for something else (an empty string, `true`, `12`, text
 * with a space at either end or a line break in it) is written as JSON too,
 * in its quotes.
 */
export function literal(value: unknown): string {
  if (
    typeof value === 'string' &&
    value !== '' &&
    value.trim() === value &&
    !/[\u0000-\u001F\u007F]/.test(value) &&
    !/^(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)$/.test(value)
  ) {
    return value
  }
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    // A value that holds itself, which YAML can write and JSON cannot.
    return ''
  }
}

/* ─────────────────────────────── descriptions ─────────────────────────── */

type Parser = ReturnType<typeof createProcessor>
let parser: Parser | undefined

/** The Markdown of a description as a tree, with where each part is written. */
function parse(markdown: string): Root {
  parser ??= createProcessor({ format: 'md', remarkPlugins: [remarkGfm] })
  return parser.parse(markdown) as Root
}

interface Edit {
  from: number
  to: number
  text: string
}

export interface KeepOptions {
  /** The shallowest heading the description may have: 3 puts its headings under a `##` of the page. */
  headings: number
  /** Called with the address of each picture that had to be left out. */
  dropped?: ((url: string) => void) | undefined
}

/** What needs a closer look: anything that is escaped, a picture, a fence, a line MDX would take for an import. */
const CARE = /[<{$]|!\[|^[ \t>]*(?:`{3,}|~{3,})|^(?:import|export)\s/m
/** A `#` heading, also inside a quote or a list, or the line under a heading that is underlined. */
const HEADING = /^[ \t>*+\-\d.)]*#|^[ \t>]*(?:=+|-+)[ \t]*$/m
const COMMENT = /^<!--[\s\S]*?-->\s*$/
/** The pictures a page can show as they are: the build imports every other one as a file beside the page. */
const SHOWN = /^(?:https?:)?\//
const LANGUAGE = /^[\w#+.-]+$/

/**
 * A description that stands on its own lines, kept as it is written. Its
 * headings are moved down so that they sit below the page's own.
 */
export function keep(markdown: string, options: KeepOptions): string {
  let text = markdown
    .replace(/\r\n?/g, '\n')
    .replace(/^(?:[ \t]*\n)+/, '')
    .trimEnd()
  if (CARE.test(text)) text = defuse(text, options.dropped)
  if (HEADING.test(text)) text = demote(text, options.headings)
  return text
}

/**
 * A description on one line, for a table cell or a list item. Line breaks
 * become spaces, so a list or a code block inside it reads as running text.
 */
export function inline(markdown: string, dropped?: (url: string) => void): string {
  // A backslash that ends a line is a line break, and would be left behind as a backslash.
  const flat = oneLine(markdown.replace(/\\\r?\n/g, '\n'))
  if (!CARE.test(flat)) return flat
  // With a word in front, the line is running text whatever it starts with, which is how a table cell reads it.
  return defuse(`x ${flat}`, dropped).slice(2)
}

/** The first sentence of a description as plain text, for a page's `description`. */
export function firstSentence(markdown: string): string {
  const paragraph = parse(markdown.replace(/\r\n?/g, '\n')).children.find((node) => node.type === 'paragraph')
  const text = oneLine(paragraph ? plainText(paragraph) : '')
  // A full stop ends a sentence when a capital or the end follows: `v1.2` and `e.g. this` do not.
  const end = /[.!?](?=\s+[\p{Lu}\p{N}"'(]|$)/u.exec(text)
  const sentence = end ? text.slice(0, end.index + 1) : text
  if (sentence.length <= 200) return sentence
  const space = sentence.lastIndexOf(' ', 200)
  return `${sentence.slice(0, space > 0 ? space : 200)}…`
}

function plainText(node: Nodes): string {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value
  if (node.type === 'image' || node.type === 'imageReference') return node.alt ?? ''
  if (node.type === 'break') return ' '
  return 'children' in node ? node.children.map(plainText).join('') : ''
}

/**
 * Make a description safe to stand in a page. Code is left alone, a few
 * things are written another way, and in everything between them `<`, `{`
 * and `$` are escaped.
 */
function defuse(source: string, dropped: KeepOptions['dropped']): string {
  const tree = parse(source)
  const definitions = new Map<string, string>()
  visit(tree, 'definition', (node) => void definitions.set(node.identifier, node.url))

  const edits: Edit[] = []
  visit(tree, (node, _index, parent) => {
    const from = node.position?.start.offset
    const to = node.position?.end.offset
    // A link GFM made out of bare text after the fact has no place in the source: it is escaped with the text it is in.
    if (from === undefined || to === undefined) return undefined
    const written = source.slice(from, to)
    const write = (text: string) => {
      edits.push({ from, to, text })
      return SKIP
    }

    if (node.type === 'inlineCode') return write(node.value.includes('{{') ? escapeText(oneLine(node.value)) : written)
    if (node.type === 'code') return write(fencedCode(node, source, from))
    // A comment is not for the reader. Any other HTML is escaped below, and shown.
    if (node.type === 'html' && COMMENT.test(written)) return write('')

    if (node.type === 'link' && !written.startsWith('[')) {
      // `<https://…>` is an element to MDX. A bare address is a link as it stands, unless escaping would write a backslash into it.
      if (!written.startsWith('<') && !/[{$]/.test(written)) return undefined
      return write(`[${escapeText(written.replace(/^<|>$/g, ''))}](${destination(node.url)})`)
    }

    if (node.type === 'image' || node.type === 'imageReference') {
      const url = node.type === 'image' ? node.url : definitions.get(node.identifier)
      if (url === undefined || SHOWN.test(url)) return undefined
      dropped?.(url)
      return write(escapeText(oneLine(node.alt ?? '')))
    }

    // MDX reads a line that starts this way as JavaScript. A character reference shows the same letter and is not one.
    if (node.type === 'paragraph' && parent === tree && /^(?:import|export)\s/.test(written)) {
      edits.push({ from, to: from + 1, text: `&#${written.charCodeAt(0)};` })
    }
    return undefined
  })

  let out = ''
  let at = 0
  for (const edit of edits.sort((a, b) => a.from - b.from)) {
    out += escapeBetween(source.slice(at, edit.from)) + edit.text
    at = edit.to
  }
  return out + escapeBetween(source.slice(at))
}

/** Escape what is not code. A backslash keeps the character after it, so what is escaped already is not escaped twice. */
function escapeBetween(text: string): string {
  return text.replace(/\\[\s\S]|[<{$]/g, (match) => (match.length === 2 ? match : `\\${match}`))
}

/**
 * A code block of a description, written again as a fence that nothing in
 * its code can close.
 *
 * Writing it again settles three things at once. A fence that was never
 * closed is closed, where it would have taken the rest of the page into its
 * code. Code that was only indented becomes a fence, because indenting means
 * nothing in MDX. And a line of backticks inside the code, which Markdown
 * and MDX do not close a fence on in the same way, closes it in neither.
 *
 * A fence keeps its language and loses what follows it: there a page says
 * how its code is shown (`title=`, `live`), and that is for the site to say,
 * not for the description.
 */
function fencedCode(node: Code, source: string, from: number): string {
  // What the lines of the block start with: the `>` of a quote, or the space a list item is indented by.
  const lead = source.slice(source.lastIndexOf('\n', from - 1) + 1, from).replace(/[^\s>]/g, ' ')
  const lang = node.lang && LANGUAGE.test(node.lang) ? node.lang : ''
  const info = node.value.includes('{{') ? `${lang || 'text'} noVars` : lang
  const ticks = '`'.repeat(Math.max(3, longestRun(node.value) + 1))
  const lines = node.value === '' ? [] : node.value.split('\n').map((line) => (line ? lead + line : lead.trimEnd()))
  return [`${ticks}${info}`, ...lines, `${lead}${ticks}`].join('\n')
}

/** A link whose text is plain text. */
export function link(text: string, url: string): string {
  return `[${escapeText(oneLine(text))}](${destination(url)})`
}

/**
 * An address as the target of a link, where nothing in it can end the link
 * or start something else: a bracket, a space, a brace. What an address may
 * hold as it stands is kept, and the rest is written as percent-escapes.
 */
function destination(url: string): string {
  return [...url]
    .map((char) => {
      if (/[\w\-.~:/?#[\]@!&'*+,;=%]/.test(char)) return char
      // By hand for ASCII: `encodeURIComponent` leaves `(` and `)` as they are, and they are the ones that end a link.
      if (char.charCodeAt(0) < 0x80) return `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`
      try {
        return encodeURIComponent(char)
      } catch {
        // Half of a surrogate pair, which has no encoding.
        return ''
      }
    })
    .join('')
}

/** Move a description's headings down, so that its shallowest is at `shallowest`. They keep their order among themselves. */
function demote(source: string, shallowest: number): string {
  const headings: Heading[] = []
  visit(parse(source), 'heading', (node) => void headings.push(node))
  const shift = shallowest - Math.min(...headings.map((heading) => heading.depth))
  if (headings.length === 0 || shift <= 0) return source

  let out = source
  // From the last to the first, so that where the earlier ones are written does not move.
  for (const heading of headings.reverse()) {
    const from = heading.position?.start.offset
    const to = heading.position?.end.offset
    if (from === undefined || to === undefined) continue
    const written = out.slice(from, to)
    const marks = '#'.repeat(Math.min(6, heading.depth + shift))
    const rest = written.startsWith('#') ? written.replace(/^#+/, '') : ` ${underlined(written)}`
    out = out.slice(0, from) + marks + rest + out.slice(to)
  }
  return out
}

/** The text of a heading that is written as a line with `===` or `---` under it. */
function underlined(written: string): string {
  const lines = written.split('\n').slice(0, -1)
  const text = lines.map((line) => line.replace(/^[ \t>]+/, '').trimEnd()).join(' ')
  // At the end of a `#` heading, a run of `#` would be taken for its closing marks.
  return text.replace(/(^|\s)(#+)$/, '$1\\$2')
}

/* ─────────────────────────────── page parts ───────────────────────────── */

/** A table. A line break would end a row and a `|` would end a cell, wherever it is written, even in code. */
export function table(headings: string[], rows: string[][]): string {
  const cell = (text: string) => text.replace(/\s*\n\s*/g, ' ').replace(/\\[\s\S]|\|/g, (match) => (match === '|' ? '\\|' : match))
  const row = (cells: string[]) => `| ${cells.map(cell).join(' | ')} |`
  return [row(headings), `|${headings.map(() => ' --- ').join('|')}|`, ...rows.map(row)].join('\n')
}

/**
 * A code block. The fence is longer than any run of backticks in the code,
 * so nothing in the code can close it. Code with `{{` in it says `noVars`:
 * it is the API's text, and a variable of the site has no business in it.
 */
export function fence(text: string, info: string): string {
  const body = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '')
  const ticks = '`'.repeat(Math.max(3, longestRun(body) + 1))
  return `${ticks}${body.includes('{{') ? `${info} noVars` : info}\n${body}\n${ticks}`
}

/** A frontmatter block. YAML is written by the YAML library, whatever the values hold. */
export function frontmatter(data: Record<string, unknown>): string {
  // No folding: a long description stays on its line.
  return `---\n${stringify(data, { lineWidth: 0 })}---\n`
}
