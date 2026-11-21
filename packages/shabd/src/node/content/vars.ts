/**
 * Variables: `{{name}}` in a page is replaced by the value `vars:` gives
 * that name in shabd.config.yaml.
 *
 * The replacement is made in the text of the file, before anything reads
 * it. So a value reaches everything that is made from the page: its
 * frontmatter (a title, a description), its prose, its code samples, the
 * search index, llms.txt and the Markdown copy.
 *
 * Only names that `vars:` defines are replaced. Braces mean other things in
 * other places (a template in a code sample, an expression in MDX), and a
 * page that uses them for those must come through untouched. The price is
 * that a mistyped name is left as it was typed, so one that is close to a
 * name that exists is reported.
 */
import { closestMatch } from '../config/errors.js'

/** `{{ name }}`, with the backslash before it if there is one. A name may hold dots, for nested values. */
const VARIABLE = /(\\?)\{\{[ \t]*([A-Za-z_][A-Za-z0-9_.-]*)[ \t]*\}\}/g
/** The opening or closing line of a fenced code block, with what follows the fence. */
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/

export interface VariableNote {
  /** 1-based line in the file. */
  line: number
  message: string
}

export interface Substituted {
  text: string
  /** Names that were left alone but look like a mistyped variable. */
  notes: VariableNote[]
}

/** `vars:` as written, which may be nested, as one flat table: `{ product: { name: Acme } }` → `product.name`. */
export function flattenVars(vars: Record<string, unknown>, prefix = ''): Record<string, string> {
  const flat: Record<string, string> = {}
  for (const [name, value] of Object.entries(vars)) {
    if (typeof value === 'object' && value !== null) Object.assign(flat, flattenVars(value as Record<string, unknown>, `${prefix}${name}.`))
    else flat[`${prefix}${name}`] = String(value)
  }
  return flat
}

export function substituteVars(source: string, vars: Record<string, string>): Substituted {
  const names = Object.keys(vars)
  if (names.length === 0 || !source.includes('{{')) return { text: source, notes: [] }

  const notes: VariableNote[] = []
  let fence: string | null = null
  /** Inside a fence that asked to be left alone with `noVars`. */
  let skipping = false

  const lines = source.split('\n').map((line, index) => {
    const marker = FENCE.exec(line)
    if (marker) {
      if (fence === null) {
        fence = marker[1]!
        skipping = /(?:^|\s)noVars(?:\s|$)/.test(marker[2]!)
      } else if (marker[1]![0] === fence[0] && marker[1]!.length >= fence.length && marker[2]!.trim() === '') {
        fence = null
        skipping = false
      }
      return line
    }
    if (skipping || !line.includes('{{')) return line

    return line.replace(VARIABLE, (match, escaped: string, name: string) => {
      // `\{{name}}` is how a page writes the braces themselves.
      if (escaped) return match
      const value = vars[name]
      if (value !== undefined) return value
      const meant = closestMatch(name, names)
      if (meant) notes.push({ line: index + 1, message: `{{${name}}} is not a variable. Did you mean {{${meant}}}?` })
      return match
    })
  })

  return { text: lines.join('\n'), notes }
}
