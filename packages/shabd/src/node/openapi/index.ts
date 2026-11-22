/**
 * Pages made from an OpenAPI description: an overview, and a page for each
 * operation.
 *
 * A page is ordinary Shabd Markdown with frontmatter, as if somebody had
 * written it. That is the point of making pages and not a component that
 * draws the description: search, llms.txt, the Markdown copy of each page
 * and the MCP tools read pages, and so they hold the API reference without
 * knowing where it came from.
 *
 * `generateApiPages` reads nothing and writes nothing. It is given the
 * description as it was parsed, and gives back the text of each page. What
 * becomes of the pages is for whoever calls it.
 *
 *   document.ts    reading the description safely, `$ref`, the notes
 *   schema.ts      schemas as tables of fields
 *   example.ts     examples, given or made
 *   request.ts     servers, authentication, the `curl` command
 *   markdown.ts    writing somebody else's text into a page
 *   operation.ts   the page of one operation
 *   overview.ts    the overview page
 *   read.ts        a description from a file
 */
import { HTTP_METHODS } from '../../shared/schema.js'
import { ShabdError } from '../config/errors.js'
import { Description, entriesOf, isNode, listOf, refusal, textOf, type Node } from './document.js'
import { Examples } from './example.js'
import { oneLine } from './markdown.js'
import { operationPage, type Operation, type Reader } from './operation.js'
import { overviewPage, type Group } from './overview.js'
import { Schemas } from './schema.js'

export { readOpenApi } from './read.js'

export interface GeneratedPage {
  /** Where the page goes under the folder the site gives this API, without an extension: `pets/list-pets`. Lowercase, URL-safe, unique. */
  slug: string
  /** The whole page: frontmatter block, then Markdown. */
  source: string
}

export interface GeneratedGroup {
  /** The tag's name as a heading for the sidebar. */
  label: string
  /** Slugs of the group's pages, in the order they should be listed. */
  slugs: string[]
}

export interface GeneratedApi {
  /** `info.title` of the document. */
  title: string
  /** An overview page first (slug `index`), then one page per operation. */
  pages: GeneratedPage[]
  /** Operations grouped by their first tag, in the order tags are declared; untagged operations last, in a group of their own. */
  groups: GeneratedGroup[]
  /** What could not be represented, in plain sentences: an external `$ref`, a callback, a construct that was skipped. */
  notes: string[]
}

export interface GenerateOptions {
  /** Put `try: true` in each page's `api:` frontmatter (a "Try it" panel is being built by someone else and reads that key). Default false. */
  tryIt?: boolean
}

/** What the error names in place of a file. The file is not known here: `readOpenApi` makes the same check where it is. */
const NO_FILE = 'OpenAPI description'

/**
 * The document as parsed YAML or JSON. Throws a ShabdError for a document
 * that is not OpenAPI 3.0 or 3.1.
 *
 * Anything else that is wrong with the document is left out or noted, and
 * never thrown: a description that is half right gives the pages of the
 * half that is.
 */
export function generateApiPages(document: unknown, options: GenerateOptions = {}): GeneratedApi {
  const issue = refusal(document)
  if (issue) throw new ShabdError(NO_FILE, [issue])

  const description = new Description(document as Node)
  const schemas = new Schemas(description)
  const reader: Reader = { description, schemas, examples: new Examples(description, schemas) }
  const { root } = description

  if (entriesOf(root.webhooks).length > 0) {
    const names = entriesOf(root.webhooks).map(([name]) => `\`${name}\``)
    description.note('webhooks', `The description has webhooks, which are not shown: ${names.join(', ')}.`)
  }

  const info = isNode(root.info) ? root.info : {}
  const title = oneLine(textOf(info.title) ?? '') || 'API reference'
  const groups = groupsOf(description, operationsOf(description))
  const pages: GeneratedPage[] = [
    { slug: 'index', source: overviewPage(reader, title, groups) },
    ...groups.flatMap((group) => group.operations.map((operation) => ({ slug: operation.slug, source: operationPage(reader, operation, { tryIt: options.tryIt === true }) }))),
  ]

  return {
    title,
    pages,
    groups: groups.map(({ label, operations }) => ({ label, slugs: operations.map((operation) => operation.slug) })),
    // Read last: the notes are made while the pages are.
    notes: description.notes,
  }
}

