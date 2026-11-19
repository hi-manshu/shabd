/**
 * One operation as a page.
 *
 * The page is read in two ways, and has to say enough in both. On the site,
 * the `api` layout draws the request line from the frontmatter. In the
 * page's Markdown copy, which is what an AI agent is given, the frontmatter
 * is gone. There the `curl` command at the end is what says how the request
 * is made, so it carries the method, the whole address and every header the
 * request needs, and not a body alone.
 */
import { entriesOf, isNode, listOf, textOf, type Description, type Node } from './document.js'
import type { Examples } from './example.js'
import { code, escapeText, fence, firstSentence, frontmatter, keep, link, oneLine, table } from './markdown.js'
import { asText, authOf, curl, inUrl, queryPairs, serversOf, type CurlRequest, type Scheme } from './request.js'
import { MAX_FIELDS, type Direction, type Example, type Flat, type Schemas } from './schema.js'

/** What every page is made with: the description, and what is worked out from it once. */
export interface Reader {
  description: Description
  schemas: Schemas
  examples: Examples
}

export interface Operation {
  /** `GET`. */
  method: string
  path: string
  node: Node
  /** The path the operation is under, which may give it parameters and servers. */
  item: Node
  /** How a note names the operation, as Markdown: `GET /pets` in backticks. */
  where: string
  /** Its summary, or its method and path where it has none. */
  title: string
  deprecated: boolean
}

const PLACES = [
  ['path', 'Path parameters'],
  ['query', 'Query parameters'],
  ['header', 'Header parameters'],
  ['cookie', 'Cookie parameters'],
] as const

interface Parameter {
  name: string
  place: (typeof PLACES)[number][0]
  node: Node
  schema: unknown
  required: boolean
  where: string
  /** The content type a parameter is written in, when it has one in place of a schema. */
  encoded?: string
}

/** A name and its value, or an option of `curl` and its value. */
type Pair = [string, string]

const isJson = (type: string) => /[/+]json\b/i.test(type)
const isForm = (type: string) => /^(?:application\/x-www-form-urlencoded|multipart\/form-data)\b/i.test(type)

export function operationPage(reader: Reader, operation: Operation, options: { tryIt: boolean }): string {
  const { description } = reader
  const { node, item, method, where } = operation
  const [server] = serversOf(node, item, description.root)
  const auth = authOf(description, node)
  const about = textOf(node.description)
  const summary = about === undefined ? '' : firstSentence(about)

  if (entriesOf(node.callbacks).length > 0) {
    const names = entriesOf(node.callbacks).map(([name]) => `\`${name}\``)
    description.note(`callbacks ${where}`, `${where} has callbacks, which are not shown: ${names.join(', ')}.`)
  }

  const parameters = parametersOf(reader, operation)
  const body = requestBody(reader, operation)
  const blocks = [
    about === undefined ? '' : keep(about, { headings: 3, dropped: description.pictures(where) }),
    readMore(node),
    ...parameterBlocks(reader, parameters),
    ...body.blocks,
    ...responseBlocks(reader, operation),
    '## Example request',
    fence(curl(request(reader, operation, parameters, body, server?.url ?? '', auth.schemes)), 'sh title="curl"'),
  ]

  const page = frontmatter({
    title: operation.title,
    ...(summary ? { description: summary } : {}),
    layout: 'api',
    api: {
      method,
      path: oneLine(operation.path),
      ...(server?.url ? { baseUrl: server.url } : {}),
      auth: auth.phrase,
      deprecated: operation.deprecated,
      ...(options.tryIt ? { try: true } : {}),
    },
    // The page has no file of its own in the repository to edit.
    editLink: false,
    ...(operation.deprecated ? { badges: ['Deprecated'] } : {}),
  })
  return `${page}\n${blocks.filter(Boolean).join('\n\n')}\n`
}

