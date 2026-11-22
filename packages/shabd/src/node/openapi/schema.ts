/**
 * Schemas, as the rows of a table.
 *
 * A schema is rarely written in one place. It refers to others with `$ref`,
 * is put together from parts with `allOf`, or is one of several with `oneOf`
 * and `anyOf`. `flat` reads all of that into one shape, and everything else
 * (the type as a phrase, the table of fields, an example) works from that
 * shape and never from the schema as it is written.
 *
 * A table has to end, and a schema need not: one may hold itself, or be
 * very large. So a schema's fields are listed once in its tables, and a
 * second meeting says where they are; fields below `MAX_DEPTH` levels are
 * not listed; and the tables of one schema hold `MAX_FIELDS` lines between
 * them. Each of these is said on the page where it happens.
 */
import { entriesOf, isNode, listOf, textOf, type Description, type Node } from './document.js'
import { code, ended, inline, literal } from './markdown.js'

/** How many levels of fields within fields are listed. */
export const MAX_DEPTH = 6
/** How many lines the tables of one schema hold between them. */
export const MAX_FIELDS = 500

/** Which way the data goes. A request leaves out what is `readOnly`, and a response what is `writeOnly`. */
export type Direction = 'request' | 'response'

/** A value given as an example. Wrapped, because `null` is an example like any other. */
export interface Example {
  value: unknown
}

/** A schema with its references followed and its parts put together. */
export interface Flat {
  /** The schema's own keywords, over those of each part of its `allOf`. Without `properties` and `required`, which are below. */
  node: Node
  /** The schema as the description holds it: the same object wherever it is used. */
  target: Node
  /** Every schema that went into this one: itself, and the parts of its `allOf`. */
  parts: Node[]
  /** The name its author gave it, when it was reached by `$ref`: `Pet`. */
  name?: string
  /** The `$ref` that could not be followed, when the schema is in another file or nowhere. Nothing else is known of it then. */
  unread?: string
  properties: Map<string, unknown>
  required: Set<string>
  /** Each `oneOf` or `anyOf` that leaves a choice, as its list of alternatives. */
  alternatives: unknown[][]
  nullable: boolean
}

/** One line of a table. */
export interface Field {
  /** `owner.address.city`, `tags[]`. */
  name: string
  flat: Flat
  /** Whether the object it is in requires it. Not set where the question does not arise, as for the items of a list. */
  required?: boolean
  /** Why what is inside it is not listed below it, as a sentence. */
  stopped?: string
}

export interface FieldTable {
  /** For the table of one alternative, what it is an alternative of, as Markdown: "`pet` as `Cat`". */
  caption?: string
  fields: Field[]
  /** Why the alternative has no lines, as a sentence. */
  stopped?: string
}

export interface Listing {
  /** The schema's own fields first, then a table for each alternative that has fields. */
  tables: FieldTable[]
  /** True when the schema has more fields than the tables hold. */
  cut: boolean
}

/** Keywords that say something the tables have no place for. Each is noted the first time it is met. */
const NOT_SHOWN = [
  'not',
  'if',
  'then',
  'else',
  'patternProperties',
  'propertyNames',
  'dependentSchemas',
  'dependentRequired',
  'prefixItems',
  'contains',
  'unevaluatedProperties',
  'unevaluatedItems',
]

interface Walk {
  where: string
  direction: Direction
  /** The schemas whose fields are being listed further up, and where. Below them they cannot be listed again. */
  open: Map<Node, string>
  /** Where each schema's fields were listed. */
  listed: Map<Node, string>
  /** Alternatives that wait for a table of their own. */
  waiting: { name: string; option: unknown; depth: number; caption: string }[]
  /** How many more lines there is room for. */
  left: number
  cut: boolean
}

/** The values a schema allows, when it names them: those of `enum`, or the one of `const`. */
export function valuesOf(flat: Flat): unknown[] | undefined {
  if (flat.node.const !== undefined) return [flat.node.const]
  return Array.isArray(flat.node.enum) && flat.node.enum.length > 0 ? flat.node.enum : undefined
}

function jsonType(value: unknown): string {
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  return typeof value
}

