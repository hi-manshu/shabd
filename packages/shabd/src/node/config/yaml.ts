/**
 * YAML → validated object, with every problem mapped back to a line and column.
 *
 * Zod reports *where in the data* something is wrong; the YAML document knows
 * *where in the file* that data came from. This module joins the two.
 */
import { isMap, isScalar, isSeq, LineCounter, parseDocument, type Document, type Node } from 'yaml'
import { z } from 'zod'
import { closestMatch, ShabdError, type SourceIssue } from './errors.js'

type ZodIssue = z.core.$ZodIssue
type Path = (string | number)[]

export interface ParsedYaml {
  data: unknown
  /** Resolve a data path to a 1-based line/column in the source. */
  locate(path: Path, target?: 'value' | 'key'): { line: number; column: number } | undefined
}

/** Parse YAML text. Syntax errors are thrown as a ShabdError with positions. */
export function parseYaml(file: string, source: string): ParsedYaml {
  const lineCounter = new LineCounter()
  const doc = parseDocument(source, { lineCounter, merge: true, prettyErrors: false })

  if (doc.errors.length > 0) {
    throw new ShabdError(
      file,
      doc.errors.map((error) => {
        const position = lineCounter.linePos(error.pos[0])
        return { message: error.message, path: [], line: position.line, column: position.col }
      }),
      source,
    )
  }

  return {
    data: doc.toJS(),
    locate: (path, target = 'value') => locate(doc, lineCounter, path, target),
  }
}

/** Parse and validate in one step; throws a ShabdError listing every problem. */
export function parseYamlWithSchema<Schema extends z.ZodType>(
  file: string,
  source: string,
  schema: Schema,
  options: { emptyValue?: unknown } = {},
): { value: z.output<Schema>; yaml: ParsedYaml } {
  const yaml = parseYaml(file, source)
  const data = yaml.data ?? options.emptyValue ?? {}
  const result = schema.safeParse(data, { reportInput: true })
  if (!result.success) {
    throw new ShabdError(file, toSourceIssues(result.error.issues, yaml, schema), source)
  }
  return { value: result.data, yaml }
}

/** Attach file positions to issues found after schema validation (e.g. unknown layout names). */
export function locateIssues(issues: { path: Path; message: string }[], yaml: ParsedYaml): SourceIssue[] {
  return issues.map((issue) => ({ ...issue, ...yaml.locate(issue.path) }))
}

/* ───────────────────────── Zod issue → source issue ───────────────────── */

interface FlatIssue {
  path: Path
  message: string
  target: 'value' | 'key'
}