/** `externalDocs` as a link, when it leads to another site. */
export function readMore(node: Node): string {
  const docs = isNode(node.externalDocs) ? node.externalDocs : undefined
  const url = textOf(docs?.url)
  if (url === undefined || !/^https?:\/\//i.test(url)) return ''
  return link(textOf(docs?.description) ?? url, url)
}

/* ──────────────────────────────── parameters ──────────────────────────── */

/** The operation's parameters, with those its path gives it. One of the operation's own takes the place of the path's. */
function parametersOf({ description }: Reader, { node, item, where }: Operation): Parameter[] {
  const found = new Map<string, Parameter>()
  for (const written of [...listOf(item.parameters), ...listOf(node.parameters)]) {
    const parameter = description.resolve(written, `a parameter of ${where}`)?.node
    const name = textOf(parameter?.name)
    if (!parameter || name === undefined) continue
    const place = PLACES.find(([place]) => place === parameter.in)?.[0]
    if (place === undefined) {
      const said = oneLine(String(parameter.in))
      description.note(`parameter in ${said} ${name}`, `The parameter \`${name}\` is in \`${said}\`, which is not a place OpenAPI 3 has, and was left out. First met in ${where}.`)
      continue
    }
    // OpenAPI has these three said elsewhere: by the content types, and by `security`.
    if (place === 'header' && /^(?:accept|content-type|authorization)$/i.test(name)) continue

    const [type, media] = entriesOf(parameter.content)[0] ?? []
    const encoded = parameter.schema === undefined && type !== undefined && isNode(media)
    found.set(`${place} ${name}`, {
      name,
      place,
      node: parameter,
      schema: encoded ? media.schema : parameter.schema,
      required: place === 'path' || parameter.required === true,
      where: `the parameter \`${name}\` of ${where}`,
      ...(encoded ? { encoded: type } : {}),
    })
  }
  return [...found.values()]
}

function parameterBlocks(reader: Reader, parameters: Parameter[]): string[] {
  const blocks = PLACES.flatMap(([place, heading]) => {
    const rows = parameters.filter((parameter) => parameter.place === place).flatMap((parameter) => namedRows(reader, parameter, 'request', howSent(reader, parameter)))
    return rows.length > 0 ? [`### ${heading}`, table(['Name', 'Type', 'Required', 'Description'], rows)] : []
  })
  return blocks.length > 0 ? ['## Parameters', ...blocks] : []
}

/**
 * The rows for something with a name: a parameter, or a header of a
 * response. Its own line says what the parameter says of itself, which is
 * more particular than what its schema says, and then come the lines for
 * what is inside it. The values it may take are written in the description.
 */
function namedRows({ schemas, examples }: Reader, named: Pick<Parameter, 'name' | 'node' | 'schema' | 'required' | 'where'>, direction: Direction, more: string[] = []): string[][] {
  const { tables } = schemas.named(named.schema, named.name, named.required, named.where, direction)
  return tables
    .flatMap((table) => table.fields)
    .map((field, index) => {
      if (index > 0) return schemas.cells(field, named.where, { values: 'description' })
      return schemas.cells(field, named.where, {
        values: 'description',
        description: textOf(named.node.description),
        example: examples.given(named.node, named.where),
        more: [...more, ...(named.node.deprecated === true && field.flat.node.deprecated !== true ? ['Deprecated.'] : [])],
      })
    })
}

/** How a query parameter that is a list or an object is written into the address, which OpenAPI leaves to `style` and `explode`. */
function howSent({ schemas }: Reader, parameter: Parameter): string[] {
  if (parameter.encoded) return [`Written as ${code(parameter.encoded)}.`]
  if (parameter.place !== 'query') return []
  const types = schemas.types(schemas.flat(parameter.schema, parameter.where))
  const style = textOf(parameter.node.style) ?? 'form'
  const explode = typeof parameter.node.explode === 'boolean' ? parameter.node.explode : style === 'form'
  if (types.includes('array')) {
    if (style === 'form' && explode) return ['Repeat the parameter for each value.']
    return [`Its values are separated by ${style === 'spaceDelimited' ? 'spaces' : style === 'pipeDelimited' ? '`|`' : 'commas'}.`]
  }
  if (types.includes('object')) {
    if (style === 'deepObject') return [`Each field is written as ${code(`${parameter.name}[field]`)}.`]
    return [explode ? 'Each field is a parameter of its own.' : 'Its fields are written as one value: each name, then its value, separated by commas.']
  }
  return []
}

/* ────────────────────────────────── bodies ────────────────────────────── */

interface Content {
  blocks: string[]
  /** What a note calls it: "the request body of `POST /pets`". */
  where?: string
  /** The content type that is described: JSON where there is a choice. */
  type?: string
  flat?: Flat
  example?: Example
}

/**
 * What a request or a response carries: its content type, the fields of
 * its schema, and an example.
 *
 * When there are several content types, one is described and the others
 * are named. That is JSON where it is offered, because the tables and the
 * example are written for JSON.
 */
function contentOf({ description, schemas, examples }: Reader, content: unknown, where: string, direction: Direction, lead: string[] = []): Content {
  const offered = entriesOf(content).flatMap(([type, media]) => (isNode(media) ? [{ type, media }] : []))
  const chosen = offered.find(({ type }) => /^application\/json\b/i.test(type)) ?? offered.find(({ type }) => isJson(type)) ?? offered[0]
  if (!chosen) return { blocks: lead.length > 0 ? [lead.join(' ')] : [] }
  const { type, media } = chosen

  if (media.encoding !== undefined) description.note(`encoding ${where}`, `In ${where}, \`encoding\` says how each part of the body is sent, which is not shown.`)

  const flat = schemas.flat(media.schema, where)
  const others = offered.filter((other) => other.type !== type).map((other) => code(other.type))
  const said = [`Content type: ${code(type)}.`, ...lead]
  if (others.length > 0) said.push(`Other content types, which are not described here: ${others.join(', ')}.`)
  // An object needs no saying: the table of its fields says it. Anything else has no table to say it.
  const kind = schemas.kind(flat, where)
  if (media.schema !== undefined && kind !== code('object')) said.push(`Type: ${kind}.`, ...schemas.details(flat))
  const blocks = [said.join(' ')]

  const listing = schemas.body(media.schema, where, direction)
  for (const { caption, fields, stopped } of listing.tables) {
    if (caption) blocks.push(stopped ? `${caption}. ${stopped}` : `${caption}:`)
    if (fields.length > 0) {
      blocks.push(table(['Field', 'Type', 'Required', 'Description'], fields.map((field) => schemas.cells(field, where, { values: 'type' }))))
    }
  }
  if (listing.cut) blocks.push(`The schema has more fields than these. The tables stop at ${MAX_FIELDS} lines.`)

  // An example is made for the content types it can be written in: JSON, and the fields of a form.
  const example = examples.given(media, where) ?? (isJson(type) || isForm(type) ? examples.made(flat, where, direction) : undefined)
  const shown = example && !isForm(type) ? exampleBlock(example, type) : ''
  if (shown) blocks.push(shown)
  return { blocks, where, type, flat, ...(example ? { example } : {}) }
}

function exampleBlock(example: Example, type: string): string {
  let { value } = example
  // Some descriptions give a JSON example as the text of it. It is shown as the JSON it is.
  if (isJson(type) && typeof value === 'string' && /^\s*[[{]/.test(value)) {
    try {
      value = JSON.parse(value)
    } catch {
      // Not JSON after all: it is shown as the text it is.
    }
  }
  if (!isJson(type) && typeof value === 'string') {
    const language = /xml/i.test(type) ? 'xml' : /html/i.test(type) ? 'html' : /yaml/i.test(type) ? 'yaml' : /csv/i.test(type) ? 'csv' : 'text'
    return fence(value, `${language} title="Example"`)
  }
  const json = toJson(value)
  return json === undefined ? '' : fence(json, 'json title="Example"')
}

function toJson(value: unknown): string | undefined {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    // A value that holds itself, which YAML can write and JSON cannot.
    return undefined
  }
}

/** What is said of a body or a response whose `$ref` could not be followed: that it is there, which is all that is known of it. */
function unread(value: unknown): string {
  return isNode(value) && typeof value.$ref === 'string' ? `This is described at ${code(value.$ref)}, which could not be read.` : ''
}

function requestBody(reader: Reader, { node, where }: Operation): Content {
  const place = `the request body of ${where}`
  const body = reader.description.resolve(node.requestBody, place)?.node
  if (!body) return { blocks: unread(node.requestBody) ? ['## Request body', unread(node.requestBody)] : [] }
  const about = textOf(body.description)
  const content = contentOf(reader, body.content, place, 'request', body.required === true ? ['The body is required.'] : [])
  return {
    ...content,
    blocks: ['## Request body', about === undefined ? '' : keep(about, { headings: 3, dropped: reader.description.pictures(place) }), ...content.blocks],
  }
}

function responseBlocks(reader: Reader, { node, where }: Operation): string[] {
  const { description } = reader
  const blocks: string[] = []
  for (const [status, written] of entriesOf(node.responses)) {
    // Beside the status codes a description may keep keys of its own, which start with `x-`.
    if (/^x-/i.test(status) || oneLine(status) === '') continue
    const place = `the response \`${oneLine(status)}\` of ${where}`
    const heading = `### ${escapeText(oneLine(status))}`
    const response = description.resolve(written, place)?.node
    if (!response) {
      if (unread(written)) blocks.push(heading, unread(written))
      continue
    }

    const about = textOf(response.description)
    const headers = entriesOf(response.headers).flatMap(([name, header]) => {
      const resolved = description.resolve(header, place)?.node
      // The content type is said by `content`.
      if (!resolved || /^content-type$/i.test(name)) return []
      return namedRows(reader, { name, node: resolved, schema: resolved.schema, required: resolved.required === true, where: `the header \`${name}\` in ${place}` }, 'response')
    })
    if (entriesOf(response.links).length > 0) {
      const names = entriesOf(response.links).map(([name]) => `\`${name}\``)
      description.note(`links ${place}`, `In ${place}, links are not shown: ${names.join(', ')}.`)
    }

    blocks.push(
      heading,
      about === undefined ? '' : keep(about, { headings: 4, dropped: description.pictures(place) }),
      ...(headers.length > 0 ? ['Headers:', table(['Header', 'Type', 'Required', 'Description'], headers)] : []),
      ...contentOf(reader, response.content, place, 'response').blocks,
    )
  }
  return blocks.length > 0 ? ['## Responses', ...blocks] : []
}

/* ───────────────────────────────── the request ────────────────────────── */

/**
 * The request the `curl` command makes: what the operation cannot do
 * without, and no more. A parameter that is not required is in its table.
 */
function request({ schemas, examples }: Reader, operation: Operation, parameters: Parameter[], body: Content, server: string, schemes: Scheme[]): CurlRequest {
  const inPath = new Map<string, string>()
  const query: Pair[] = []
  const headers: Pair[] = schemes.flatMap((scheme) => (scheme.header ? [scheme.header] : []))
  const cookies: Pair[] = schemes.flatMap((scheme) => (scheme.cookie ? [scheme.cookie] : []))

  for (const parameter of parameters) {
    const flat = schemas.flat(parameter.schema, parameter.where)
    const known = examples.given(parameter.node, parameter.where) ?? examples.named(flat)
    if (parameter.place === 'path') {
      // Without a value the description names, `{id}` stays in the address: it says what goes there, and a made-up id would not.
      if (known) inPath.set(parameter.name, inUrl(asText(known.value)))
      continue
    }
    if (!parameter.required) continue
    const value = (known ?? examples.made(flat, parameter.where, 'request'))?.value ?? `<${parameter.name}>`
    if (parameter.place === 'header') headers.push([parameter.name, asText(value)])
    else if (parameter.place === 'cookie') cookies.push([parameter.name, asText(value)])
    else if (parameter.encoded) query.push([inUrl(parameter.name), inUrl(asText(value))])
    else query.push(...queryPairs(parameter.name, value, parameter.node))
  }
  for (const scheme of schemes) if (scheme.query) query.push([inUrl(scheme.query[0]), scheme.query[1]])

  const path = oneLine(operation.path).replace(/\{([^{}]+)\}/g, (match, name: string) => inPath.get(name) ?? match)
  const asked = query.map(([name, value]) => `${name}=${value}`).join('&')
  const sent = bodyOptions(schemas, body)
  const user = schemes.find((scheme) => scheme.user)?.user

  const options: Pair[] = user ? [['--user', user]] : []
  for (const [name, value] of [...headers, ...sent.headers]) {
    // A header's name is a word of these characters and no others. One that is not is left out: `--header @file`
    // reads a file, and a name from a description must not be able to say which.
    if (/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) options.push(['--header', oneLine(`${name}: ${value}`)])
  }
  if (cookies.length > 0) options.push(['--cookie', oneLine(cookies.map(([name, value]) => `${name}=${value}`).join('; '))])
  return { method: operation.method, url: `${server}${path}${asked ? `?${asked}` : ''}`, options: [...options, ...sent.options] }
}

/**
 * A body as the options `curl` sends it with. Each kind of content has its
 * own.
 *
 * The values come from the description, and `curl` reads a value that
 * starts with `@` as the name of a file to send. So values go in with the
 * options that take them as they are written: `--data-raw` and not
 * `--data`, `--form-string` and not `--form`. The one `@` in a command is
 * the one written here, for a field that is a file.
 */
function bodyOptions(schemas: Schemas, { type, flat, example, where = '' }: Content): { headers: Pair[]; options: Pair[] } {
  if (type === undefined) return { headers: [], options: [] }
  const fields = isNode(example?.value) ? Object.entries(example.value) : []

  // curl names the content type of a form itself.
  if (/^application\/x-www-form-urlencoded\b/i.test(type)) {
    // curl encodes what follows the `=`, and takes the name before it as encoded already.
    const options = fields.flatMap(([name, value]) => (Array.isArray(value) ? value : [value]).map((item): Pair => ['--data-urlencode', `${inUrl(name)}=${asText(item)}`]))
    return { headers: [], options }
  }
  if (/^multipart\/form-data\b/i.test(type)) {
    const isFile = (name: string) => {
      const property = flat?.properties.get(name)
      return property !== undefined && textOf(schemas.flat(property, where).node.format) === 'binary'
    }
    const part = ([name, value]: [string, unknown]): Pair => {
      if (!isFile(name)) return ['--form-string', `${name}=${asText(value)}`]
      // `--form` splits at the first `=` and reads on from there, so only a plain name may come before the one written here.
      return /^[\w.[\]-]+$/.test(name) ? ['--form', `${name}=@path/to/file`] : ['--form-string', `${name}=<file>`]
    }
    return { headers: [], options: fields.map(part) }
  }

  const headers: Pair[] = [['Content-Type', type]]
  if (isJson(type)) {
    const json = example === undefined ? undefined : toJson(example.value)
    return { headers, options: json === undefined ? [] : [['--data-raw', json]] }
  }
  if (typeof example?.value === 'string') return { headers, options: [['--data-raw', example.value]] }
  // Anything else is a file as far as curl is concerned.
  return { headers, options: flat && textOf(flat.node.format) === 'binary' ? [['--data-binary', '@path/to/file']] : [] }
}
