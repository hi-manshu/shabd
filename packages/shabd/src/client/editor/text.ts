/**
 * Text arithmetic for the editor. Nothing here touches the page or
 * CodeMirror, so it can be tested without a browser.
 */

export interface Replacement {
  /** Where the changed part starts and ends in the old text. */
  from: number
  to: number
  /** What goes there instead. */
  insert: string
}

const isHighSurrogate = (unit: number) => unit >= 0xd800 && unit <= 0xdbff
const isLowSurrogate = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff

/**
 * The one replacement that turns `before` into `after` and touches as little
 * as it can: what the two share at the start and at the end stays where it is.
 *
 * Text that arrives from outside (the file changed on disk, a draft came from
 * another editor) is the whole document. Putting it in as a whole would move
 * the cursor to an end of it. Changed like this, a cursor outside the part
 * that differs does not move, and one inside it lands on its edge.
 */
export function replacement(before: string, after: string): Replacement {
  const shortest = Math.min(before.length, after.length)
  let start = 0
  while (start < shortest && before.charCodeAt(start) === after.charCodeAt(start)) start++
  // A character outside the basic plane is two units. Sharing only its first one is not sharing it.
  if (start > 0 && isHighSurrogate(before.charCodeAt(start - 1))) start--

  let end = 0
  const longest = shortest - start
  while (end < longest && before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)) end++
  if (end > 0 && isLowSurrogate(before.charCodeAt(before.length - end))) end--

  return { from: start, to: before.length - end, insert: after.slice(start, after.length - end) }
}

/** True when a text's lines end the way Windows writes them. */
export function endsLinesWithCrLf(text: string): boolean {
  return text.includes('\r\n')
}

/** Every line ending as a single line feed, which is how the editor holds a document. */
export function toLineFeeds(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

/** The other way: an editor's document with the line endings its file had. */
export function toCrLf(text: string): string {
  return text.replace(/\n/g, '\r\n')
}