/** Every operation of the description, in the order it is written. */
function operationsOf(description: Description): Operation[] {
  const operations: Operation[] = []
  for (const [path, written] of entriesOf(description.root.paths)) {
    // Beside the paths a description may keep keys of its own, which start with `x-`.
    if (!path.startsWith('/')) continue
    const item = description.resolve(written, `the path \`${oneLine(path)}\``)?.node
    for (const [key, node] of entriesOf(item)) {
      if (!item || !isNode(node)) continue
      const method = HTTP_METHODS.find((name) => name === key.toUpperCase())
      if (key.toLowerCase() === 'trace') {
        description.note(`trace ${path}`, `\`TRACE ${oneLine(path)}\` was left out: the request line of a page has no TRACE.`)
      }
      // What is left is not an operation: `parameters`, `servers`, a key of the description's own.
      if (method === undefined) continue
      operations.push({
        method,
        path,
        node,
        item,
        where: `\`${method} ${oneLine(path)}\``,
        title: oneLine(textOf(node.summary) ?? '') || `${method} ${oneLine(path)}`,
        deprecated: node.deprecated === true,
      })
    }
  }
  return operations
}

/**
 * The operations by their first tag: the tags the document declares, in
 * its order, then those it only uses, then the operations with no tag.
 * Each operation is given the slug of its page here, since a slug has to
 * be unlike every other.
 */
function groupsOf(description: Description, operations: Operation[]): Group[] {
  const tagged = new Map<string, { tag: Node; operations: Operation[] }>()
  for (const tag of listOf(description.root.tags)) {
    const name = isNode(tag) ? textOf(tag.name) : undefined
    if (isNode(tag) && name !== undefined && !tagged.has(name)) tagged.set(name, { tag, operations: [] })
  }
  const untagged: Operation[] = []
  for (const operation of operations) {
    const name = listOf(operation.node.tags).flatMap((tag) => textOf(tag) ?? [])[0]
    if (name === undefined) untagged.push(operation)
    else if (tagged.has(name)) tagged.get(name)!.operations.push(operation)
    else tagged.set(name, { tag: {}, operations: [operation] })
  }

  const taken = new Set(['index'])
  const folders = new Set<string>()
  const groups: Group[] = []
  for (const [label, { tag, operations }] of tagged) {
    if (operations.length === 0) continue
    const folder = unlike(slugify(label) || 'group', folders)
    groups.push({ label, tag, operations: operations.map((operation) => ({ ...operation, slug: unlike(`${folder}/${slugOf(operation)}`, taken) })) })
  }
  if (untagged.length > 0) {
    groups.push({
      label: groups.length > 0 ? 'Other' : 'Operations',
      operations: untagged.map((operation) => ({ ...operation, slug: unlike(slugOf(operation), taken) })),
    })
  }
  return groups
}

/** A page's name: from the `operationId` its author gave it, or from its method and path. */
function slugOf(operation: Operation): string {
  return slugify(textOf(operation.node.operationId) ?? '') || slugify(`${operation.method} ${operation.path}`) || operation.method.toLowerCase()
}

/** `listPets`, `list_pets` and `List Pets` are all `list-pets`. Nothing but `a` to `z`, digits and hyphens is left. */
function slugify(text: string): string {
  return (
    text
      // `é` as `e` and an accent, and then without the accent.
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      // A name of any length is a file name of any length, and a file system has a limit.
      .slice(0, 80)
      .replace(/-+$/, '')
  )
}

/** The names a page cannot have: `index` is its folder's own page, and the rest are devices to Windows, whatever follows the dot. */
const NOT_A_NAME = /(?:^|\/)(?:index|con|prn|aux|nul|com\d|lpt\d)$/

/** The slug, or the slug with a number after it when it is taken. */
function unlike(slug: string, taken: Set<string>): string {
  let candidate = slug
  for (let n = 2; taken.has(candidate) || NOT_A_NAME.test(candidate); n++) candidate = `${slug}-${n}`
  taken.add(candidate)
  return candidate
}