export function toSourceIssues(issues: ZodIssue[], yaml: ParsedYaml, schema: z.ZodType): SourceIssue[] {
  const flat = issues.flatMap((issue) => flatten(issue, [], schema))
  const seen = new Set<string>()
  const out: SourceIssue[] = []
  for (const issue of flat) {
    const key = `${JSON.stringify(issue.path)}:${issue.message}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ path: issue.path, message: issue.message, ...yaml.locate(issue.path, issue.target) })
  }
  return out.sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || (a.column ?? 0) - (b.column ?? 0))
}

function flatten(issue: ZodIssue, prefix: Path, schema: z.ZodType): FlatIssue[] {
  const path = [...prefix, ...(issue.path as Path)]

  if (issue.code === 'unrecognized_keys') {
    const known = knownKeysAt(schema, path)
    return issue.keys.map((key) => {
      const suggestion = closestMatch(key, known)
      return {
        path: [...path, key],
        message: suggestion ? `Unknown key "${key}". Did you mean "${suggestion}"?` : `Unknown key "${key}"`,
        target: 'key' as const,
      }
    })
  }

  // A map whose keys have a shape of their own (`redirects:`): say what is wrong with the key, at the key.
  if (issue.code === 'invalid_key' && issue.issues.length > 0) {
    return issue.issues.map((nested) => ({ path, message: nested.message, target: 'key' as const }))
  }

  if (issue.code === 'invalid_union' && issue.errors.length > 0) {
    const branch = pickUnionBranch(issue.errors)
    if (branch) return branch.flatMap((nested) => flatten(nested, path, schema))
    const expected = [
      ...new Set(issue.errors.flatMap((errors) => errors.flatMap((e) => (e.code === 'invalid_type' ? [e.expected] : [])))),
    ]
    return [
      {
        path,
        message: expected.length ? `Invalid value: expected ${expected.join(' or ')}` : issue.message,
        target: 'value',
      },
    ]
  }

  return [{ path, message: issue.message, target: 'value' }]
}

/**
 * A union fails with one error list per alternative. Showing all of them is
 * noise; the author wrote one shape and wants to know what is wrong with it.
 * Pick the alternative that got furthest: it accepted the value's basic type
 * and has the fewest complaints.
 */
function pickUnionBranch(branches: ZodIssue[][]): ZodIssue[] | undefined {
  let best: ZodIssue[] | undefined
  let bestScore = Number.POSITIVE_INFINITY
  for (const branch of branches) {
    const wrongTypeAtRoot = branch.some((issue) => issue.path.length === 0 && issue.code === 'invalid_type')
    if (wrongTypeAtRoot) continue
    const score = branch.reduce((n, issue) => n + (issue.code === 'unrecognized_keys' ? issue.keys.length : 1), 0)
    if (score < bestScore) {
      best = branch
      bestScore = score
    }
  }
  return best
}

/* ───────────────── known keys, for "did you mean" suggestions ─────────── */

type JsonSchema = {
  $ref?: string
  properties?: Record<string, JsonSchema>
  additionalProperties?: JsonSchema | boolean
  items?: JsonSchema
  anyOf?: JsonSchema[]
  oneOf?: JsonSchema[]
  allOf?: JsonSchema[]
  $defs?: Record<string, JsonSchema>
}

const jsonSchemaCache = new WeakMap<z.ZodType, JsonSchema | null>()

function jsonSchemaOf(schema: z.ZodType): JsonSchema | null {
  let cached = jsonSchemaCache.get(schema)
  if (cached === undefined) {
    try {
      cached = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JsonSchema
    } catch {
      cached = null
    }
    jsonSchemaCache.set(schema, cached)
  }
  return cached
}

function knownKeysAt(schema: z.ZodType, path: Path): string[] {
  const root = jsonSchemaOf(schema)
  if (!root) return []

  const expand = (node: JsonSchema | boolean | undefined, depth = 0): JsonSchema[] => {
    if (!node || typeof node !== 'object' || depth > 8) return []
    if (node.$ref) {
      const name = node.$ref.split('/').pop() ?? ''
      return expand(node.$ref === '#' ? root : root.$defs?.[name], depth + 1)
    }
    return [node, ...[node.anyOf, node.oneOf, node.allOf].flatMap((list) => (list ?? []).flatMap((n) => expand(n, depth + 1)))]
  }

  let current = expand(root)
  for (const segment of path) {
    current = current.flatMap((node) =>
      typeof segment === 'number'
        ? expand(node.items)
        : [...expand(node.properties?.[segment]), ...expand(node.additionalProperties)],
    )
  }
  return [...new Set(current.flatMap((node) => Object.keys(node.properties ?? {})))]
}

/* ─────────────────────── data path → file position ───────────────────── */

function locate(
  doc: Document.Parsed,
  lineCounter: LineCounter,
  path: Path,
  target: 'value' | 'key',
): { line: number; column: number } | undefined {
  let node: Node | null | undefined = doc.contents
  /** Where the deepest segment that exists is written: a map key, or a list item. */
  let holder: Node | null | undefined
  let found = 0

  for (const segment of path) {
    if (isMap(node)) {
      const pair = node.items.find((item) => isScalar(item.key) && String(item.key.value) === String(segment))
      if (!pair) break
      holder = pair.key as Node
      node = pair.value as Node | null
    } else if (isSeq(node)) {
      const item = node.items[Number(segment)] as Node | undefined
      if (!item) break
      holder = item
      node = item
    } else {
      break
    }
    found++
  }

  let anchor: Node | null | undefined
  if (found === path.length) {
    // A key with no value (`title:`) has nothing to point at but the key itself.
    const empty = !node || (isScalar(node) && node.value === null)
    anchor = target === 'key' || empty ? (holder ?? node) : node
  } else {
    // The path stops short: a required key is missing. Point at its parent.
    anchor = holder ?? doc.contents
  }

  const offset = anchor?.range?.[0]
  if (offset === undefined) return undefined
  const position = lineCounter.linePos(offset)
  return { line: position.line, column: position.col }
}
