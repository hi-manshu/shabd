/**
 * The picture other sites show when a page is shared: 1200 by 630, in the
 * site's colours, with the page's title hanging from the headline bar as it
 * does on the page itself.
 *
 * This module draws the card as SVG and knows nothing about files, fonts or
 * PNG. The one thing it cannot work out alone is how wide a piece of text
 * is, which depends on the font, so it is told (`measure`).
 */

export const CARD_WIDTH = 1200
export const CARD_HEIGHT = 630

const PADDING = 80
const TEXT_WIDTH = CARD_WIDTH - PADDING * 2
/** Tried from the largest down, until the title fits in three lines with no word cut. */
const TITLE_SIZES = [76, 64, 54, 46]
const TITLE_LINES = 3
const DESCRIPTION_SIZE = 34
const DESCRIPTION_LINES = 2
const BAR_HEIGHT = 14

export interface CardColors {
  background: string
  text: string
  muted: string
  /** The headline bar above the title. */
  bar: string
  /** The small mark above the site's name. */
  highlight: string
}

export interface CardInput {
  title: string
  description: string
  /** The site's title, at the foot of the card. */
  site: string
  /** Where the site lives, such as `docs.example.com`, opposite the site's title. */
  host?: string | undefined
  colors: CardColors
  /** Draw the bar above the title. A theme without bars has none here either. */
  bars: boolean
}

/** The width of `text` in pixels when set at `size` in a font of `weight`. */
export type Measure = (text: string, size: number, weight: number) => number

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
const escapeXml = (text: string) => text.replace(/[&<>"]/g, (char) => ESCAPES[char]!)

export interface Wrapped {
  lines: string[]
  /** The width of the widest line. */
  width: number
  /** True when the text did not fit and its last line ends in an ellipsis. */
  cut: boolean
  /** True when a single word is wider than the space there is. */
  overflows: boolean
}

/**
 * Break text into lines no wider than `maxWidth`, at most `maxLines` of
 * them. Words are measured one at a time and added up, with the width of a
 * space between them. That is a hair off what the whole line measures, and
 * means a word that appears on many cards is measured once.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  maxLines: number,
  widthOf: (text: string) => number,
  /** Cut a word that is wider than a line into pieces that fit, instead of letting it run past the edge. */
  breakWords = false,
): Wrapped {
  const whole = text.split(/\s+/).filter(Boolean)
  const words = breakWords ? whole.flatMap((word) => (widthOf(word) > maxWidth ? pieces(word, maxWidth, widthOf) : [word])) : whole
  const space = Math.max(0, widthOf('a b') - widthOf('ab'))
  const lines: { words: string[]; width: number }[] = []
  let overflows = false

  for (const word of words) {
    const width = widthOf(word)
    if (width > maxWidth) overflows = true
    const line = lines.at(-1)
    if (line && line.width + space + width <= maxWidth) {
      line.words.push(word)
      line.width += space + width
    } else {
      lines.push({ words: [word], width })
    }
  }

  const cut = lines.length > maxLines
  const kept = lines.slice(0, maxLines)
  const last = kept.at(-1)
  if (cut && last) {
    // Make room for the ellipsis by dropping words from the end of the last line.
    const ellipsis = widthOf('…')
    while (last.words.length > 1 && last.width + ellipsis > maxWidth) {
      last.width -= space + widthOf(last.words.pop()!)
    }
    last.words[last.words.length - 1] += '…'
    last.width += ellipsis
  }
  return {
    lines: kept.map((line) => line.words.join(' ')),
    width: Math.min(maxWidth, Math.max(0, ...kept.map((line) => line.width))),
    cut,
    overflows,
  }
}

/**
 * A word too wide for a line, in pieces that each fit. This is what a long
 * identifier needs, and a title in a script written without spaces, which is
 * one long word as far as splitting on spaces can tell.
 */
function pieces(word: string, maxWidth: number, widthOf: (text: string) => number): string[] {
  const out: string[] = []
  let piece = ''
  // By code point, so that a character outside the basic plane is never cut in half.
  for (const character of word) {
    if (piece && widthOf(piece + character) > maxWidth) {
      out.push(piece)
      piece = character
    } else {
      piece += character
    }
  }
  if (piece) out.push(piece)
  return out
}

export function cardSvg(input: CardInput, measure: Measure): string {
  const { colors } = input

  // The largest title that fits. If none does, the smallest, with its long words broken and its end cut short.
  let size = TITLE_SIZES.at(-1)!
  let title = wrapText(input.title, TEXT_WIDTH, TITLE_LINES, (text) => measure(text, size, 700), true)
  for (const candidate of TITLE_SIZES) {
    const wrapped = wrapText(input.title, TEXT_WIDTH, TITLE_LINES, (text) => measure(text, candidate, 700))
    if (!wrapped.cut && !wrapped.overflows) {
      size = candidate
      title = wrapped
      break
    }
  }
  const description = wrapText(input.description, TEXT_WIDTH, DESCRIPTION_LINES, (text) => measure(text, DESCRIPTION_SIZE, 400), true)

  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">`,
    `<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="${colors.background}"/>`,
  ]
  const text = (line: string, x: number, y: number, fontSize: number, weight: number, fill: string, anchor = 'start') =>
    out.push(
      `<text x="${x}" y="${Math.round(y)}" font-family="sans-serif" font-size="${fontSize}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${escapeXml(line)}</text>`,
    )

  let y = PADDING
  if (input.bars) {
    // The title hangs from a bar exactly as wide as its words, as a page's title does.
    out.push(`<rect x="${PADDING}" y="${y}" width="${Math.ceil(title.width)}" height="${BAR_HEIGHT}" fill="${colors.bar}"/>`)
    y += BAR_HEIGHT + 28
  }
  const titleLine = size * 1.12
  for (const line of title.lines) {
    y += titleLine
    // A line's baseline sits about a fifth of its height above the line's foot.
    text(line, PADDING, y - size * 0.22, size, 700, colors.text)
  }
  y += 30
  for (const line of description.lines) {
    y += DESCRIPTION_SIZE * 1.4
    text(line, PADDING, y - DESCRIPTION_SIZE * 0.3, DESCRIPTION_SIZE, 400, colors.muted)
  }

  // The foot: the site's name under a small mark, and where the site lives.
  const foot = CARD_HEIGHT - PADDING
  out.push(`<rect x="${PADDING}" y="${foot - 56}" width="56" height="6" fill="${colors.highlight}"/>`)
  text(input.site, PADDING, foot, 32, 700, colors.text)
  if (input.host) text(input.host, CARD_WIDTH - PADDING, foot, 28, 400, colors.muted, 'end')

  out.push('</svg>')
  return out.join('\n')
}