export class Schemas {
  #description: Description
  /** A schema is flattened once, however many operations use it. */
  #flats = new WeakMap<Node, Flat>()
  #holding = new Map<Flat, boolean | 'asking'>()
  /** How often `#holds` answered for a schema it was still asking about. */
  #guesses = 0
  #inlined = new Map<string, string>()

  constructor(description: Description) {
    this.#description = description
  }

  /* ─────────────────────────────── one shape ──────────────────────────── */

  flat(value: unknown, where: string): Flat {
    const known = isNode(value) ? this.#flats.get(value) : undefined
    if (known) return known
    const flat = this.#flatten(value, where, new Set())
    if (isNode(value)) this.#flats.set(value, flat)
    return flat
  }

  #flatten(value: unknown, where: string, within: Set<Node>): Flat {
    const resolved = this.#description.resolve(value, where)
    const node = resolved?.node ?? {}
    const target = resolved?.target ?? node
    const flat: Flat = {
      node: {},
      target,
      parts: [target],
      properties: new Map(),
      required: new Set(),
      alternatives: [],
      nullable: false,
      ...(resolved?.name ? { name: resolved.name } : {}),
      ...(!resolved && isNode(value) && typeof value.$ref === 'string' ? { unread: value.$ref } : {}),
    }
    // A schema that is a part of itself adds nothing the second time round.
    if (within.has(target)) return flat
    const inside = new Set(within).add(target)
    this.#noteWhatIsNotShown(node, where)

    const parts = [...listOf(node.allOf)]
    for (const key of ['oneOf', 'anyOf']) {
      const options = listOf(node[key])
      const real = options.filter((option) => this.#description.resolve(option, where)?.node.type !== 'null')
      if (real.length < options.length) flat.nullable = true
      // One alternative, or one beside `null`, leaves no choice: it is the schema.
      if (real.length === 1) parts.push(real[0])
      else if (real.length > 1) flat.alternatives.push(real)
    }

    const addProperty = (name: string, schema: unknown) => {
      const before = flat.properties.get(name)
      // Named in two parts: both hold, so the property is the two together.
      flat.properties.set(name, before === undefined ? schema : { allOf: [before, schema] })
    }
    for (const part of parts.map((member) => this.#flatten(member, where, inside))) {
      // Spread, and not assignment: a keyword may be named `__proto__`.
      flat.node = { ...flat.node, ...part.node }
      for (const [name, schema] of part.properties) addProperty(name, schema)
      for (const name of part.required) flat.required.add(name)
      flat.alternatives.push(...part.alternatives)
      flat.parts.push(...part.parts)
      flat.nullable ||= part.nullable
    }

    // What the schema says itself comes last, and so wins over what its parts say.
    const { allOf: _allOf, oneOf: _oneOf, anyOf: _anyOf, properties, required, ...own } = node
    flat.node = { ...flat.node, ...own }
    for (const [name, schema] of entriesOf(properties)) addProperty(name, schema)
    for (const name of listOf(required)) if (typeof name === 'string') flat.required.add(name)
    // `nullable: true` is how 3.0 says it, and `null` among the types is how 3.1 does.
    flat.nullable ||= own.nullable === true || own.type === 'null' || listOf(own.type).includes('null')
    return flat
  }

  #noteWhatIsNotShown(node: Node, where: string): void {
    for (const key of NOT_SHOWN) {
      if (node[key] !== undefined) this.#description.note(`keyword ${key}`, `\`${key}\` in a schema is not shown. First met in ${where}.`)
    }
    if (node.xml !== undefined) {
      this.#description.note('xml', `\`xml\` in a schema is not used: the names and attributes a value has as XML are not shown. First met in ${where}.`)
    }
  }

  /* ───────────────────────────── type as a phrase ─────────────────────── */

  /** The JSON types a value may have, apart from `null`. Worked out from what the schema holds when it does not say. */
  types(flat: Flat): string[] {
    const { node } = flat
    const declared = (typeof node.type === 'string' ? [node.type] : listOf(node.type)).filter((type): type is string => typeof type === 'string')
    if (declared.length > 0) return [...new Set(declared.filter((type) => type !== 'null'))]
    if (flat.properties.size > 0 || isNode(node.additionalProperties)) return ['object']
    if (node.items !== undefined) return ['array']
    const values = valuesOf(flat)?.filter((value) => value !== null)
    return values ? [...new Set(values.map(jsonType))] : []
  }

