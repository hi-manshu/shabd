/**
 * What each part of a line of Markdown is, for the Studio's editor to colour.
 *
 * This is not a Markdown parser, and nothing is rendered from it. It reads one
 * line at a time and names the parts a writer looks for: the characters of the
 * syntax, headings, code, links, frontmatter keys, tags. Where Markdown's own
 * rules are subtle (which `*` opens emphasis), it takes the common reading.
 *
 * One rule is not negotiable: the pieces of a line, joined, are that line,
 * character for character. The colours are drawn behind the text being typed,
 * and a piece too many or too few would put them under the wrong letters.
 */

export type Part =
  /** The characters of the syntax itself: `#`, `*`, a backtick, `>`, a list dash, brackets. */
  | 'mark'
  | 'heading'
  /** A frontmatter key, or the name of a tag's attribute. */
  | 'key'
  | 'code'
  | 'strong'
  | 'em'
  /** Where a link goes. */
  | 'link'
  /** The name of an HTML or MDX tag. */
  | 'tag'
  /** Said about the text and not part of it: the language of a code block, the kind of a callout, a comment. */
  | 'meta'

export interface Piece {
  text: string
  part?: Part
}

/**
 * What a line is in the middle of, from the lines above it:
 * `text`, `yaml` (frontmatter), `comment` (an HTML comment),
 * or a code block, written as the run of characters that closes it.
 */
export type LineState = string

export const START: LineState = 'text'

export interface ColourOptions {
  /** `.mdx`: `{expressions}` and `import` / `export` lines are code. */
  mdx: boolean
}

