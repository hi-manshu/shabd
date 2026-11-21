/**
 * Whether a theme's colours can be read: each colour that is read, against
 * what it is read on, in both modes.
 *
 * This is shared. A test holds every built-in preset to it, and the Studio
 * shows it for colours that are being tried, before they are written to the
 * config.
 */
import { contrastOn, over, parseColor, type Rgba } from './color.js'

export type Mode = 'light' | 'dark'
export const MODES: readonly Mode[] = ['light', 'dark']

/** A theme's colours by name, each for the two modes. One that is left out falls back as the stylesheet has it. */
export type ThemeColours = Record<string, { light: string; dark: string } | undefined>

/**
 * What a colour of the twelve is read against, and how much contrast that
 * takes, as WCAG measures it. Text is held to 7:1, and the rest to 4.5:1.
 * Each is read on the page (`background`) and on a panel (`surface`).
 */
export const CONTRAST_FLOORS = {
  text: 7,
  muted: 4.5,
  accent: 4.5,
  note: 4.5,
  tip: 4.5,
  success: 4.5,
  caution: 4.5,
  danger: 4.5,
} as const

export interface ContrastLine {
  /** The colour that is read: `text`. */
  ink: string
  /** What it is read on: `background`. */
  on: string
  mode: Mode
  /** The ratio, from 1 to 21. Undefined where one of the two is not a colour that can be read here: `oklch()`, a gradient. */
  ratio: number | undefined
  /** The least it should be. */
  floor: number
}

/**
 * The colours a site may add to the twelve, where one is read or read on:
 * [the ink, what it falls back to, what it is on, what that falls back to].
 * A pair is measured when the site has set either of the two.
 */
const ADDED: [ink: string, inkElse: string | undefined, on: string, onElse: string | undefined][] = [
  ['link', undefined, 'background', undefined],
  ['link', undefined, 'surface', undefined],
  ['heading', undefined, 'background', undefined],
  ['headerText', 'text', 'header', 'background'],
  ['codeText', undefined, 'code', 'surface'],
  // The label of a primary button is drawn in the page's colour, on the button's.
  ['background', undefined, 'button', undefined],
]

export function contrastReport(colours: ThemeColours): ContrastLine[] {
  const lines: ContrastLine[] = []
  const read = (token: string, mode: Mode): Rgba | undefined => {
    const written = colours[token]?.[mode]
    return written === undefined ? undefined : parseColor(written)
  }
  const measure = (ink: string, inkToken: string, on: string, onToken: string, floor: number) => {
    for (const mode of MODES) {
      const colour = read(inkToken, mode)
      let behind = read(onToken, mode)
      // What is read on may be see-through, a header over the page: it is then that colour over the page's.
      const page = read('background', mode)
      if (behind && behind[3] < 1 && page) behind = over(behind, page)
      lines.push({ ink, on, mode, floor, ratio: colour && behind && behind[3] === 1 ? contrastOn(colour, behind) : undefined })
    }
  }

  for (const [ink, floor] of Object.entries(CONTRAST_FLOORS)) {
    measure(ink, ink, 'background', 'background', floor)
    measure(ink, ink, 'surface', 'surface', floor)
  }
  for (const [ink, inkElse, on, onElse] of ADDED) {
    const hasInk = colours[ink] !== undefined
    const hasOn = colours[on] !== undefined
    // The page's own colours are always there. What makes the pair worth measuring is the colour that was added.
    const added = (ink !== 'background' && hasInk) || (on !== 'background' && on !== 'surface' && hasOn)
    if (!added) continue
    const inkToken = hasInk ? ink : inkElse
    const onToken = hasOn ? on : onElse
    if (inkToken === undefined || onToken === undefined) continue
    measure(hasInk ? ink : inkToken, inkToken, hasOn ? on : onToken, onToken, 4.5)
  }
  return lines
}

/** The lines that say a colour is too faint. One that could not be measured is not among them. */
export const tooFaint = (lines: readonly ContrastLine[]): ContrastLine[] => lines.filter((line) => line.ratio !== undefined && line.ratio < line.floor)
