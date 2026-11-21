/**
 * What it takes to make a request: where the API is served, what a caller
 * shows to be let in, and the `curl` command that puts those together with
 * an operation.
 */
import { entriesOf, isNode, listOf, textOf, type Description, type Node } from './document.js'
import { oneLine } from './markdown.js'

/* ───────────────────────────────── servers ────────────────────────────── */

export interface Server {
  /** The address, with each variable filled in by its default and no slash at the end. */
  url: string
  /** The address as the description writes it, when it has variables: `https://{region}.example.com`. */
  template?: string
  variables: { name: string; value: string; others: string[] }[]
  /** Markdown. */
  description?: string
}

/** The servers of the first of these that names any: an operation's own come before its path's, and those before the document's. */
export function serversOf(...holders: (Node | undefined)[]): Server[] {
  for (const holder of holders) {
    const servers = listOf(holder?.servers).flatMap((server) => {
      const written = isNode(server) ? textOf(server.url) : undefined
      if (!isNode(server) || written === undefined) return []
      const variables = entriesOf(server.variables).flatMap(([name, variable]) => {
        if (!isNode(variable)) return []
        const allowed = listOf(variable.enum).flatMap((value) => textOf(value) ?? [])
        const value = textOf(variable.default) ?? allowed[0]
        return value === undefined ? [] : [{ name, value, others: allowed.filter((other) => other !== value) }]
      })
      const template = oneLine(written)
      const url = template.replace(/\{([^{}]+)\}/g, (match, name: string) => variables.find((variable) => variable.name === name)?.value ?? match)
      const description = textOf(server.description)
      return [
        {
          url: url.replace(/\/+$/, ''),
          variables,
          ...(variables.length > 0 ? { template } : {}),
          ...(description !== undefined ? { description } : {}),
        },
      ]
    })
    if (servers.length > 0) return servers
  }
  return []
}

/* ─────────────────────────────────── auth ─────────────────────────────── */

/** One way a caller shows who they are, and what a request carries for it. */
export interface Scheme {
  /** `Bearer token`, `API key in the X-API-Key header`. */
  phrase: string
  header?: [name: string, value: string]
  query?: [name: string, value: string]
  cookie?: [name: string, value: string]
  /** What `curl --user` is given, for HTTP Basic. */
  user?: string
}

/** A security scheme as a phrase, and as what a request carries. `scopes` are the ones an operation asks for. */
export function schemeOf(name: string, scheme: Node | undefined, scopes: string[] = []): Scheme {
  const bearer: [string, string] = ['Authorization', 'Bearer <token>']
  const scoped = scopes.length > 0 ? ` with the scope${scopes.length === 1 ? '' : 's'} ${scopes.join(', ')}` : ''

  switch (textOf(scheme?.type)) {
    case 'http': {
      const kind = (textOf(scheme?.scheme) ?? '').toLowerCase()
      const format = textOf(scheme?.bearerFormat)
      if (kind === 'bearer') return { phrase: `Bearer token${format ? ` (${oneLine(format)})` : ''}`, header: bearer }
      if (kind === 'basic') return { phrase: 'HTTP Basic', user: '<username>:<password>' }
      const named = kind.charAt(0).toUpperCase() + kind.slice(1)
      return { phrase: oneLine(`HTTP ${named}`), header: ['Authorization', oneLine(`${named} <credentials>`)] }
    }
    case 'apiKey': {
      const key = oneLine(textOf(scheme?.name) ?? name)
      if (scheme?.in === 'query') return { phrase: `API key in the ${key} query parameter`, query: [key, '<api-key>'] }
      if (scheme?.in === 'cookie') return { phrase: `API key in the ${key} cookie`, cookie: [key, '<api-key>'] }
      return { phrase: `API key in the ${key} header`, header: [key, '<api-key>'] }
    }
    case 'oauth2':
      return { phrase: `OAuth 2.0${scoped}`, header: bearer }
    case 'openIdConnect':
      return { phrase: `OpenID Connect${scoped}`, header: bearer }
    case 'mutualTLS':
      return { phrase: 'Client certificate (mutual TLS)' }
    default:
      // A name that leads to no scheme, or a scheme of a kind that is not known: the name is all there is to say.
      return { phrase: oneLine(name) }
  }
}

