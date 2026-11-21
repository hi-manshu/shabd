/**
 * Writing a theme's colours into `shabd.config.yaml` for the Studio, where a
 * person has tried them beside the page and wants to keep them.
 *
 * The file is a person's: it has their comments, their blank lines and
 * their way of writing a list. Reading it and writing it out again would
 * keep the first two and change the third. So nothing is written out again.
 * A value that is there is replaced where it stands, a key that is not is
 * put in on a line of its own, and every other character is left as it was.
 *
 * What comes of that is read back before it is used. If the config does not
 * then say exactly what it said before with the change made, the change is
 * not written at all, and the person is given the lines to put in by hand.
 */
import { isMap, isScalar, parse, parseDocument, stringify, type Node, type YAMLMap } from 'yaml'

export interface ModeColour {
  light: string
  dark: string
}

/** What is to be changed: the preset the theme starts from, and colours laid over it. */
export interface ThemeChange {
  preset?: string | undefined
  colors?: Record<string, ModeColour> | undefined
}

/** A string as YAML reads one in double quotes. A colour starts with `#`, which would be a comment without them. */
const quoted = (value: string) => JSON.stringify(value)

/** A colour as it is written in the config: once where both modes have the same, as a pair where they differ. */
const colourYaml = (colour: ModeColour) =>
  colour.light === colour.dark ? quoted(colour.light) : `{ light: ${quoted(colour.light)}, dark: ${quoted(colour.dark)} }`

/** The lines of a `theme:` section that say a change, for a person to put into their config. */
export function themeYaml(change: ThemeChange): string {
  const lines = ['theme:']
  if (change.preset !== undefined) lines.push(`  preset: ${change.preset}`)
  const colours = Object.entries(change.colors ?? {})
  if (colours.length > 0) lines.push('  colors:', ...colours.map(([token, colour]) => `    ${token}: ${colourYaml(colour)}`))
  return `${lines.join('\n')}\n`
}

/** Where the text of a node ends: for a map or a list, where its last entry does. */
function endOf(node: unknown): number | undefined {
  if (isMap(node) && node.items.length > 0 && !node.flow) {
    const last = node.items.at(-1)!
    return endOf(last.value) ?? endOf(last.key)
  }
  const sequence = node as { items?: unknown[]; flow?: boolean; range?: [number, number, number] | null }
  if (Array.isArray(sequence?.items) && sequence.items.length > 0 && !sequence.flow) return endOf(sequence.items.at(-1))
  return (node as Node | null)?.range?.[1]
}

/** The text with one value put at a path of keys. Undefined where it cannot be put there without rewriting what is there. */
function put(text: string, path: string[], value: string): string | undefined {
  const doc = parseDocument(text)
  if (doc.errors.length > 0 || !isMap(doc.contents) || doc.contents.flow) return undefined
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  let map: YAMLMap = doc.contents

  for (const [depth, key] of path.entries()) {
    const pair = map.items.find((item) => isScalar(item.key) && item.key.value === key)
    if (pair && depth === path.length - 1) {
      // There already: what it says is replaced where it stands.
      const range = (pair.value as Node | null)?.range
      return range ? text.slice(0, range[0]) + value + text.slice(range[1]) : undefined
    }
    if (pair) {
      // On the way there. A section written on one line, or with nothing in it, is not one a line can be added to.
      if (!isMap(pair.value) || pair.value.flow || pair.value.items.length === 0) return undefined
      map = pair.value
      continue
    }

    // Not there: it goes on lines of its own after the last line of this section, at the indent the section's keys have.
    const first = (map.items[0]?.key as Node | undefined)?.range?.[0]
    const end = endOf(map)
    if (first === undefined || end === undefined) return undefined
    const column = first - (text.lastIndexOf('\n', first - 1) + 1)
    const rest = path.slice(depth)
    const lines = rest.map((name, index) => `${' '.repeat(column + 2 * index)}${name}:${index === rest.length - 1 ? ` ${value}` : ''}`)
    const lineEnd = text.indexOf('\n', end)
    const before = lineEnd === -1 ? text + eol : text.slice(0, lineEnd + 1)
    const after = lineEnd === -1 ? '' : text.slice(lineEnd + 1)
    return before + lines.join(eol) + eol + after
  }
  return undefined
}

/** A config as data with a change made to it: what the file is to say once the change is written. */
function expected(data: unknown, change: ThemeChange): unknown {
  const config = structuredClone((data ?? {}) as Record<string, unknown>)
  const theme = (config.theme ??= {}) as Record<string, unknown>
  if (change.preset !== undefined) theme.preset = change.preset
  for (const [token, colour] of Object.entries(change.colors ?? {})) {
    const colours = (theme.colors ??= {}) as Record<string, unknown>
    colours[token] = colour.light === colour.dark ? colour.light : { light: colour.light, dark: colour.dark }
  }
  return config
}

/**
 * A config that says what `source` says with the change made, for trying the change: it is read as any
 * config is, and never written. How it is laid out does not matter, so it is simply written out afresh.
 */
export function laidOver(source: string, change: ThemeChange): string {
  return stringify(expected(parse(source), change))
}

/** The same data, whatever order its keys are written in. */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, inner: unknown) =>
    inner && typeof inner === 'object' && !Array.isArray(inner) ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : 1))) : inner,
  )

/**
 * The config's text with a change to the theme written into it, and every
 * other character as it was. Undefined where that cannot be done: the lines
 * of `themeYaml` are then for the person to put in.
 */
export function writeTheme(source: string, change: ThemeChange): string | undefined {
  let text = source
  const steps: [string[], string][] = []
  // A preset's name is a word, written as it is.
  if (change.preset !== undefined) steps.push([['theme', 'preset'], change.preset])
  for (const [token, colour] of Object.entries(change.colors ?? {})) steps.push([['theme', 'colors', token], colourYaml(colour)])
  try {
    for (const [path, value] of steps) {
      const next = put(text, path, value)
      if (next === undefined) return undefined
      text = next
    }
    // Read back: the file says what it said, with the change made, and nothing else.
    return canonical(parse(text)) === canonical(expected(parse(source), change)) ? text : undefined
  } catch {
    return undefined
  }
}