  /** The type of a schema as a phrase: `string (date-time)`, `array of object`, `Cat or Dog`, `integer or null`. */
  phrase(flat: Flat, where: string, depth = 0): string {
    // Not `any`: the schema does say what the value is, somewhere this could not read.
    if (flat.unread !== undefined) return 'unknown'
    const types = this.types(flat)
    const format = types.length === 1 ? textOf(flat.node.format) : undefined
    const kinds = types.map((type) => {
      if (type === 'array') {
        // A list of lists of lists: after a few, the word is enough.
        if (flat.node.items === undefined || depth >= 3) return 'array'
        const items = this.phrase(this.flat(flat.node.items, where), where, depth + 1)
        return `array of ${items.includes(' or ') ? `(${items})` : items}`
      }
      return format && type !== 'object' ? `${type} (${format})` : type
    })
    if (kinds.length === 0 && depth < 3) {
      kinds.push(...new Set(flat.alternatives.flat().map((option) => this.#called(option, where) ?? this.phrase(this.flat(option, where), where, depth + 1))))
    }
    // A schema that says nothing of its type allows anything, unless all it says is `null`.
    if (kinds.length === 0 && flat.node.type === undefined) kinds.push('any')
    if (flat.nullable) kinds.push('null')
    return kinds.join(' or ') || 'any'
  }

  /** What an alternative is called by its author: the name of its schema, or its title. */
  #called(option: unknown, where: string): string | undefined {
    const flat = this.flat(option, where)
    return flat.name ?? textOf(flat.node.title)
  }

  /* ─────────────────────────────── the tables ─────────────────────────── */

  /** The tables of a body: the fields of its schema, then those of each alternative. */
  body(schema: unknown, where: string, direction: Direction): Listing {
    return this.#list(where, direction, (walk, fields) => this.#inside(this.flat(schema, where), '', 0, walk, fields))
  }

  /** The same for something with a name of its own, a parameter or a header: a line for it, then what is inside it. */
  named(schema: unknown, name: string, required: boolean, where: string, direction: Direction): Listing {
    return this.#list(where, direction, (walk, fields) => this.#field(schema, name, required, 0, walk, fields))
  }

  #list(where: string, direction: Direction, start: (walk: Walk, fields: Field[]) => void): Listing {
    const walk: Walk = { where, direction, open: new Map(), listed: new Map(), waiting: [], left: MAX_FIELDS, cut: false }
    const fields: Field[] = []
    start(walk, fields)
    const tables: FieldTable[] = [{ fields }]

    // The list grows while it is read: an alternative may have alternatives of its own.
    for (let index = 0; index < walk.waiting.length; index++) {
      if (walk.left <= 0) {
        walk.cut = true
        break
      }
      walk.left--
      const { name, option, depth, caption } = walk.waiting[index]!
      const rows: Field[] = []
      const stopped = this.#inside(this.flat(option, where), name, depth, walk, rows)
      tables.push({ caption, fields: rows, ...(stopped ? { stopped } : {}) })
    }

    if (walk.cut) this.#description.note(`cut ${where}`, `In ${where}, the schema has more than ${MAX_FIELDS} fields. The table stops there.`)
    return { tables: tables.filter((table) => table.fields.length > 0 || table.stopped), cut: walk.cut }
  }

  #field(value: unknown, name: string, required: boolean | undefined, depth: number, walk: Walk, fields: Field[]): void {
    const flat = this.flat(value, walk.where)
    if (walk.direction === 'request' ? flat.node.readOnly === true : flat.node.writeOnly === true) return
    if (walk.left <= 0) {
      walk.cut = true
      return
    }
    walk.left--
    const field: Field = { name, flat, ...(required !== undefined ? { required } : {}) }
    fields.push(field)
    const stopped = this.#inside(flat, name, depth, walk, fields)
    if (stopped) field.stopped = stopped
  }

