/**
 * Text helpers shared by the four importers.
 *
 * Markdown is converted line by line, not through a parser: a parser would
 * write the whole page out again in its own style, and an import should
 * change only the lines it has a reason to change. Every line remembers its
 * number in the source file, so a note can say where something is, and
 * whether it is inside a code fence, which nothing here ever rewrites.
 */
import { slug as headingSlug } from 'github-slugger'
import { MESSAGES, type Note } from './types.js'

export interface Line {
  text: string
  /** Line in the source file, 1-based. A line the importer adds carries the number of the line it came from. */
  number: number
  /** Inside a code fence, or one of its two delimiters. */
  code: boolean
  /** Set on the two delimiters of a fence. */
  fence?: 'open' | 'close' | undefined
  /** Set on the first and last line of a block the importer wrote, which need an empty line around them. */
  edge?: 'start' | 'end' | undefined
}

/* ─────────────────────────────── lines ──────────────────────────────── */

/** A fence may sit inside a quote or a list, so `>` and any indentation may come before it. */
const FENCE = /^([ \t>]*)(`{3,}|~{3,})(.*)$/

/** Say which lines are code. Call it again after lines have been moved or unindented. */
export function markCode(lines: Pick<Line, 'text' | 'number' | 'edge'>[]): Line[] {
  let open: { char: string; length: number } | undefined
  return lines.map(({ text, number, edge }) => {
    const line = edge ? { text, number, edge } : { text, number }
    const fence = FENCE.exec(text)
    const marker = fence?.[2] ?? ''
    const rest = fence?.[3] ?? ''
    if (open) {
      const closes = fence !== null && marker[0] === open.char && marker.length >= open.length && rest.trim() === ''
      if (closes) open = undefined
      return closes ? { ...line, code: true, fence: 'close' } : { ...line, code: true }
    }
    // The text after a backtick fence cannot hold a backtick: that is inline code at the start of a line.
    if (fence && !(marker[0] === '`' && rest.includes('`'))) {
      open = { char: marker[0]!, length: marker.length }
      return { ...line, code: true, fence: 'open' }
    }
    return { ...line, code: false }
  })
}

export function toLines(text: string, first = 1): Line[] {
  return markCode(text.split('\n').map((line, index) => ({ text: line, number: first + index })))
}

export function fromLines(lines: Line[]): string {
  return lines.map((line) => line.text).join('\n')
}

const isBlank = (line: Line) => line.text.trim() === ''

/** Without the empty lines at either end. */
export function trimBlank(lines: Line[]): Line[] {
  let start = 0
  let end = lines.length
  while (start < end && isBlank(lines[start]!)) start++
  while (end > start && isBlank(lines[end - 1]!)) end--
  return lines.slice(start, end)
}

/**
 * Put an empty line around the blocks the importer wrote where the source
 * had none. Without one, the paragraph after a quoted callout would be read
 * as more of the quote, and a `<Tabs>` after a paragraph as part of it.
 */
export function spaceBlocks(lines: Line[]): Line[] {
  const out: Line[] = []
  lines.forEach((line, index) => {
    const { edge, ...plain } = line
    const empty: Line = { text: '', number: line.number, code: false }
    if (edge === 'start' && out.length > 0 && !isBlank(out.at(-1)!)) out.push(empty)
    out.push(plain)
    const next = lines[index + 1]
    if (edge === 'end' && next && !isBlank(next)) out.push(empty)
  })
  return out
}

/** Change the text after the language of each code fence. `change` returns undefined to leave a fence alone. */
export function mapFences(lines: Line[], change: (info: string, line: Line) => string | undefined): Line[] {
  return lines.map((line) => {
    if (line.fence !== 'open') return line
    const [, before = '', marker = '', info = ''] = FENCE.exec(line.text) ?? []
    const changed = change(info.trim(), line)
    return changed === undefined || changed === info.trim() ? line : { ...line, text: `${before}${marker}${changed}` }
  })
}

/* ──────────────────────────── inline code ───────────────────────────── */

/** Where the inline code spans of a line are: `[start, end)` pairs, backticks included. */
export function codeSpans(text: string): [number, number][] {
  const spans: [number, number][] = []
  let at = 0
  while (at < text.length) {
    const start = text.indexOf('`', at)
    if (start === -1) break
    let length = 1
    while (text[start + length] === '`') length++
    // A span closes at the next run of exactly as many backticks.
    let search = start + length
    let close = -1
    while (search < text.length) {
      const next = text.indexOf('`', search)
      if (next === -1) break
      let run = 1
      while (text[next + run] === '`') run++
      if (run === length) {
        close = next
        break
      }
      search = next + run
    }
    if (close === -1) {
      at = start + length
      continue
    }
    spans.push([start, close + length])
    at = close + length
  }
  return spans
}