/** The pieces of one line, and what the next line starts in the middle of. */
export function colourLine(line: string, state: LineState, options: ColourOptions, first = false): { pieces: Piece[]; next: LineState } {
  const out = new Pieces()

  if (state === 'yaml') {
    if (/^(---|\.\.\.)\s*$/.test(line)) return { pieces: out.add(line, 'mark').done(), next: 'text' }
    yamlLine(line, out)
    return { pieces: out.done(), next: 'yaml' }
  }

  if (state === 'comment') {
    const end = line.indexOf('-->')
    if (end === -1) return { pieces: out.add(line, 'meta').done(), next: 'comment' }
    out.add(line.slice(0, end + 3), 'meta')
    const open = inline(line.slice(end + 3), out, options)
    return { pieces: out.done(), next: open ? 'comment' : 'text' }
  }

  if (state !== 'text') {
    // In a code block. It ends at a run of the same character, at least as long, with nothing after it.
    const closing = /^(\s*)(`{3,}|~{3,})\s*$/.exec(line)
    if (closing && closing[2]![0] === state[0] && closing[2]!.length >= state.length) {
      return { pieces: out.add(line, 'mark').done(), next: 'text' }
    }
    return { pieces: out.add(line, 'code').done(), next: state }
  }

  if (first && /^---\s*$/.test(line)) return { pieces: out.add(line, 'mark').done(), next: 'yaml' }

  // Indented as far as it likes: under a list item, a code block starts where the item's text does.
  const fence = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(line)
  // A run of backticks with a backtick after it is code within a line, not the start of a block.
  if (fence && !(fence[2]![0] === '`' && fence[3]!.includes('`'))) {
    out.add(fence[1]!).add(fence[2]!, 'mark').add(fence[3]!, 'meta')
    return { pieces: out.done(), next: fence[2]! }
  }

  const heading = /^( {0,3})(#{1,6})(?=\s|$)(.*)$/.exec(line)
  if (heading) {
    out.add(heading[1]!).add(heading[2]!, 'mark').add(heading[3]!, 'heading')
    return { pieces: out.done(), next: 'text' }
  }

  // A rule (`---`, `* * *`), or the line under a heading written the other way (`===`).
  if (/^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,}|=+[ \t]*)$/.test(line)) {
    return { pieces: out.add(line, 'mark').done(), next: 'text' }
  }

  if (options.mdx && /^(import|export)\s/.test(line)) return { pieces: out.add(line, 'code').done(), next: 'text' }

  let rest = line
  const take = (pattern: RegExp, part?: Part): boolean => {
    const found = pattern.exec(rest)
    if (!found) return false
    out.add(found[0], part)
    rest = rest.slice(found[0].length)
    return true
  }

  take(/^[ \t]+/)
  let quoted = false
  while (take(/^>/, 'mark')) {
    quoted = true
    take(/^[ \t]+/)
  }
  if (quoted) take(/^\[![A-Za-z]+\]/, 'meta')
  if (take(/^(?:[-*+]|\d{1,9}[.)])(?=[ \t]|$)/, 'mark')) {
    take(/^[ \t]+/)
    if (take(/^\[[ xX]\](?=[ \t]|$)/, 'mark')) take(/^[ \t]+/)
  }

  const open = inline(rest, out, options, { table: /^\|/.test(rest) })
  return { pieces: out.done(), next: open ? 'comment' : 'text' }
}

export interface ColouredSource {
  /** The pieces of each line, in order. */
  rows: Piece[][]
  /** Each distinct line, with what it was in the middle of, for the next call to reuse. */
  lines: Map<string, { pieces: Piece[]; next: LineState }>
  mdx: boolean
}

/**
 * Every line of a source, coloured. `remembered` is the result of an earlier
 * call: a line it has, in the middle of the same thing, is not read again and
 * comes back as the very same list, so that what draws it can skip it.
 */
export function colourSource(source: string, options: ColourOptions, remembered?: ColouredSource): ColouredSource {
  const known = remembered?.mdx === options.mdx ? remembered.lines : undefined
  const lines: ColouredSource['lines'] = new Map()
  const rows: Piece[][] = []
  let state = START
  source.split('\n').forEach((line, index) => {
    const key = `${index === 0 ? '^' : ''}${state}\n${line}`
    const coloured = lines.get(key) ?? known?.get(key) ?? colourLine(line, state, options, index === 0)
    lines.set(key, coloured)
    rows.push(coloured.pieces)
    state = coloured.next
  })
  return { rows, lines, mdx: options.mdx }
}

/* ───────────────────────────── the pieces ────────────────────────── */

class Pieces {
  #pieces: Piece[] = []

  add(text: string, part?: Part): this {
    if (text === '') return this
    const last = this.#pieces.at(-1)
    if (last && last.part === part) last.text += text
    else this.#pieces.push(part ? { text, part } : { text })
    return this
  }

  done(): Piece[] {
    return this.#pieces
  }
}

/* ──────────────────────────── frontmatter ────────────────────────── */

function yamlLine(line: string, out: Pieces): void {
  if (/^\s*#/.test(line)) return void out.add(line, 'meta')

  // `key: value`, also as the first key of a list item (`- key: value`).
  const pair = /^(\s*)((?:-\s+)*)([^\s:#'"[{][^:#]*?|"[^"]*"|'[^']*')(\s*:)(?=\s|$)(.*)$/.exec(line)
  if (pair) {
    out.add(pair[1]!).add(pair[2]!, 'mark').add(pair[3]!, 'key').add(pair[4]!, 'mark')
    return yamlValue(pair[5]!, out)
  }
  const item = /^(\s*)(-)(\s+.*|)$/.exec(line)
  if (item) {
    out.add(item[1]!).add(item[2]!, 'mark')
    return yamlValue(item[3]!, out)
  }
  yamlValue(line, out)
}

/** A value, and the comment after it if it has one. A `#` inside quotes is not a comment. */
function yamlValue(value: string, out: Pieces): void {
  let quote = ''
  for (let at = 0; at < value.length; at++) {
    const char = value[at]!
    if (quote) {
      if (char === quote) quote = ''
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (char === '#' && (at === 0 || /\s/.test(value[at - 1]!))) {
      out.add(value.slice(0, at)).add(value.slice(at), 'meta')
      return
    }
  }
  out.add(value)
}

/* ───────────────────────────── within a line ─────────────────────── */

const PUNCTUATION = /[!-/:-@[-`{-~]/
/** How far ahead a closing bracket, backtick or asterisk is looked for. A line of thousands of them is not read thousands of times. */
const REACH = 2000
const WORD = /[\p{L}\p{N}]/u
const URL_AT = /https?:\/\/[^\s<>]+/y
const AUTOLINK_AT = /<((?:https?:\/\/|mailto:)[^\s<>]+)>/y
const TAG_AT = /<(\/?)([A-Za-z][\w.:-]*)((?:\s+[\w:.-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|\{[^{}]*\}|[^\s"'=<>`{}]+))?)*)(\s*)(\/?)>/y
const FRAGMENT_AT = /<\/?>/y
const ATTRIBUTE = /(\s+)([\w:.-]+)(?:(\s*=\s*)("[^"]*"|'[^']*'|\{[^{}]*\}|[^\s"'=<>`{}]+))?/g

/**
 * Colour the text of a line, after whatever opened it (a list dash, a quote).
 * Returns true when the line ends inside an HTML comment.
 */
function inline(text: string, out: Pieces, options: ColourOptions, context: { table?: boolean; base?: Part } = {}): boolean {
  const { base } = context
  let at = 0
  let plainFrom = 0
  const flush = (upTo: number) => {
    out.add(text.slice(plainFrom, upTo), base)
  }
  /** Leave the plain text before `at` as it is, and go on after the `length` characters just handled. */
  const handled = (length: number) => {
    at += length
    plainFrom = at
  }

  while (at < text.length) {
    const char = text[at]!

    if (char === '\\' && at + 1 < text.length && PUNCTUATION.test(text[at + 1]!)) {
      at += 2
      continue
    }

    if (char === '`') {
      const run = runLength(text, at, '`')
      const close = closingRun(text, at + run, '`', run)
      if (close !== -1) {
        flush(at)
        out.add(text.slice(at, at + run), 'mark').add(text.slice(at + run, close), 'code').add(text.slice(close, close + run), 'mark')
        handled(close + run - at)
        continue
      }
      at += run
      continue
    }

    if (char === '<') {
      if (text.startsWith('<!--', at)) {
        flush(at)
        const end = text.indexOf('-->', at + 4)
        if (end === -1) {
          out.add(text.slice(at), 'meta')
          return true
        }
        out.add(text.slice(at, end + 3), 'meta')
        handled(end + 3 - at)
        continue
      }
      const autolink = matchAt(AUTOLINK_AT, text, at)
      if (autolink) {
        flush(at)
        out.add('<', 'mark').add(autolink[1]!, 'link').add('>', 'mark')
        handled(autolink[0].length)
        continue
      }
      const fragment = matchAt(FRAGMENT_AT, text, at)
      if (fragment) {
        flush(at)
        out.add(fragment[0], 'mark')
        handled(fragment[0].length)
        continue
      }
      const tag = matchAt(TAG_AT, text, at)
      if (tag) {
        flush(at)
        out.add(`<${tag[1]!}`, 'mark').add(tag[2]!, 'tag')
        let used = 0
        for (const attribute of tag[3]!.matchAll(ATTRIBUTE)) {
          out.add(tag[3]!.slice(used, attribute.index)).add(attribute[1]!).add(attribute[2]!, 'key')
          if (attribute[3] !== undefined) out.add(attribute[3], 'mark').add(attribute[4]!, 'code')
          used = attribute.index + attribute[0].length
        }
        out.add(tag[3]!.slice(used)).add(tag[4]!).add(`${tag[5]!}>`, 'mark')
        handled(tag[0].length)
        continue
      }
      at++
      continue
    }

    if (char === '[' || (char === '!' && text[at + 1] === '[')) {
      const bracket = char === '!' ? at + 1 : at
      const closed = matching(text, bracket, '[', ']')
      if (closed !== -1) {
        const after = text[closed + 1]
        const target = after === '(' ? matching(text, closed + 1, '(', ')') : after === '[' ? matching(text, closed + 1, '[', ']') : -1
        if (target !== -1) {
          flush(at)
          out.add(text.slice(at, bracket + 1), 'mark')
          inline(text.slice(bracket + 1, closed), out, options, base ? { base } : {})
          out.add(text.slice(closed, closed + 2), 'mark').add(text.slice(closed + 2, target), 'link').add(text[target]!, 'mark')
          handled(target + 1 - at)
          continue
        }
      }
      at++
      continue
    }

    if (char === '*' || char === '_') {
      const run = runLength(text, at, char)
      const before = at > 0 ? text[at - 1]! : ' '
      const next = text[at + run]
      // It opens when text follows it. An underscore inside a word (snake_case) opens nothing.
      const opens = run <= 3 && next !== undefined && !/\s/.test(next) && !(char === '_' && WORD.test(before))
      const close = opens ? closingEmphasis(text, at + run, char, run) : -1
      if (close !== -1) {
        flush(at)
        out.add(text.slice(at, at + run), 'mark')
        inline(text.slice(at + run, close), out, options, { base: run >= 2 ? 'strong' : 'em' })
        out.add(text.slice(close, close + run), 'mark')
        handled(close + run - at)
        continue
      }
      at += run
      continue
    }

    if (char === '~' && text[at + 1] === '~') {
      const close = text.indexOf('~~', at + 2)
      if (close !== -1 && close > at + 2) {
        flush(at)
        out.add('~~', 'mark')
        inline(text.slice(at + 2, close), out, options, base ? { base } : {})
        out.add('~~', 'mark')
        handled(close + 2 - at)
        continue
      }
      at += 2
      continue
    }

    if (char === '{' && options.mdx) {
      const closed = matching(text, at, '{', '}')
      if (closed !== -1) {
        flush(at)
        out.add(text.slice(at, closed + 1), 'code')
        handled(closed + 1 - at)
        continue
      }
      at++
      continue
    }

    if (char === '|' && context.table) {
      flush(at)
      out.add('|', 'mark')
      handled(1)
      continue
    }

    if (char === 'h' && (at === 0 || !WORD.test(text[at - 1]!))) {
      const url = matchAt(URL_AT, text, at)
      if (url) {
        // A full stop or a bracket that ends the sentence is not part of the address.
        const address = url[0].replace(/[.,;:!?)\]'"]+$/, '')
        flush(at)
        out.add(address, 'link')
        handled(address.length)
        continue
      }
    }

    at++
  }

  flush(text.length)
  return false
}

function matchAt(pattern: RegExp, text: string, at: number): RegExpExecArray | null {
  pattern.lastIndex = at
  return pattern.exec(text)
}

function runLength(text: string, at: number, char: string): number {
  let end = at
  while (text[end] === char) end++
  return end - at
}

/** Where a run of exactly `length` of `char` starts, at or after `from`. -1 if there is none. */
function closingRun(text: string, from: number, char: string, length: number): number {
  let at = from
  const end = Math.min(text.length, from + REACH)
  while (at < end) {
    if (text[at] !== char) {
      at++
      continue
    }
    const run = runLength(text, at, char)
    if (run === length) return at
    at += run
  }
  return -1
}

/** Where the run that closes emphasis starts: the same characters, with text right before them. */
function closingEmphasis(text: string, from: number, char: string, length: number): number {
  let at = from
  const end = Math.min(text.length, from + REACH)
  while (at < end) {
    if (text[at] === '\\') {
      at += 2
      continue
    }
    if (text[at] === '`') {
      // Code is not looked into: a `*` in it closes nothing.
      const run = runLength(text, at, '`')
      const close = closingRun(text, at + run, '`', run)
      at = close === -1 ? at + run : close + run
      continue
    }
    if (text[at] !== char) {
      at++
      continue
    }
    const run = runLength(text, at, char)
    const after = text[at + run]
    const closes = run === length && at > from && !/\s/.test(text[at - 1]!) && !(char === '_' && after !== undefined && WORD.test(after))
    if (closes) return at
    at += run
  }
  return -1
}

/** Where the bracket opened at `open` is closed, counting the ones opened inside it. -1 if it is not. */
function matching(text: string, open: number, opener: string, closer: string): number {
  let depth = 0
  const end = Math.min(text.length, open + REACH)
  for (let at = open; at < end; at++) {
    const char = text[at]
    if (char === '\\') at++
    else if (char === opener) depth++
    else if (char === closer && --depth === 0) return at
  }
  return -1
}