  /**
   * List what is inside a schema: the fields of an object, the items of a
   * list, and whatever those hold in turn. Gives back why it stopped, when
   * it stopped before listing anything.
   */
  #inside(flat: Flat, name: string, depth: number, walk: Walk, fields: Field[]): string | undefined {
    if (!this.#holds(flat, walk.where)) return undefined

    const before = flat.parts.map((part) => walk.open.get(part)).find((at) => at !== undefined) ?? walk.listed.get(flat.target)
    // The schema of the body itself, or of the items of a body that is a list, has no name to be found by.
    if (before !== undefined) return `The fields are listed at ${before.replace(/[[\]]/g, '') ? code(before) : 'the top level'}, and not again here.`
    if (depth >= MAX_DEPTH) {
      this.#description.note(`deep ${walk.where}`, `In ${walk.where}, fields more than ${MAX_DEPTH} levels deep are not listed.`)
      return `What is inside is more than ${MAX_DEPTH} levels deep, and is not listed.`
    }

    walk.listed.set(flat.target, name)
    const opened = flat.parts.filter((part) => !walk.open.has(part))
    for (const part of opened) walk.open.set(part, name)

    for (const [key, value] of flat.properties) this.#field(value, name ? `${name}.${key}` : key, flat.required.has(key), depth + 1, walk, fields)
    // A map: any key, each with a value of this schema.
    if (isNode(flat.node.additionalProperties)) this.#field(flat.node.additionalProperties, name ? `${name}.*` : '*', undefined, depth + 1, walk, fields)

    let stopped: string | undefined
    if (flat.node.items !== undefined) {
      const items = this.flat(flat.node.items, walk.where)
      // The items get a line of their own only when there is more to say of them than the list's line does.
      if (this.#says(items)) this.#field(flat.node.items, `${name}[]`, undefined, depth, walk, fields)
      else stopped = this.#inside(items, `${name}[]`, depth, walk, fields)
    }

    for (const group of flat.alternatives) {
      group.forEach((option, index) => {
        if (!this.#holds(this.flat(option, walk.where), walk.where)) return
        const called = this.#called(option, walk.where)
        const which = called ? `as ${code(called)}` : `alternative ${index + 1}`
        const caption = name ? `${code(name)}${called ? ' ' : ', '}${which}` : which.replace(/^a/, 'A')
        walk.waiting.push({ name, option, depth, caption })
      })
    }

    for (const part of opened) walk.open.delete(part)
    return stopped
  }

  /** True when a schema has lines to add below its own: it has fields, or its items or an alternative have. */
  #holds(flat: Flat, where: string): boolean {
    const known = this.#holding.get(flat)
    if (known === 'asking') {
      // Met again while it is being asked about: the schema holds itself, and adds nothing by that.
      this.#guesses++
      return false
    }
    if (known !== undefined) return known

    this.#holding.set(flat, 'asking')
    const guesses = this.#guesses
    const { items } = flat.node
    const holds =
      flat.properties.size > 0 ||
      isNode(flat.node.additionalProperties) ||
      (items !== undefined && (this.#says(this.flat(items, where)) || this.#holds(this.flat(items, where), where))) ||
      flat.alternatives.some((group) => group.some((option) => this.#holds(this.flat(option, where), where)))
    // A "no" that leant on a schema still being asked about is true of this asking only, and is not kept.
    if (holds || guesses === this.#guesses) this.#holding.set(flat, holds)
    else this.#holding.delete(flat)
    return holds
  }

  /** True when there is something to say of a value beyond its type. */
  #says(flat: Flat): boolean {
    return textOf(flat.node.description) !== undefined || valuesOf(flat) !== undefined || this.details(flat).length > 0
  }

  /* ──────────────────────────────── the cells ─────────────────────────── */

  /** A type with the values it is held to beside it: `string`, one of `asc`, `desc`. */
  kind(flat: Flat, where: string): string {
    const values = this.#values(flat)
    return code(this.phrase(flat, where)) + (values ? `, ${flat.node.const !== undefined ? 'always' : 'one of'} ${values}` : '')
  }

  #values(flat: Flat): string | undefined {
    // A value that cannot be written, because it holds itself, is left out and not shown as nothing.
    const written = (valuesOf(flat) ?? []).map((value) => code(literal(value))).filter(Boolean)
    return written.length > 0 ? written.join(', ') : undefined
  }

  /**
   * A field as the cells of a row: name, type, whether it is required, and
   * what is said of it. `values` says where the values a field may take are
   * written: beside the type, or in what is said. `description` and
   * `example` stand in for the schema's own, and `more` is said after them.
   */
  cells(
    field: Field,
    where: string,
    options: { values: 'type' | 'description'; description?: string | undefined; example?: Example | undefined; more?: string[] | undefined },
  ): string[] {
    const { flat } = field
    const values = options.values === 'description' ? this.#values(flat) : undefined
    const which = isNode(flat.node.discriminator) ? textOf(flat.node.discriminator.propertyName) : undefined
    const more = [
      values ? `${flat.node.const !== undefined ? 'Always' : 'One of'} ${values}.` : '',
      ...this.details(flat, options.example),
      ...(options.more ?? []),
      which && flat.alternatives.length > 0 ? `${code(which)} says which it is.` : '',
      flat.unread !== undefined ? `Its schema is ${code(flat.unread)}, which could not be read.` : '',
      field.stopped ?? '',
    ].filter(Boolean)
    const said = this.#inline(options.description ?? textOf(flat.node.description) ?? '', where)

    return [
      // A name that is empty or all spaces would leave the cell empty: it is written in its quotes.
      code(field.name) || code(JSON.stringify(field.name)),
      options.values === 'type' ? this.kind(flat, where) : code(this.phrase(flat, where)),
      field.required === undefined ? '' : field.required ? 'yes' : 'no',
      [more.length > 0 ? ended(said) : said, ...more].filter(Boolean).join(' '),
    ]
  }

  /**
   * A description as the text of a cell. A schema that many operations use
   * has its description written into many tables, and reading Markdown is
   * the slow part of making a page, so each text is read once.
   */
  #inline(text: string, where: string): string {
    let said = this.#inlined.get(text)
    if (said === undefined) this.#inlined.set(text, (said = inline(text, this.#description.pictures(where))))
    return said
  }

  /** What else a schema says of a value, as short sentences: its limits, its default, an example. */
  details(flat: Flat, given?: Example): string[] {
    const { node } = flat
    const out: string[] = []
    const number = (key: string) => {
      const value = node[key]
      return typeof value === 'number' ? value : undefined
    }
    const count = (least: string, most: string, thing: string) => {
      const [min, max] = [number(least), number(most)]
      const things = (n: number) => `${n} ${thing}${n === 1 ? '' : 's'}`
      if (min !== undefined && min === max) out.push(`Exactly ${things(min)}.`)
      else {
        if (min !== undefined) out.push(`At least ${things(min)}.`)
        if (max !== undefined) out.push(`At most ${things(max)}.`)
      }
    }

    // 3.0 says whether the limit itself is allowed with `true` beside it. 3.1 gives the limit under the other name.
    const above = number('exclusiveMinimum') ?? (node.exclusiveMinimum === true ? number('minimum') : undefined)
    const below = number('exclusiveMaximum') ?? (node.exclusiveMaximum === true ? number('maximum') : undefined)
    if (above !== undefined) out.push(`More than ${above}.`)
    else if (number('minimum') !== undefined) out.push(`At least ${number('minimum')}.`)
    if (below !== undefined) out.push(`Less than ${below}.`)
    else if (number('maximum') !== undefined) out.push(`At most ${number('maximum')}.`)
    if (number('multipleOf') !== undefined) out.push(`A multiple of ${number('multipleOf')}.`)
    count('minLength', 'maxLength', 'character')
    count('minItems', 'maxItems', 'item')
    if (node.uniqueItems === true) out.push('No item twice.')
    const pattern = textOf(node.pattern)
    if (pattern) out.push(`Matches ${code(pattern)}.`)
    const normally = node.default === undefined ? '' : code(literal(node.default))
    if (normally) out.push(`Default: ${normally}.`)

    const example = given ?? exampleIn(node)
    // An example that is an object or a list belongs with the body, not in a cell.
    const shown = example && (typeof example.value !== 'object' || example.value === null) ? code(literal(example.value)) : ''
    if (shown) out.push(`Example: ${shown}.`)
    if (node.deprecated === true) out.push('Deprecated.')
    return out
  }
}

/** The example a schema gives of itself: `example`, or the first of `examples` as 3.1 writes them. */
export function exampleIn(node: Node): Example | undefined {
  if (node.example !== undefined) return { value: node.example }
  return Array.isArray(node.examples) && node.examples.length > 0 ? { value: node.examples[0] } : undefined
}
