/**
 * What the keys of the Studio's editor do to the text: Tab, Shift+Tab, Enter,
 * and the two shortcuts for bold and italic.
 *
 * Each function is given the text and the selection, and answers with one
 * replacement and where the selection goes after it, or with null when the
 * key should do what it does in any text area. Nothing here touches the page,
 * so all of it is tested without a browser.
 */

export interface Edit {
  /** The part of the text that is replaced. */
  from: number
  to: number
  text: string
  /** The selection afterwards. */
  select: [number, number]
}

const INDENT = '  '

/** The start of the line that holds `at`. */
const lineStartOf = (value: string, at: number) => value.lastIndexOf('\n', at - 1) + 1

/** The end of the line that holds `at`: where its line break is, or the end of the text. */
function lineEndOf(value: string, at: number): number {
  const end = value.indexOf('\n', at)
  return end === -1 ? value.length : end
}

/**
 * Tab and Shift+Tab. With the selection on one line, Tab types two spaces.
 * With it over several lines, Tab moves each of them in, and Shift+Tab moves
 * the selected lines (or the line of the caret) out again.
 */
export function indent(value: string, from: number, to: number, outdent: boolean): Edit | null {
  if (!outdent && !value.slice(from, to).includes('\n')) {
    return { from, to, text: INDENT, select: [from + INDENT.length, from + INDENT.length] }
  }

  const start = lineStartOf(value, from)
  // A selection that ends right at the start of a line does not take that line with it.
  const end = lineEndOf(value, to > from && value[to - 1] === '\n' ? to - 1 : to)
  const lines = value.slice(start, end).split('\n')
  const moved = lines.map((line) => (outdent ? line.replace(/^(?: {1,2}|\t)/, '') : line === '' ? line : INDENT + line))
  const text = moved.join('\n')
  if (text === value.slice(start, end)) return null

  const first = moved[0]!.length - lines[0]!.length
  const all = text.length - (end - start)
  const caret = Math.max(start, from + first)
  return { from: start, to: end, text, select: from === to ? [caret, caret] : [caret, Math.max(caret, to + all)] }
}

/**
 * Enter. A list item or a quote goes on with the next one; an empty one ends
 * the list instead. Any other line keeps its indentation. Null where there is
 * nothing to add to a plain line break.
 */
export function newLine(value: string, from: number, to: number): Edit | null {
  if (from !== to) return null
  const start = lineStartOf(value, from)
  const before = value.slice(start, from)
  const after = value.slice(from, lineEndOf(value, from))

  const lead = /^([ \t]*)((?:>[ \t]?)*)/.exec(before)!
  const [prefix, spaces, quotes] = lead as unknown as [string, string, string]
  const rest = before.slice(prefix.length)
  const item = /^(?:([-*+])|(\d{1,9})([.)]))([ \t]+)(\[[ xX]\][ \t]+)?/.exec(rest)
  const insert = (text: string): Edit => ({ from, to: from, text, select: [from + text.length, from + text.length] })
  const empty = after.trim() === ''

  if (item) {
    // Enter on an item with nothing in it ends the list: the marker goes, the line stays.
    if (item[0] === rest && empty) return { from: start + prefix.length, to: from, text: '', select: [start + prefix.length, start + prefix.length] }
    const marker = item[1] ?? `${Number(item[2]) + 1}${item[3]!}`
    return insert(`\n${prefix}${marker}${item[4]!}${item[5] ? '[ ] ' : ''}`)
  }
  if (quotes) {
    if (rest.trim() === '' && empty) return { from: start + spaces.length, to: from, text: '', select: [start + spaces.length, start + spaces.length] }
    return insert(`\n${prefix}`)
  }
  return spaces ? insert(`\n${spaces}`) : null
}

/** Put `marker` on both sides of the selection, or take it away where it is there already. */
export function wrap(value: string, from: number, to: number, marker: string): Edit {
  const size = marker.length
  const selected = value.slice(from, to)
  if (value.slice(from - size, from) === marker && value.slice(to, to + size) === marker) {
    return { from: from - size, to: to + size, text: selected, select: [from - size, to - size] }
  }
  return { from, to, text: `${marker}${selected}${marker}`, select: [from + size, to + size] }
}
