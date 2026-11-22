/**
 * One error type for everything an author can get wrong in YAML or frontmatter.
 *
 * A ShabdError knows the file, and for each issue the line and column, so the
 * CLI can print a code frame and the dev server can show it in the browser
 * overlay pointing at the right character.
 */
import path from 'node:path'
import pc from 'picocolors'
import { editDistance } from '../../shared/edit-distance.js'

export interface SourceIssue {
  message: string
  /** Path into the YAML document, e.g. ['theme', 'colors', 'accent']. */
  path: (string | number)[]
  /** 1-based. */
  line?: number
  /** 1-based. */
  column?: number
}

export class ShabdError extends Error {
  override readonly name = 'ShabdError'
  readonly file: string
  readonly issues: SourceIssue[]
  readonly source: string | undefined

  /** Fields Vite reads to render its error overlay. */
  readonly id: string
  readonly plugin = 'shabd'
  readonly loc: { file: string; line: number; column: number } | undefined
  readonly frame: string | undefined

  constructor(file: string, issues: SourceIssue[], source?: string) {
    super(formatIssues(file, issues, source, false))
    this.file = file
    this.issues = issues
    this.source = source
    this.id = file
    const first = issues.find((issue) => issue.line !== undefined)
    if (first?.line !== undefined) {
      this.loc = { file, line: first.line, column: first.column ?? 1 }
      this.frame = source ? codeFrame(source, first.line, first.column ?? 1, false) : undefined
    }
    // The stack of a config error is noise: the author needs the YAML location.
    this.stack = this.message
  }

  /** Coloured, multi-issue report for the terminal. */
  pretty(cwd = process.cwd()): string {
    // The file from the folder the command was run in, with `/` between its folders on every system: the
    // way `shabd check` names the file of every other problem it lists beside this one.
    const shown = path.relative(cwd, this.file).split(path.sep).join('/') || this.file
    return formatIssues(shown, this.issues, this.source, true)
  }
}

export function isShabdError(error: unknown): error is ShabdError {
  return error instanceof Error && error.name === 'ShabdError'
}

export function formatPath(segments: (string | number)[]): string {
  return segments.reduce<string>((out, segment) => {
    if (typeof segment === 'number') return `${out}[${segment}]`
    return out ? `${out}.${segment}` : segment
  }, '')
}

function formatIssues(file: string, issues: SourceIssue[], source: string | undefined, color: boolean): string {
  const paint = color
    ? pc
    : { red: String, dim: String, bold: String, cyan: String, yellow: String }
  const blocks = issues.map((issue) => {
    const where = issue.line !== undefined ? `${file}:${issue.line}:${issue.column ?? 1}` : file
    const at = issue.path.length ? `  ${paint.yellow(formatPath(issue.path))}` : ''
    const frame =
      source && issue.line !== undefined ? `\n\n${codeFrame(source, issue.line, issue.column ?? 1, color)}` : ''
    return `${paint.cyan(where)}${at}\n  ${paint.bold(issue.message)}${frame}`
  })
  const subject = /\.mdx?$/i.test(file) ? 'Invalid page' : 'Invalid configuration'
  const heading = issues.length === 1 ? subject : `${subject} (${issues.length} problems)`
  return `${paint.red(heading)}\n\n${blocks.join('\n\n')}`
}

/** Two lines of context and a caret under the offending column. */
export function codeFrame(source: string, line: number, column: number, color: boolean): string {
  const lines = source.split(/\r?\n/)
  const first = Math.max(1, line - 2)
  const last = Math.min(lines.length, line + 1)
  const gutter = String(last).length
  const dim = color ? pc.dim : String
  const red = color ? pc.red : String
  const out: string[] = []
  for (let n = first; n <= last; n++) {
    const text = lines[n - 1] ?? ''
    out.push(`  ${dim(`${String(n).padStart(gutter)} |`)} ${text}`)
    if (n === line) out.push(`  ${dim(`${' '.repeat(gutter)} |`)} ${' '.repeat(Math.max(0, column - 1))}${red('^')}`)
  }
  return out.join('\n')
}

/* ─────────────────────────── "did you mean" ──────────────────────────── */

/** The closest candidate, if it is close enough to plausibly be a typo. */
export function closestMatch(word: string, candidates: Iterable<string>): string | undefined {
  let best: string | undefined
  let bestDistance = Math.max(1, Math.floor(word.length / 3)) + 1
  for (const candidate of candidates) {
    const distance = editDistance(word.toLowerCase(), candidate.toLowerCase())
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}
