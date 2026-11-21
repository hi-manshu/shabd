/** What an API page's request line is made of. The page that shows it and the form that sends it read it the same way. */

/** A piece of a path: plain text, or a parameter a caller fills in. */
export interface PathPart {
  /** The piece as the path writes it, `{id}` or `:id` included. */
  text: string
  /** The parameter's name, when the piece is one. */
  parameter?: string
}

const PARAMETER = /\{([^}]+)\}|(\/):([A-Za-z_]\w*)/g

/**
 * A path, cut where its parameters are: `{id}` anywhere, and `:id` where a
 * segment starts.
 *
 * A colon in the middle of a segment is not a parameter. `/files/{id}:copy`
 * is how some APIs name an action, and `:copy` is sent as it is written.
 */
export function pathParts(path: string): PathPart[] {
  const parts: PathPart[] = []
  let end = 0
  for (const match of path.matchAll(PARAMETER)) {
    // The slash before a colon name belongs to the text in front of it.
    const start = match.index + (match[2] ? 1 : 0)
    if (start > end) parts.push({ text: path.slice(end, start) })
    end = match.index + match[0].length
    parts.push({ text: path.slice(start, end), parameter: (match[1] ?? match[3])! })
  }
  if (end < path.length) parts.push({ text: path.slice(end) })
  return parts
}

/** The names of a path's parameters, each once, in the order they are written. */
export function pathParameters(path: string): string[] {
  return [...new Set(pathParts(path).flatMap((part) => (part.parameter === undefined ? [] : [part.parameter])))]
}

/**
 * The path with a value in the place of each parameter that has one. A value
 * is encoded, so that a slash or a space in it stays inside its segment.
 */
export function fillPath(path: string, values: Record<string, string>): string {
  return pathParts(path)
    .map((part) => {
      const value = part.parameter === undefined ? '' : (values[part.parameter] ?? '')
      return value ? encodeURIComponent(value) : part.text
    })
    .join('')
}

/**
 * The address a request is sent to: the API's address, the path, and a query
 * when there is one. `query` is taken as it is typed, with or without its
 * question mark.
 */
export function requestUrl(base: string, path: string, query = ''): string {
  const search = query.trim().replace(/^\?/, '')
  return `${base.trim().replace(/\/+$/, '')}${path}${search ? `?${search}` : ''}`
}

/** What a header's name may be made of (RFC 9110, "token"). */
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
/** What its value may hold: a browser refuses anything outside one byte a character. */
const HEADER_VALUE = /^[\t\x20-\x7e\x80-\xff]*$/

export type ReadHeaders = { headers: [name: string, value: string][] } | { problem: string }

/**
 * Headers as a reader types them: `Name: value`, one to a line.
 *
 * A browser throws on a header it cannot send, and does not say which one it
 * was. So each line is checked here, where the line can be named.
 */
export function readHeaders(text: string): ReadHeaders {
  const headers: [string, string][] = []
  for (const written of text.split('\n')) {
    const line = written.trim()
    if (!line) continue
    const colon = line.indexOf(':')
    if (colon < 1) return { problem: `A header is written "Name: value". This line is not: ${line}` }
    const name = line.slice(0, colon).trim()
    const value = line.slice(colon + 1).trim()
    if (!HEADER_NAME.test(name)) return { problem: `"${name}" is not a name a header can have.` }
    if (!HEADER_VALUE.test(value)) return { problem: `The value of ${name} holds a character a header cannot carry.` }
    headers.push([name, value])
  }
  return { headers }
}
