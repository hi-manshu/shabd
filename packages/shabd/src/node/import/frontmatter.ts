/**
 * Frontmatter, edited in place.
 *
 * A key the import has no reason to touch keeps its place, its comments and
 * the way it was written: its lines are carried over as text. Only a key
 * that is set is written afresh. Parsing the YAML and writing all of it out
 * again would restyle every page of a site for the sake of a few keys.
 *
 * Frontmatter in Shabd is loose: a key it does not know may stay. A key it
 * does know must have the shape it expects, or the page is refused, so what
 * is left after a tool's own mapping is checked against Shabd's schema here.
 */
import { isMap, isScalar, LineCounter, parseDocument, stringify } from 'yaml'
import { BUILTIN_LAYOUTS } from '../../shared/blocks.js'
import { FrontmatterSchema } from '../../shared/schema.js'
import { splitFrontmatter } from '../content/frontmatter.js'
import { fromLines, toLines, type Line } from './text.js'
import type { Conversion, Note } from './types.js'

export class FrontmatterEditor {
  /** How many keys were converted. */
  converted = 0
  /** What needs a hand, with the key it is about. */
  readonly manual: { message: string; key: string }[] = []
  changed = false
  /** Each key with its lines as they were written, or without them once it has been set. */
  #entries = new Map<string, { value: unknown; text?: string }>()
  /** Comments above the first key. */
  #lead = ''

  /** `yaml` is the text between the two `---` lines. It must be a map, or empty. */
  constructor(yaml: string) {
    const doc = parseDocument(yaml)
    if (!isMap(doc.contents)) return
    const data = doc.toJS() as Record<string, unknown>
    const starts = doc.contents.items.map((pair) => (isScalar(pair.key) ? (pair.key.range?.[0] ?? 0) : 0))
    this.#lead = yaml.slice(0, starts[0] ?? 0)
    doc.contents.items.forEach((pair, index) => {
      const key = String(isScalar(pair.key) ? pair.key.value : pair.key)
      this.#entries.set(key, { value: data[key], text: yaml.slice(starts[index], starts[index + 1] ?? yaml.length) })
    })
  }

  has(key: string): boolean {
    return this.#entries.has(key)
  }

  /** The value of a key, as plain data. */
  get(key: string): unknown {
    return this.#entries.get(key)?.value
  }