export interface Auth {
  /** What a request needs, as the request line says it: `Bearer token`, or `none`. */
  phrase: string
  /** The schemes of the first way in, which is the one the `curl` command shows. */
  schemes: Scheme[]
}

/**
 * What an operation asks of a caller: its own `security`, or the
 * document's when it has none. Left out, the document's own is given.
 *
 * `security` is a list of ways in, any one of which will do, and each way
 * may need several schemes at once. An empty way means none is needed.
 */
export function authOf(description: Description, operation?: Node): Auth {
  const { root } = description
  const written = operation && Array.isArray(operation.security) ? operation.security : listOf(root.security)
  const ways = written.filter(isNode)
  const real = ways.filter((way) => Object.keys(way).length > 0)
  if (real.length === 0) return { phrase: 'none', schemes: [] }

  const declared = isNode(root.components) ? root.components.securitySchemes : undefined
  const schemes = real.map((way) =>
    Object.entries(way).map(([name, scopes]) => {
      const scheme = isNode(declared) && Object.hasOwn(declared, name) ? description.resolve(declared[name], `the security scheme \`${name}\``)?.node : undefined
      return schemeOf(name, scheme, listOf(scopes).flatMap((scope) => (textOf(scope) === undefined ? [] : [oneLine(textOf(scope)!)])))
    }),
  )
  const phrases = [...new Set(schemes.map((way) => way.map((scheme) => scheme.phrase).join(' and ')))]
  // A way that asks for nothing, beside ways that ask for something: showing who you are is a choice.
  if (real.length < ways.length) phrases.push('none')
  return { phrase: phrases.join(', or '), schemes: schemes[0] ?? [] }
}

/* ─────────────────────────────────── curl ─────────────────────────────── */

/** A value as text, the way it is written into an address or a header. */
export function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map(asText).join(',')
  if (typeof value !== 'object') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

/** Text as it is written into an address. */
export function inUrl(text: string): string {
  try {
    return encodeURIComponent(text)
  } catch {
    // Half of a surrogate pair, which has no encoding.
    return ''
  }
}

/**
 * A query parameter as the names and values that are sent for it. A list or
 * an object can be sent in several ways, and `style` and `explode` say which.
 */
export function queryPairs(name: string, value: unknown, parameter: Node): [string, string][] {
  const style = textOf(parameter.style) ?? 'form'
  const explode = typeof parameter.explode === 'boolean' ? parameter.explode : style === 'form'
  const pair = (key: string, item: unknown): [string, string] => [inUrl(key).replace(/%5B/g, '[').replace(/%5D/g, ']'), inUrl(asText(item))]

  if (Array.isArray(value)) {
    if (style === 'form' && explode) return value.map((item) => pair(name, item))
    return [pair(name, value.map(asText).join(style === 'spaceDelimited' ? ' ' : style === 'pipeDelimited' ? '|' : ','))]
  }
  if (isNode(value)) {
    if (style === 'deepObject') return Object.entries(value).map(([key, item]) => pair(`${name}[${key}]`, item))
    if (explode) return Object.entries(value).map(([key, item]) => pair(key, item))
    return [pair(name, Object.entries(value).flat().map(asText).join(','))]
  }
  return [pair(name, value)]
}

export interface CurlRequest {
  method: string
  /** The whole address: server, path and query. */
  url: string
  /** Each option after the address, with its value: `['--header', 'Accept: text/plain']`. */
  options: [flag: string, value: string][]
}

/** A request as a `curl` command, one option to a line. */
export function curl({ method, url, options }: CurlRequest): string {
  // Between single quotes a shell reads nothing but the quote that ends them.
  const quote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`
  // `--request HEAD` would have curl wait for a body that never comes.
  const lines = [method === 'HEAD' ? 'curl --head' : `curl --request ${method}`]
  // curl takes braces and brackets in an address for a pattern to expand.
  if (/[{}[\]]/.test(url)) lines.push('--globoff')
  lines.push(`--url ${quote(url)}`, ...options.map(([flag, value]) => `${flag} ${quote(value)}`))
  return lines.join(' \\\n  ')
}
