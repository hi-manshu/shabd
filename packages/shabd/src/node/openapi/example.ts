/**
 * Examples: the one a description gives, or one made from the schema.
 *
 * A made example is there to show the shape of a value, and to give the
 * `curl` command something to send. Where the schema names a value (an
 * example, a default, the first of its allowed values) that value is used.
 * Where it does not, a placeholder stands in, chosen by type and format:
 * it is not a value the API is known to accept.
 */
import { isNode, textOf, type Description, type Node } from './document.js'
import { exampleIn, MAX_DEPTH, valuesOf, type Direction, type Example, type Flat, type Schemas } from './schema.js'

/** How many values one made example holds. A schema with more is shown in part. */
const MAX_VALUES = 200

/** A string of each format. The addresses are ones set aside for documentation. */
const STRINGS = new Map([
  ['date', '2025-01-01'],
  ['date-time', '2025-01-01T12:00:00Z'],
  ['time', '12:00:00Z'],
  ['duration', 'P1D'],
  ['email', 'user@example.com'],
  ['uuid', '123e4567-e89b-12d3-a456-426614174000'],
  ['uri', 'https://example.com'],
  ['url', 'https://example.com'],
  ['hostname', 'example.com'],
  ['ipv4', '192.0.2.1'],
  ['ipv6', '2001:db8::1'],
  ['byte', 'aGVsbG8='],
  ['password', 'secret'],
])

interface Making {
  where: string
  direction: Direction
  /** The schemas being made further up. One that holds itself is left out the second time. */
  open: Set<Node>
  left: number
}

export class Examples {
  #description: Description
  #schemas: Schemas

  constructor(description: Description, schemas: Schemas) {
    this.#description = description
    this.#schemas = schemas
  }

  /** The example a parameter, a header or a body gives of itself: `example`, or the first of `examples` that holds a value. */
  given(holder: Node, where: string): Example | undefined {
    if (holder.example !== undefined) return { value: holder.example }
    for (const [name, entry] of isNode(holder.examples) ? Object.entries(holder.examples) : []) {
      const example = this.#description.resolve(entry, where)?.node
      if (example && example.value !== undefined) return { value: example.value }
      if (example && textOf(example.externalValue)) {
        this.#description.note(`external example ${where} ${name}`, `In ${where}, the example \`${name}\` is kept at another address, and is not fetched.`)
      }
    }
    return undefined
  }

  /** A value the schema names for itself: an example, its default, the first of the values it allows. */
  named(flat: Flat): Example | undefined {
    const example = exampleIn(flat.node)
    if (example) return example
    if (flat.node.default !== undefined) return { value: flat.node.default }
    const values = valuesOf(flat)
    return values ? { value: values.find((value) => value !== null) ?? values[0] } : undefined
  }

  /** An example made from a schema. Nothing when the schema says too little to make one. */
  made(flat: Flat, where: string, direction: Direction): Example | undefined {
    const value = this.#make(flat, 0, { where, direction, open: new Set(), left: MAX_VALUES })
    return value === undefined ? undefined : { value }
  }

  #make(flat: Flat, depth: number, making: Making): unknown {
    const named = this.named(flat)
    if (named) return named.value
    if (making.left <= 0 || depth > MAX_DEPTH || flat.parts.some((part) => making.open.has(part))) return undefined
    making.left--

    const { node } = flat
    const [type] = this.#schemas.types(flat)
    const first = flat.alternatives[0]?.[0]
    const below = (schema: unknown) => {
      for (const part of flat.parts) making.open.add(part)
      const value = this.#make(this.#schemas.flat(schema, making.where), depth + 1, making)
      for (const part of flat.parts) making.open.delete(part)
      return value
    }

    if (type === 'object') {
      const entries: [string, unknown][] = []
      for (const [name, schema] of flat.properties) {
        const property = this.#schemas.flat(schema, making.where)
        if (making.direction === 'request' ? property.node.readOnly === true : property.node.writeOnly === true) continue
        const value = below(schema)
        if (value !== undefined) entries.push([name, value])
      }
      // A map has no keys of its own to show: one stands for them all.
      if (entries.length === 0 && isNode(node.additionalProperties)) {
        const value = below(node.additionalProperties)
        if (value !== undefined) entries.push(['key', value])
      }
      const choice = first === undefined ? undefined : below(first)
      // `fromEntries` and not assignment: a property may be named `__proto__`.
      return Object.fromEntries([...entries, ...(isNode(choice) ? Object.entries(choice) : [])])
    }
    if (type === 'array') {
      const item = node.items === undefined ? undefined : below(node.items)
      return item === undefined ? [] : [item]
    }
    if (type === 'string') return STRINGS.get(textOf(node.format) ?? '') ?? 'string'
    if (type === 'integer') return Math.ceil(nearestToNought(node))
    if (type === 'number') return nearestToNought(node)
    if (type === 'boolean') return true
    // No type of its own: the first alternative stands for the choice.
    if (first !== undefined) return below(first)
    return flat.nullable ? null : undefined
  }
}

/** Nought, or the number nearest to it that the schema's limits allow. */
function nearestToNought(node: Node): number {
  const limit = (key: string) => {
    const value = node[key]
    return typeof value === 'number' ? value : undefined
  }
  // A limit that is itself not allowed: 3.1 gives it under its own name, 3.0 says `true` beside the usual one.
  const [above, below] = [limit('exclusiveMinimum'), limit('exclusiveMaximum')]
  const [min, max] = [limit('minimum'), limit('maximum')]
  const least = above !== undefined ? above + 1 : min !== undefined && node.exclusiveMinimum === true ? min + 1 : min
  const most = below !== undefined ? below - 1 : max !== undefined && node.exclusiveMaximum === true ? max - 1 : max
  if (least !== undefined && least > 0) return least
  if (most !== undefined && most < 0) return most
  return 0
}
