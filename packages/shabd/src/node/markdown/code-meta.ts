/**
 * The text after a fence's language is its "meta":
 *
 *   ```ts title="src/app.ts" {2,4-6} showLineNumbers
 *   ```tsx live group="cart"
 */
export interface CodeMeta {
  title: string | undefined
  /** 1-based line numbers to emphasise. */
  highlight: number[]
  /** Bare words: `live`, `showLineNumbers`, `wrap`. */
  flags: Set<string>
  /** `key="value"` pairs other than `title`. */
  attrs: Record<string, string>
}

const TOKEN = /\{([\d,\s-]+)\}|([A-Za-z][\w-]*)=(?:"([^"]*)"|'([^']*)'|(\S+))|([A-Za-z][\w-]*)/g

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
  const result: CodeMeta = { title: undefined, highlight: [], flags: new Set(), attrs: {} }
  if (!meta) return result
  for (const token of meta.matchAll(TOKEN)) {
    if (token[1] !== undefined) {
      result.highlight.push(...parseRanges(token[1]))
    } else if (token[2] !== undefined) {
      const value = token[3] ?? token[4] ?? token[5] ?? ''
      if (token[2] === 'title') result.title = value
      else result.attrs[token[2]] = value
    } else if (token[6] !== undefined) {
      result.flags.add(token[6])
    }
  }
  return result
}