  data(): Record<string, unknown> {
    return Object.fromEntries([...this.#entries].map(([key, entry]) => [key, entry.value]))
  }

  /** A key that is already there keeps its place. A new one goes last. */
  set(key: string, value: unknown): void {
    this.#entries.set(key, { value })
    this.changed = true
  }

  delete(key: string): void {
    if (this.#entries.delete(key)) this.changed = true
  }

  /** Read a key and remove it: the first half of moving it somewhere else. */
  take(key: string): unknown {
    const value = this.get(key)
    this.delete(key)
    return value
  }

  /** Read a key, and if `apply` takes its value, remove it and count it as converted. */
  move(key: string, apply: (value: unknown) => boolean): void {
    if (!this.has(key) || !apply(this.get(key))) return
    this.delete(key)
    this.converted++
  }

  /** Set one key of `sidebar:`, keeping the others. */
  setSidebar(key: 'label' | 'order' | 'badge' | 'exclude', value: unknown): void {
    const current = this.get('sidebar')
    // `sidebar: false` hides the sidebar on the page. As an object that is `visible: false`.
    const sidebar = current !== null && typeof current === 'object' ? (current as Record<string, unknown>) : current === false ? { visible: false } : {}
    this.set('sidebar', { ...sidebar, [key]: value })
  }

  toString(): string {
    const written = [...this.#entries].map(([key, entry]) => entry.text ?? stringify({ [key]: entry.value }, { lineWidth: 0 }))
    return this.#lead + written.map((text) => (text.endsWith('\n') ? text : `${text}\n`)).join('')
  }
}

/** The keys Shabd reads strictly. Any other key may hold anything. */
const TEXT_KEYS = ['title', 'description'] as const

/**
 * Make what is left acceptable to Shabd: text where it wants text, a layout
 * that exists, and no known key with a shape it would refuse.
 */
function makeAcceptable(frontmatter: FrontmatterEditor): void {
  for (const key of TEXT_KEYS) {
    const value = frontmatter.get(key)
    if (value === undefined || (typeof value === 'string' && (key === 'description' || value !== ''))) continue
    if (typeof value === 'number' || typeof value === 'boolean') frontmatter.set(key, String(value))
    else frontmatter.delete(key)
    frontmatter.converted++
  }

  const layout = frontmatter.get('layout')
  if (layout !== undefined && !(BUILTIN_LAYOUTS as readonly unknown[]).includes(layout)) {
    frontmatter.manual.push({ key: 'layout', message: `Layout "${String(layout)}" is not one of Shabd's, so the page uses the default. Layouts are defined in shabd.config.yaml.` })
    frontmatter.delete('layout')
  }

  const result = FrontmatterSchema.safeParse(frontmatter.data())
  if (result.success) return
  for (const key of new Set(result.error.issues.map((issue) => issue.path[0]))) {
    if (typeof key !== 'string') continue
    frontmatter.manual.push({ key, message: `Frontmatter \`${key}\` holds something Shabd reads differently, and was left out. See "Frontmatter" in Shabd's documentation.` })
    frontmatter.delete(key)
  }
}

export interface EditedPage {
  /** The frontmatter block with its two `---` lines, or nothing when the page has none. */
  frontmatter: string
  body: string
  /** The line of the source file the body starts on. */
  bodyLine: number
  /** Their lines are lines of `frontmatter` as it is now. A note about a key that is gone has none. */
  notes: Note[]
}

/** Split a page, let `edit` change its frontmatter, and check the result against what Shabd accepts. */
export function editFrontmatter(source: string, edit?: (frontmatter: FrontmatterEditor) => void): EditedPage {
  const block = splitFrontmatter(source)
  const body = block ? block.body : source
  const head = source.slice(0, source.length - body.length)
  const bodyLine = head.split('\n').length
  // What is between the two `---` lines.
  const yaml = block ? block.yaml.slice(block.yaml.indexOf('\n') + 1) : ''

  const lines = new LineCounter()
  const doc = parseDocument(yaml, { lineCounter: lines })
  if (doc.errors.length > 0 || (doc.contents !== null && typeof doc.toJS() !== 'object')) {
    const first = doc.errors[0]
    return {
      frontmatter: head,
      body,
      bodyLine,
      notes: [
        {
          kind: 'manual',
          message: `The frontmatter is not valid YAML, and was left as it is${first ? `: ${first.message.split('\n')[0]}` : ''}`,
          line: first ? lines.linePos(first.pos[0]).line + 1 : 1,
        },
      ],
    }
  }

  const editor = new FrontmatterEditor(yaml)
  edit?.(editor)
  makeAcceptable(editor)
  const inner = editor.changed ? editor.toString() : yaml
  const written = !editor.changed ? head : Object.keys(editor.data()).length > 0 ? `---\n${inner}---\n` : ''

  // Where each key is now, for the notes: the opening `---` is line 1.
  const placed = new LineCounter()
  const after = parseDocument(inner, { lineCounter: placed })
  const lineOf = (key: string) => {
    const node = after.get(key, true) as { range?: [number, number, number] | null } | undefined
    return written && node?.range ? placed.linePos(node.range[0]).line + 1 : undefined
  }
  const notes: Note[] = [
    ...Array.from({ length: editor.converted }, (): Note => ({ kind: 'converted', what: 'frontmatter key' })),
    ...editor.manual.map(({ key, message }): Note => ({ kind: 'manual', message, line: lineOf(key) })),
  ]
  // A page that had no frontmatter gets an empty line between the new block and its text.
  return { frontmatter: written && !block ? `${written}\n` : written, body, bodyLine, notes }
}

/**
 * The frame every tool's page conversion runs in: frontmatter first, then
 * the body as lines. `body` says whether the page now needs to be MDX.
 * The lines in the notes that come back are lines of the converted text.
 */
export function convertPage(
  source: string,
  steps: {
    frontmatter?: (frontmatter: FrontmatterEditor) => void
    body: (lines: Line[], notes: Note[]) => { lines: Line[]; mdx: boolean }
  },
): Conversion {
  const page = editFrontmatter(source.replace(/\r\n?/g, '\n'), steps.frontmatter)
  const notes: Note[] = []
  const body = steps.body(toLines(page.body, page.bodyLine), notes)

  // A note names a line of the source. The author will read the new file, so say where that line went.
  const head = page.frontmatter.split('\n').length - 1
  const moved: [source: number, written: number][] = []
  let written = head + 1
  for (const line of body.lines) {
    moved.push([line.number, written])
    written += line.text.split('\n').length
  }
  const where = (line: number | undefined): number | undefined => {
    if (line === undefined) return undefined
    // A line that was removed is reported at the one that followed it.
    return (moved.find(([from]) => from === line) ?? moved.find(([from]) => from > line) ?? moved.at(-1))?.[1]
  }
  return {
    text: page.frontmatter + fromLines(body.lines),
    mdx: body.mdx,
    notes: [...page.notes, ...notes.map((note) => ({ ...note, line: where(note.line) }))],
  }
}

/** The number a frontmatter value stands for, if it is one. */
export function asNumber(value: unknown): number | undefined {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof number === 'number' && Number.isFinite(number) ? number : undefined
}