/** Apply `change` to the parts of a line that are not inline code. */
export function mapProse(text: string, change: (prose: string) => string): string {
  let out = ''
  let at = 0
  for (const [start, end] of codeSpans(text)) {
    out += change(text.slice(at, start)) + text.slice(start, end)
    at = end
  }
  return out + change(text.slice(at))
}

/* ─────────────────────────────── alerts ─────────────────────────────── */

export const ALERTS = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'] as const
export type Alert = (typeof ALERTS)[number]

/**
 * A callout title is read from one run of plain text. Markdown inside it
 * would cut the title short and push the rest into the body, so formatting
 * is unwrapped and what could still start some is escaped.
 */
export function plainTitle(title: string): string {
  return title
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(`+)(.+?)\1/g, '$2')
    .replace(/(\*\*|__|~~)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])\*([^*\s][^*]*)\*/g, '$1$2')
    .replace(/(^|\W)_([^_\s][^_]*)_(?=\W|$)/g, '$1$2')
    .replace(/[*`[\]<]/g, '\\$&')
    .replace(/\s+/g, ' ')
    .trim()
}

/** A GitHub alert: `> [!NOTE] Title`, with the body quoted under it. */
export function alert(type: Alert, title: string | undefined, body: Line[], open: Line, indent = ''): Line[] {
  const heading = title ? plainTitle(title) : ''
  const lines: Line[] = [
    { text: `${indent}> [!${type}]${heading ? ` ${heading}` : ''}`, number: open.number, code: false },
    ...spaceBlocks(trimBlank(body)).map((line) => ({ ...line, text: isBlank(line) ? `${indent}>` : `${indent}> ${line.text}` })),
  ]
  lines[lines.length - 1] = { ...lines.at(-1)!, edge: 'end' }
  return lines
}

/* ──────────────────────────────── tabs ──────────────────────────────── */

/** The value of a JSX attribute, between double quotes. */
export function attribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/\s+/g, ' ').trim()
}

/**
 * Shabd's tabs. The tags stand on lines of their own with an empty line
 * around the content, which is what MDX needs to read the content as
 * Markdown. Nothing is indented, so code inside a tab keeps its own
 * indentation.
 */
export function tabs(items: { label: string; body: Line[] }[], open: Line, indent = ''): Line[] {
  const at = (text: string): Line => ({ text: text ? indent + text : '', number: open.number, code: false })
  const out: Line[] = [{ ...at('<Tabs>'), edge: 'start' }]
  for (const item of items) {
    out.push(at(`<Tab label="${attribute(item.label)}">`), at(''), ...spaceBlocks(trimBlank(item.body)), at(''), at('</Tab>'))
  }
  out.push({ ...at('</Tabs>'), edge: 'end' })
  return out
}

/* ───────────────────────────── containers ───────────────────────────── */

const CONTAINER_OPEN = /^(\s*)(:{3,})[ \t]*([A-Za-z][\w-]*)(.*)$/
const CONTAINER_CLOSE = /^(\s*)(:{3,})[ \t]*$/

/** A `:::name` block, as Docusaurus, VitePress and Starlight write callouts. */
export interface Container {
  name: string
  /** What follows the name on the opening line: `A title`, `[A title]`, `{attributes}`. */
  rest: string
  indent: string
  open: Line
  /** The lines inside, already converted, without the block's own indentation. */
  body: Line[]
}

