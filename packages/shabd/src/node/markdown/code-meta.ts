/**
 * The text after a fence's language is its "meta":
 *
 *   ```ts title="src/app.ts" {2,4-6} showLineNumbers
 *   ```ts ins={3-4} del={2}
 *   ```tsx live group="cart"
 */
export interface CodeMeta {
  title: string | undefined
  /** 1-based line numbers to emphasise. */
  highlight: number[]
  /** 1-based line numbers marked as added, and as removed: `ins={3-4}`, `del={2}`. */
  inserted: number[]
  deleted: number[]
  /** Bare words: `live`, `isolated`, `showLineNumbers`, `noLineNumbers`, `wrap`, `noWrap`, `noVars`. */
  flags: Set<string>
  /** `key="value"` pairs other than `title`, `ins` and `del`. */
  attrs: Record<string, string>
}

/**
 * One piece of meta: `{2,4}`, then `key={2,4}`, `key="value"`, `key='value'`
 * or `key=value`, then a bare word. A key with braces is tried before a key
 * with a bare value, so that `ins={2, 4}` may have a space in it.
 */
const TOKEN =
  /\{([\d,\s-]+)\}|([A-Za-z][\w-]*)=(?:\{([\d,\s-]+)\}|"([^"]*)"|'([^']*)'|(\S+))|([A-Za-z][\w-]*)/g

function parseRanges(spec: string): number[] {
  const lines: number[] = []
  for (const part of spec.split(',')) {
    const [from, to = from] = part.split('-').map((n) => Number.parseInt(n.trim(), 10))
    if (from === undefined || to === undefined || Number.isNaN(from) || Number.isNaN(to)) continue
    for (let line = Math.min(from, to); line <= Math.max(from, to) && lines.length < 10_000; line++) lines.push(line)
  }
  return lines
}

export function parseCodeMeta(meta: string | null | undefined): CodeMeta {
  const result: CodeMeta = { title: undefined, highlight: [], inserted: [], deleted: [], flags: new Set(), attrs: {} }
  if (!meta) return result
  for (const token of meta.matchAll(TOKEN)) {
    if (token[1] !== undefined) {
      result.highlight.push(...parseRanges(token[1]))
    } else if (token[2] !== undefined) {
      const key = token[2]
      const value = token[3] ?? token[4] ?? token[5] ?? token[6] ?? ''
      if (key === 'title') result.title = value
      else if (key === 'ins') result.inserted.push(...parseRanges(value))
      else if (key === 'del') result.deleted.push(...parseRanges(value))
      else result.attrs[key] = value
    } else if (token[7] !== undefined) {
      result.flags.add(token[7])
    }
  }
  return result
}
