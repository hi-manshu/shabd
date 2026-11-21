/**
 * An OpenAPI description, as the generator reads it.
 *
 * The description is whatever a YAML or JSON file held. Nothing about its
 * shape can be relied on: a key may be missing, or hold a number where a
 * list belongs. The helpers here give back nothing in place of a surprise,
 * so the rest of this folder does not have to ask twice.
 *
 * A Description also follows `$ref` within the document, and keeps the
 * notes: what was met and could not be shown.
 */
import type { SourceIssue } from '../config/errors.js'

/** Any object of the description: an operation, a schema, a parameter. */
export type Node = Record<string, unknown>

export function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** The entries of a map of the description, in the order they are written. */
export function entriesOf(value: unknown): [string, unknown][] {
  return isNode(value) ? Object.entries(value) : []
}

/** Text that says something. A number counts: YAML reads `version: 1.0` as one. */
export function textOf(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/**
 * Why a document cannot be read as OpenAPI 3.0 or 3.1, with the key that
 * says so. Nothing when it can be read.
 */
export function refusal(document: unknown): Pick<SourceIssue, 'path' | 'message'> | undefined {
  const reads = 'Shabd reads OpenAPI 3.0 and 3.1.'
  if (!isNode(document)) {
    return { path: [], message: `This is not an OpenAPI description: one starts with a line such as \`openapi: 3.1.0\`. ${reads}` }
  }
  if (Object.hasOwn(document, 'swagger')) {
    return {
      path: ['swagger'],
      message: `This is an OpenAPI 2.0 description, which is also called Swagger. ${reads} Convert the description to OpenAPI 3 first.`,
    }
  }
  const version = textOf(document.openapi)
  if (version === undefined) {
    return { path: [], message: `This is not an OpenAPI description: it has no \`openapi\` version. ${reads}` }
  }
  // `openapi: 3.0` without quotes is the number 3 by the time it gets here.
  if (!/^3(?:\.[01](?:\.|$)|$)/.test(version)) return { path: ['openapi'], message: `This is OpenAPI ${version}. ${reads}` }
  return undefined
}

export interface Resolved {
  /** What a `$ref` leads to, with what is written beside the `$ref` laid over it. Without a `$ref`, the object itself. */
  node: Node
  /**
   * The object the description holds, before anything was laid over it. It
   * is the same object wherever it is used, which is how a schema that is
   * met a second time is recognised.
   */
  target: Node
  /** The last part of the `$ref`, which is the name its author gave the thing: `Pet`. */
  name?: string
}

export class Description {
  readonly root: Node
  #notes = new Map<string, string>()

  constructor(root: Node) {
    this.root = root
  }

  /** What could not be shown, in the order it was met. */
  get notes(): string[] {
    return [...this.#notes.values()]
  }

  /**
   * Keep a note. Something that is met in fifty operations is said once:
   * `key` names what it is, and the first sentence given for a key is kept.
   */
  note(key: string, sentence: string): void {
    if (!this.#notes.has(key)) this.#notes.set(key, sentence)
  }

  /**
   * An object of the description, with any `$ref` followed to where it
   * leads. Nothing when it leads out of the document or nowhere, which is
   * noted. `where` says what was being read, for the note.
   */
  resolve(value: unknown, where: string): Resolved | undefined {
    if (!isNode(value)) return undefined
    let node = value
    let name: string | undefined
    const beside: Node[] = []
    const passed = new Set<Node>()

    while (typeof node.$ref === 'string') {
      const ref = node.$ref
      if (passed.has(node)) {
        this.note(`ref ${ref}`, `\`$ref: ${ref}\` leads back to itself, so nothing could be read from it. First met in ${where}.`)
        return undefined
      }
      passed.add(node)
      if (!ref.startsWith('#')) {
        this.note(`ref ${ref}`, `\`$ref: ${ref}\` leads to another file or address, which is not read. First met in ${where}.`)
        return undefined
      }
      const target = this.#at(ref)
      if (!isNode(target)) {
        this.note(`ref ${ref}`, `\`$ref: ${ref}\` leads to nothing in the description. First met in ${where}.`)
        return undefined
      }
      const { $ref: _, ...rest } = node
      if (Object.keys(rest).length > 0) beside.push(rest)
      name = pointerParts(ref).at(-1)
      node = target
    }

    const target = node
    // What is written beside a `$ref` is the more particular of the two: a description of this use of the schema.
    for (const rest of beside.reverse()) node = { ...node, ...rest }
    return { node, target, ...(name ? { name } : {}) }
  }

  /**
   * A note for each picture a description names and a page cannot show.
   * See `SHOWN` in markdown.ts for which those are.
   */
  pictures(where: string): (url: string) => void {
    return (url) =>
      this.note(`picture ${url}`, `A picture in a description has an address that leads nowhere from a page, and was left out: \`${url}\`. First met in ${where}.`)
  }

  /** What a `#/components/schemas/Pet` pointer leads to. */
  #at(ref: string): unknown {
    if (ref !== '#' && !ref.startsWith('#/')) return undefined
    let current: unknown = this.root
    for (const part of pointerParts(ref)) {
      if (Array.isArray(current)) current = /^\d+$/.test(part) ? current[Number(part)] : undefined
      else if (isNode(current) && Object.hasOwn(current, part)) current = current[part]
      else return undefined
    }
    return current
  }
}

/** The parts of a pointer: `#/paths/~1pets/get` is `paths`, `/pets`, `get`. */
function pointerParts(ref: string): string[] {
  if (!ref.startsWith('#/')) return []
  return ref
    .slice(2)
    .split('/')
    .map((part) => {
      let decoded = part
      try {
        decoded = decodeURIComponent(part)
      } catch {
        // Not a percent-escape after all: the part is taken as it is written.
      }
      return decoded.replace(/~1/g, '/').replace(/~0/g, '~')
    })
}