/**
 * Find `:::` blocks and replace each with what `convert` returns. Blocks
 * inside blocks are converted first. `convert` returns undefined for a block
 * it does not know, which is then left exactly as it was.
 */
export function convertContainers(lines: Line[], convert: (container: Container) => Line[] | undefined): Line[] {
  interface Frame {
    name: string
    rest: string
    indent: string
    colons: number
    open: Line
    body: Line[]
  }
  const out: Line[] = []
  const stack: Frame[] = []
  const emit = (items: Line[]) => (stack.at(-1)?.body ?? out).push(...items)
  const close = (closer?: Line) => {
    const frame = stack.pop()!
    const body = frame.body.map((line) =>
      frame.indent && line.text.startsWith(frame.indent) ? { ...line, text: line.text.slice(frame.indent.length) } : line,
    )
    const { name, rest, indent, open } = frame
    emit(convert({ name, rest, indent, open, body }) ?? [frame.open, ...frame.body, ...(closer ? [closer] : [])])
  }

  for (const line of lines) {
    if (!line.code) {
      const open = CONTAINER_OPEN.exec(line.text)
      if (open) {
        stack.push({ name: open[3]!, rest: open[4]!.trim(), indent: open[1]!, colons: open[2]!.length, open: line, body: [] })
        continue
      }
      const closer = CONTAINER_CLOSE.exec(line.text)
      const top = stack.at(-1)
      if (closer && top && closer[2]!.length >= top.colons) {
        close(line)
        continue
      }
    }
    emit([line])
  }
  // A block left open runs to the end of the page, as it does in the source tools.
  while (stack.length) close()
  return out
}

/** The title on a container's opening line: `A title`, or `[A title]` as directives write it. Attributes in braces are not part of it. */
export function containerTitle(rest: string): string | undefined {
  const label = /^\[([^\]]*)\]/.exec(rest)
  const title = (label ? label[1]! : rest.replace(/\{[^}]*\}\s*$/, '')).trim()
  return title || undefined
}

/**
 * A container as a GitHub alert, for the tools that write callouts as
 * `:::type`. `types` maps the tool's names to Shabd's five. A name that is
 * not in `plain` has no counterpart with the same meaning, so it keeps its
 * own name as the title: `:::details` stays "Details". A container that is
 * not a callout is left as it is, which `notes` is told.
 */
export function containerAlert(
  container: Container,
  types: Readonly<Record<string, Alert>>,
  plain: ReadonlySet<string>,
  notes: Note[],
): Line[] | undefined {
  const name = container.name.toLowerCase()
  const type = types[name]
  if (!type) {
    notes.push({ kind: 'manual', message: MESSAGES.container(container.name), line: container.open.number })
    return undefined
  }
  notes.push({ kind: 'converted', what: 'callout', line: container.open.number })
  const title = containerTitle(container.rest) ?? (plain.has(name) ? undefined : name.charAt(0).toUpperCase() + name.slice(1))
  return alert(type, title, container.body, container.open, container.indent)
}

/* ──────────────────────────────── tags ──────────────────────────────── */

export interface Tag {
  name: string
  closing: boolean
  selfClosing: boolean
  /** Attributes in the order written. A value keeps its quotes or braces; a bare attribute has none. */
  attrs: [name: string, value: string | undefined][]
  /** Offset just past the tag's `>`. */
  end: number
}

/** The offset just past the `}` that closes the `{` at `start`, or -1. Strings inside may hold braces of their own. */
function closingBrace(text: string, start: number): number {
  let depth = 0
  for (let at = start; at < text.length; at++) {
    const char = text[at]!
    if (char === '"' || char === "'" || char === '`') {
      at++
      while (at < text.length && text[at] !== char) at += text[at] === '\\' ? 2 : 1
    } else if (char === '{') {
      depth++
    } else if (char === '}') {
      depth--
      if (depth === 0) return at + 1
    }
  }
  return -1
}

