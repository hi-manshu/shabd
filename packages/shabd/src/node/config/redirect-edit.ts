/**
 * Adds one redirect to shabd.config.yaml by putting one line into its text.
 *
 * The config is the author's file. Its comments, its quoting, its blank
 * lines and the order of its keys are theirs, and writing the parsed config
 * back out would change some of them. So the config is never written out.
 * It is read only to find where the line belongs; the line goes in there,
 * and every other character of the file stays as it was.
 *
 * The result is then read back. It has to be the same config with that one
 * redirect more, and nothing else different. When the place cannot be found
 * (the redirects are written between braces on one line, say), or the result
 * does not read back that way, nothing is added and the caller is told why.
 */
import { isMap, isNode, isScalar, LineCounter, parseDocument, type Pair } from 'yaml'
import { normalizePath } from '../../shared/paths.js'
import { isShabdError } from './errors.js'
import { resolveConfig, type ResolvedConfig } from './load.js'

/** Why the line was not added. `line` is what to add by hand, under `redirects:`. */
interface Refused {
  ok: false
  problem: string
  line: string
}

export type RedirectEdit = { ok: true; source: string; line: string } | Refused

/** An edit that is known to leave a valid config, with that config. */
export type RedirectPlan = { ok: true; source: string; line: string; config: ResolvedConfig } | Refused

/** A path as YAML writes it: bare where a bare word cannot be read as anything else, in double quotes otherwise. */
const scalar = (text: string) => (/^\/[A-Za-z0-9/._~-]*$/.test(text) ? text : JSON.stringify(text))

const keyOf = (pair: Pair) => (isScalar(pair.key) ? String(pair.key.value) : undefined)

/** Where a node starts in the text, if the parser kept that. */
const startOf = (node: unknown) => (isNode(node) && node.range ? node.range[0] : undefined)

export function addRedirect(source: string, from: string, to: string): RedirectEdit {
  const line = `${scalar(from)}: ${scalar(to)}`
  const refuse = (problem: string): RedirectEdit => ({ ok: false, problem, line })

  const lines = new LineCounter()
  const document = parseDocument(source, { lineCounter: lines })
  if (document.errors.length > 0) return refuse('shabd.config.yaml cannot be read as YAML at the moment.')
  const root = document.contents
  if (!isMap(root) || root.flow) return refuse('shabd.config.yaml is not written as keys, one to a line.')

  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  /** Column, from 0, of a place in the text. */
  const columnOf = (offset: number) => lines.linePos(offset).col - 1
  /** Where the line that holds `offset` ends, before its line break. */
  const lineEnd = (offset: number) => {
    const feed = source.indexOf('\n', offset)
    if (feed === -1) return source.length
    return source[feed - 1] === '\r' ? feed - 1 : feed
  }
  const insertAt = (offset: number, text: string) => source.slice(0, offset) + text + source.slice(offset)
  /** How far this file indents what is under a key: taken from the first key that has something under it. */
  const indentUnit = () => {
    for (const pair of root.items) {
      const [outer, inner] = [startOf(pair.key), isMap(pair.value) && !pair.value.flow ? startOf(pair.value.items[0]?.key) : undefined]
      if (outer !== undefined && inner !== undefined && columnOf(inner) > columnOf(outer)) return columnOf(inner) - columnOf(outer)
    }
    return 2
  }

  let next: string
  const redirects = root.items.find((pair) => keyOf(pair) === 'redirects')
  if (!redirects) {
    // A block of its own at the end of the file, after an empty line.
    const gap = source === '' || source.endsWith('\n') ? '' : eol
    next = `${source}${gap}${eol}redirects:${eol}${' '.repeat(indentUnit())}${line}${eol}`
  } else {
    const { key, value } = redirects
    const keyStart = startOf(key)
    if (keyStart === undefined) return refuse('The `redirects:` key could not be found in the text of shabd.config.yaml.')
    if (isMap(value) && value.flow) {
      return refuse('The redirects in shabd.config.yaml are written between braces, and a line cannot be added to those without rewriting them.')
    }
    if (isMap(value) && value.items.length > 0) {
      // After the last redirect, with the indent the others have.
      const first = startOf(value.items[0]!.key)
      const last = value.items.at(-1)!
      const end = isNode(last.value) && last.value.range ? last.value.range[1] : isNode(last.key) && last.key.range ? last.key.range[1] : undefined
      if (first === undefined || end === undefined) return refuse('The redirects in shabd.config.yaml are written in a way a line cannot be added to.')
      next = insertAt(lineEnd(end), `${eol}${' '.repeat(columnOf(first))}${line}`)
    } else if (isScalar(value) && value.value === null && !value.source) {
      // `redirects:` with nothing under it yet.
      next = insertAt(lineEnd(keyStart), `${eol}${' '.repeat(columnOf(keyStart) + indentUnit())}${line}`)
    } else {
      return refuse('`redirects:` in shabd.config.yaml is not written as paths, one to a line.')
    }
  }

  // Read it back: the same config, with this one redirect more.
  const before = (document.toJS() ?? {}) as Record<string, unknown>
  const expected = { ...before, redirects: { ...((before.redirects as Record<string, unknown> | null) ?? {}), [from]: to } }
  const reread = parseDocument(next)
  if (reread.errors.length > 0 || JSON.stringify(reread.toJS()) !== JSON.stringify(expected)) {
    return refuse('The line could not be added to shabd.config.yaml without changing something else in it.')
  }
  return { ok: true, source: next, line }
}

/**
 * The edit that sends readers of `from`, an address a page has left, on to
 * `to`, the page's address now. Refused unless it is exactly that: `to` is a
 * page, `from` is not one and has no redirect yet, and the config with the
 * line added is still a valid one (a redirect back the other way would make
 * a circle).
 */
export function planRedirect(
  config: Pick<ResolvedConfig, 'root' | 'configFile' | 'redirects'>,
  source: string,
  from: unknown,
  to: unknown,
  isPage: (route: string) => boolean,
): RedirectPlan {
  /** An address as the content store writes one: `/guide/install`. Not `//another.site`, and nothing with a space, a `?` or a `#` in it. */
  const isRoute = (value: unknown): value is string =>
    typeof value === 'string' && /^\/[^\s?#]*$/.test(value) && !value.includes('//') && normalizePath(value) === value
  if (!isRoute(from) || !isRoute(to)) return { ok: false, problem: 'A redirect leads from one address on this site to another.', line: '' }

  const edit = addRedirect(source, from, to)
  const refuse = (problem: string): RedirectPlan => ({ ok: false, problem, line: edit.line })
  if (!isPage(to)) return refuse(`There is no page at ${to} to send readers to.`)
  if (isPage(from)) return refuse(`There is a page at ${from}, so a redirect from it would never be used.`)
  const existing = config.redirects.find((redirect) => redirect.from === from)
  if (existing) return refuse(`shabd.config.yaml already has a redirect from ${from}, to ${existing.to}.`)
  if (!edit.ok) return edit

  try {
    return { ...edit, config: resolveConfig(config.root, config.configFile, edit.source) }
  } catch (error) {
    if (!isShabdError(error)) throw error
    return refuse(error.issues[0]?.message ?? 'The config would no longer be valid.')
  }
}
