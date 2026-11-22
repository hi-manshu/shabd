/**
 * Social pictures for a build: one PNG per page that has none of its own.
 *
 * A picture depends on the page's title and description, the site's name
 * and colours, and the font. It is kept under a hash of all of those, so a
 * build draws only the pictures that changed, as it embeds only the
 * passages that changed.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseColor, toHex } from '../../shared/color.js'
import type { ShabdConfig } from '../../shared/schema.js'
import type { ShabdContext } from '../context.js'
import { publicUrl } from '../llms/llms-txt.js'
import { cardSvg, type CardColors } from './card.js'
import { loadRenderer } from './render.js'

/** Bump when the card is drawn differently, so that kept pictures are drawn again. */
const CARD_VERSION = 1

/** Where a page's picture is written, relative to the output folder. */
export function socialImageFile(routePath: string): string {
  return `_shabd/social/${routePath === '/' ? 'index' : routePath.slice(1)}.png`
}

/**
 * The site's light colours, as resvg can read them. It reads hex and
 * `rgb()`; a colour written any other way (`oklch()`, a variable) is
 * replaced by a plain one, so that a card is never drawn in black on black.
 */
export function cardColors(theme: ShabdConfig['theme']): CardColors {
  const read = (value: string | undefined, fallback: string) => {
    const colour = value === undefined ? undefined : parseColor(value)
    // A see-through colour is drawn as if it were solid: there is nothing behind a card to show through.
    return colour ? toHex(colour) : fallback
  }
  const text = read(theme.colors.text.light, '#111111')
  return {
    background: read(theme.colors.background.light, '#ffffff'),
    text: read(theme.colors.heading?.light, text),
    muted: read(theme.colors.muted.light, '#555555'),
    bar: read(theme.colors.bar?.light, text),
    highlight: read(theme.colors.highlight.light, text),
  }
}

export interface SocialImages {
  /** Route path → the full address of the page's picture. */
  images: Map<string, string>
  drawn: number
  /** Why no pictures were made, when none were. */
  reason?: string
}

export async function generateSocialImages(
  context: ShabdContext,
  write: (file: string, contents: Uint8Array) => Promise<void>,
): Promise<SocialImages> {
  const { config, store } = context
  const { site, theme } = config.config
  const images = new Map<string, string>()

  const loaded = await loadRenderer(config.root, config.socialFonts)
  if (!loaded.renderer) return { images, drawn: 0, reason: loaded.reason }
  const { renderer } = loaded

  const cacheDir = path.join(config.cacheDir, 'social')
  await mkdir(cacheDir, { recursive: true })
  // A font file that was replaced under the same name is another font.
  const fonts = await Promise.all(renderer.fonts.map(async (file) => `${file}:${(await stat(file)).mtimeMs}`))
  const colors = cardColors(theme)
  const host = site.url ? new URL(site.url).host : undefined
  let drawn = 0

  for (const page of store.pages()) {
    // A page that names its own picture keeps it.
    if (page.frontmatter.image) continue
    const svg = cardSvg(
      { title: page.title, description: page.description, site: site.title, host, colors, bars: theme.bars },
      renderer.measure,
    )
    const key = createHash('sha1').update(JSON.stringify([CARD_VERSION, svg, fonts])).digest('hex')
    const cached = path.join(cacheDir, `${key}.png`)
    let png: Uint8Array
    try {
      png = await readFile(cached)
    } catch {
      png = renderer.png(svg)
      await writeFile(cached, png)
      drawn++
    }
    const file = socialImageFile(page.path)
    await write(file, png)
    images.set(page.path, publicUrl(context, `/${file}`))
  }
  return { images, drawn }
}
