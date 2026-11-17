/**
 * Turning a card into a PNG, with resvg.
 *
 * `@resvg/resvg-js` is an optional peer dependency, like the package for
 * semantic search: a site that wants social pictures installs it, and a site
 * that does not carries nothing for them.
 *
 * resvg needs a font file it can read: TrueType or OpenType (`.ttf`, `.otf`,
 * `.ttc`). The web fonts Shabd ships are WOFF2, which it cannot read. It can
 * also search the machine for fonts, but doing so took a third of a second
 * for every picture when it was tried, where a named file takes a
 * millisecond. So the fonts are named: by the site, or else the first of a
 * short list of fonts that operating systems come with.
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Measure } from './card.js'

const PACKAGE = '@resvg/resvg-js'

/** The slice of resvg-js this module uses. */
interface ResvgModule {
  Resvg: new (
    svg: string,
    options: { font: { loadSystemFonts: boolean; fontFiles: string[] } },
  ) => {
    getBBox(): { width: number } | undefined | null
    render(): { asPng(): Uint8Array }
  }
}

async function importResvg(root: string): Promise<ResvgModule | null> {
  const usable = (module: unknown): ResvgModule | null => {
    const candidate = (module as { Resvg?: unknown; default?: { Resvg?: unknown } }) ?? {}
    if (typeof candidate.Resvg === 'function') return candidate as ResvgModule
    return typeof candidate.default?.Resvg === 'function' ? (candidate.default as ResvgModule) : null
  }
  try {
    return usable(await import(PACKAGE))
  } catch {
    // Not resolvable from Shabd's own location (strict package managers): try the site's.
  }
  try {
    const resolved = createRequire(path.join(root, 'package.json')).resolve(PACKAGE)
    return usable(await import(pathToFileURL(resolved).href))
  } catch {
    return null
  }
}

/**
 * A regular and a bold face that operating systems come with, most likely
 * first. Each entry is used whole: a card set half in one font and half in
 * another would be worse than no card. Only the first was tried.
 */
const SYSTEM_FONTS: string[][] = [
  // macOS: one file holds every weight.
  ['/System/Library/Fonts/Helvetica.ttc'],
  ['/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf'],
  // Debian and Ubuntu, which is what most build machines run.
  ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'],
  ['/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'],
  // Fedora, then Arch.
  ['/usr/share/fonts/dejavu-sans-fonts/DejaVuSans.ttf', '/usr/share/fonts/dejavu-sans-fonts/DejaVuSans-Bold.ttf'],
  ['/usr/share/fonts/TTF/DejaVuSans.ttf', '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf'],
  ['C:\\Windows\\Fonts\\arial.ttf', 'C:\\Windows\\Fonts\\arialbd.ttf'],
]

/** The fonts of this machine that a card can be set in, or none. */
export function systemFonts(): string[] {
  return SYSTEM_FONTS.find((files) => files.every((file) => existsSync(file))) ?? []
}

export interface CardRenderer {
  measure: Measure
  png(svg: string): Uint8Array
  /** The font files in use, for the cache: another font is another picture. */
  fonts: string[]
}

export type RendererResult = { renderer: CardRenderer } | { renderer?: undefined; reason: string }

/** Load resvg and settle on fonts. Says why when a picture cannot be made here. */
export async function loadRenderer(root: string, fonts: string[]): Promise<RendererResult> {
  const resvg = await importResvg(root)
  if (!resvg) return { reason: `${PACKAGE} is not installed. Install it in the site: npm install ${PACKAGE}` }
  const fontFiles = fonts.length ? fonts : systemFonts()
  if (fontFiles.length === 0) {
    return { reason: 'no font was found on this machine. Name a .ttf or .otf file in `features.socialImages.font`' }
  }

  const options = { font: { loadSystemFonts: false, fontFiles } }
  const widths = new Map<string, number>()
  const measure: Measure = (text, size, weight) => {
    const key = `${size} ${weight} ${text}`
    let width = widths.get(key)
    if (width === undefined) {
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="8000" height="${size * 3}">` +
        `<text x="0" y="${size * 2}" font-family="sans-serif" font-size="${size}" font-weight="${weight}">` +
        `${text.replace(/[&<>]/g, (char) => `&#${char.charCodeAt(0)};`)}</text></svg>`
      // Text made of nothing but spaces has no box at all.
      width = new resvg.Resvg(svg, options).getBBox()?.width ?? 0
      widths.set(key, width)
    }
    return width
  }

  return { renderer: { measure, png: (svg) => new resvg.Resvg(svg, options).render().asPng(), fonts: fontFiles } }
}