/** Read the HTML or JSX tag that starts at `start`, where there is a `<`. Undefined when what follows is not a tag. */
export function readTag(text: string, start: number): Tag | undefined {
  const head = /^<(\/?)([A-Za-z][\w.:-]*)/.exec(text.slice(start, start + 80))
  if (!head) return undefined
  const attrs: Tag['attrs'] = []
  let at = start + head[0].length
  for (;;) {
    const space = /^\s*/.exec(text.slice(at))![0].length
    at += space
    if (text.startsWith('/>', at)) return { name: head[2]!, closing: false, selfClosing: true, attrs, end: at + 2 }
    if (text[at] === '>') return { name: head[2]!, closing: head[1] === '/', selfClosing: false, attrs, end: at + 1 }
    if (at >= text.length || (space === 0 && attrs.length > 0 && text[at] !== '{')) return undefined
    if (text[at] === '{') {
      // `{...props}`
      const end = closingBrace(text, at)
      if (end === -1) return undefined
      attrs.push(['...', text.slice(at, end)])
      at = end
      continue
    }
    const name = /^[^\s=/>{}"'<]+/.exec(text.slice(at))?.[0]
    if (!name || (space === 0 && attrs.length === 0)) return undefined
    at += name.length
    const equals = /^\s*=\s*/.exec(text.slice(at))?.[0]
    if (!equals) {
      attrs.push([name, undefined])
      continue
    }
    at += equals.length
    const quote = text[at]
    let end: number
    if (quote === '"' || quote === "'") {
      end = text.indexOf(quote, at + 1) + 1
      if (end === 0) return undefined
    } else if (quote === '{') {
      end = closingBrace(text, at)
      if (end === -1) return undefined
    } else {
      end = at + (/^[^\s>]+/.exec(text.slice(at))?.[0].length ?? 0)
      if (end === at) return undefined
    }
    attrs.push([name, text.slice(at, end)])
    at = end
  }
}

/** The text of an attribute written as a string: `"x"`, `'x'` or `{'x'}`. Undefined for any other expression. */
export function stringValue(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  const inner = /^\{\s*(["'`])([^]*)\1\s*\}$/.exec(raw)
  const quoted = inner ? [inner[1]!, inner[2]!] : /^(["'])([^]*)\1$/.exec(raw)?.slice(1)
  if (!quoted) return /^[^{"']/.test(raw) ? raw : undefined
  if (quoted[0] === '`' && quoted[1]!.includes('${')) return undefined
  return quoted[1]!.replace(/&quot;/g, '"').replace(/&amp;/g, '&')
}

export const attr = (tag: Tag, name: string): string | undefined => tag.attrs.find(([key]) => key === name)?.[1]

/**
 * Walk every tag outside code and replace it with what `rewrite` returns;
 * undefined leaves it. A tag that runs over several lines is joined into the
 * line it starts on, so later passes meet it whole.
 */
export function rewriteTags(lines: Line[], rewrite: (tag: Tag, line: Line) => string | undefined): Line[] {
  const out: Line[] = []
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index]!
    if (line.code || !line.text.includes('<')) {
      out.push(line)
      continue
    }
    let at = 0
    for (;;) {
      const start = line.text.indexOf('<', at)
      if (start === -1) break
      at = start + 1
      if (codeSpans(line.text).some(([from, to]) => start >= from && start < to)) continue
      let tag = readTag(line.text, start)
      // An opening tag whose attributes continue below: read on, a few lines at most.
      let taken = 0
      if (!tag && /^<[A-Za-z][\w.:-]*(\s|$)/.test(line.text.slice(start))) {
        let joined = line.text
        while (!tag && taken < 30 && index + taken + 1 < lines.length && !lines[index + taken + 1]!.code) {
          taken++
          joined += `\n${lines[index + taken]!.text}`
          tag = readTag(joined, start)
        }
        if (tag) line = { ...line, text: joined }
        else taken = 0
      }
      if (!tag) continue
      index += taken
      const replacement = rewrite(tag, line)
      if (replacement === undefined) {
        at = tag.end
      } else {
        line = { ...line, text: line.text.slice(0, start) + replacement + line.text.slice(tag.end) }
        at = start + replacement.length
      }
    }
    out.push(line)
  }
  return out
}

/* ─────────────────────────────── imports ────────────────────────────── */

export interface ImportLine {
  /** What is imported from: `@theme/Tabs`, `./Chart`. */
  from: string
  line: Line
}

/**
 * Find the `import` lines of an MDX page. `keep` decides for each: false
 * removes it, with the empty line after it when that would leave two.
 */
export function filterImports(lines: Line[], keep: (found: ImportLine) => boolean): Line[] {
  const out: Line[] = []
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!
    if (line.code || !/^import\s/.test(line.text)) {
      out.push(line)
      continue
    }
    let statement = line.text
    let last = index
    const from = () => /(?:from\s+|^import\s+)(["'])([^"']+)\1\s*;?\s*$/.exec(statement)
    while (!from() && last + 1 < lines.length && last - index < 30 && lines[last + 1]!.text.trim() !== '') {
      last++
      statement += `\n${lines[last]!.text}`
    }
    const source = from()
    if (!source) {
      out.push(line)
      continue
    }
    if (keep({ from: source[2]!, line })) {
      out.push(...lines.slice(index, last + 1))
    } else if (lines[last + 1]?.text.trim() === '' && (out.length === 0 || out.at(-1)!.text.trim() === '')) {
      last++
    }
    index = last
  }
  return out
}

/* ───────────────────────────── heading ids ──────────────────────────── */

const HEADING_ID = /^(\s{0,3}#{1,6}[ \t]+.*?)[ \t]*\{:?[ \t]*#([^\s}]+)[ \t]*\}[ \t]*$/

/**
 * `## Install {#setup}` names a heading by hand. Shabd names headings from
 * their text, so the marker is removed; `found` hears about each one.
 */
export function stripHeadingIds(lines: Line[], found: (id: string, heading: string, line: Line) => void): Line[] {
  return lines.map((line) => {
    const match = line.code ? null : HEADING_ID.exec(line.text)
    if (!match) return line
    found(match[2]!, match[1]!.replace(/^\s*#+\s*/, ''), line)
    return { ...line, text: match[1]! }
  })
}

/**
 * Strip heading ids and say what became of each. Shabd makes the same id
 * from most headings, so only one it would name differently needs a hand.
 */
export function dropHeadingIds(lines: Line[], notes: Note[]): Line[] {
  return stripHeadingIds(lines, (id, heading, line) => {
    const same = headingSlug(plainTitle(heading).replace(/\\/g, '')) === id
    notes.push(same ? { kind: 'converted', what: 'heading id', line: line.number } : { kind: 'manual', message: MESSAGES.headingId(id), line: line.number })
  })
}

/** One note for every line of a page that holds HTML: in a .md page Shabd leaves it out. */
export function noteHtml(lines: Line[], notes: Note[]): void {
  for (const line of linesWithMarkup(lines)) notes.push({ kind: 'manual', message: MESSAGES.html, line: line.number })
}

/* ───────────────────────── HTML and MDX safety ──────────────────────── */

const HTML_TAGS = new Set(
  (
    'a abbr address article aside audio b blockquote br button caption center cite code col colgroup dd del details dfn ' +
    'div dl dt em figcaption figure font footer h1 h2 h3 h4 h5 h6 header hr i iframe img input ins kbd label li main mark ' +
    'nav ol p picture pre q s samp section small source span strong sub summary sup svg path circle rect g table tbody td ' +
    'tfoot th thead time tr track u ul var video wbr script style'
  ).split(' '),
)
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])

/** A tag a browser or MDX would act on, as opposed to `<placeholder>` text in a sentence. */
const isMarkup = (tag: Tag) => HTML_TAGS.has(tag.name.toLowerCase()) || /^[A-Z]/.test(tag.name)

/** The lines of a page that hold HTML or a component, outside code. */
export function linesWithMarkup(lines: Line[]): Line[] {
  const found = new Set<Line>()
  const seen = rewriteTags(lines, (tag, line) => {
    if (isMarkup(tag)) found.add(line)
    return undefined
  })
  return seen.filter((line) => found.has(line))
}

/** `color: red; font-size: 12px` as the object React asks for. */
function styleObject(css: string): string {
  const pairs = css
    .split(';')
    .map((declaration) => /^\s*([\w-]+)\s*:\s*([^]+?)\s*$/.exec(declaration))
    .filter((match) => match !== null)
    .map(([, property, value]) => {
      const name = property!.startsWith('--') ? JSON.stringify(property) : property!.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
      return `${name}: ${JSON.stringify(value)}`
    })
  return `{{ ${pairs.join(', ')} }}`
}

function writeTag(tag: Tag, selfClosing: boolean): string {
  const attrs = tag.attrs.map(([name, value]) => (name === '...' ? value : value === undefined ? name : `${name}=${value}`))
  return `<${[tag.name, ...attrs].join(' ')}${selfClosing ? ' />' : '>'}`
}

/**
 * Make a page that was plain Markdown readable as MDX. In MDX `<` starts a
 * tag and `{` an expression, a tag must be closed, and a comment is written
 * differently. Returns the lines and how many comments were rewritten.
 *
 * It does what can be done a line at a time. `shabd check` reads the result
 * afterwards and reports what this did not catch.
 *
 * `commentsOnly` is for a page that is MDX already but for its comments,
 * which is what Docusaurus accepts.
 */
export function makeMdxSafe(lines: Line[], options: { commentsOnly?: boolean } = {}): { lines: Line[]; comments: number } {
  const all = !options.commentsOnly
  // Tags first: this joins a tag that runs over several lines, closes the ones HTML leaves open, and fixes `style`.
  const tagged = !all ? lines : rewriteTags(lines, (tag) => {
    if (!HTML_TAGS.has(tag.name) && !VOID_TAGS.has(tag.name)) return undefined
    const style = stringValue(attr(tag, 'style'))
    const fixed: Tag = {
      ...tag,
      attrs: tag.attrs.map(([name, value]) =>
        name === 'style' && style !== undefined
          ? [name, styleObject(style)]
          : // A value without quotes is HTML, not JSX.
            [name, value !== undefined && !/^["'{]/.test(value) ? `"${attribute(value)}"` : value],
      ),
    }
    const selfClosing = tag.selfClosing || (VOID_TAGS.has(tag.name) && !tag.closing)
    return tag.closing ? undefined : writeTag(fixed, selfClosing)
  })

  let comments = 0
  let inComment = false
  const escape = (prose: string): string => {
    let out = ''
    let at = 0
    while (at < prose.length) {
      if (inComment) {
        const end = prose.indexOf('-->', at)
        out += prose.slice(at, end === -1 ? prose.length : end).replace(/\*\//g, '* /')
        if (end === -1) return out
        out += '*/}'
        inComment = false
        at = end + 3
        continue
      }
      const char = prose[at]!
      if (prose.startsWith('<!--', at)) {
        out += '{/*'
        inComment = true
        comments++
        at += 4
      } else if (all && (char === '{' || char === '}')) {
        out += `\\${char}`
        at++
      } else if (all && char === '<') {
        const link = /^<((?:https?|ftp|mailto):[^\s<>]+)>/.exec(prose.slice(at)) ?? /^<([^\s<>@]+@[^\s<>]+\.[^\s<>]+)>/.exec(prose.slice(at))
        const tag = link ? undefined : readTag(prose, at)
        if (link) {
          const href = link[1]!.includes(':') ? link[1]! : `mailto:${link[1]!}`
          out += `[${link[1]!}](${href})`
          at += link[0].length
        } else if (tag && isMarkup(tag)) {
          out += prose.slice(at, tag.end)
          at = tag.end
        } else {
          // `<3`, `<=`, `<your-key>`: text, which MDX would try to read as a tag. Before a space it reads `<` as text.
          out += /^<(\s|$)/.test(prose.slice(at)) ? '<' : '\\<'
          at++
        }
      } else {
        out += char
        at++
      }
    }
    return out
  }
  return {
    lines: tagged.map((line) => {
      if (line.code) return line
      // Inside a comment that runs over several lines, backticks are not code.
      return { ...line, text: inComment ? escape(line.text) : mapProse(line.text, escape) }
    }),
    comments,
  }
}
