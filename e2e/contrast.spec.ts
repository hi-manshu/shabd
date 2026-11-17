/**
 * Text against what is really behind it.
 *
 * A unit test holds every preset's colours to a contrast floor, but it can
 * only compare one colour with another. Some themes put a picture behind the
 * page (a grid, a sky, a glow) and let it show through translucent panels,
 * so what is behind the text is not one colour. Here each of those themes is
 * put on a real page, the text is hidden, the panels are photographed, and
 * every pixel of the photograph is held to the same floor.
 *
 * It matters that this runs in all three engines. Chromium blurs what is
 * behind a frosted panel; the Firefox and WebKit builds the tests drive do
 * not, so there a fine pattern (a star, a grid line) reaches the text at
 * full sharpness. A theme has to be readable both ways.
 */
import { PRESET_NAMES, THEME_PRESETS, contrast, type ThemePreset } from '../packages/shabd/src/shared/presets.js'
import { BUILT, expect, test } from './support/fixtures.js'

const THEMES = PRESET_NAMES.filter((name) => (THEME_PRESETS[name] as ThemePreset).look !== undefined)
/** The ratio each kind of text needs: the floor the unit test uses. */
const FLOORS = { text: 7, muted: 4.5, accent: 4.5 } as const
const PANELS = { header: '.sb-region-header', sidebar: '.sb-region-sidebar', main: '.sb-region-main' } as const

/** Everything drawn on top of a panel, so that only the panel and what shows through it is left. */
const HIDE_FOREGROUND = `
  .sb-region-header *, .sb-region-sidebar *, .sb-region-main *,
  .sb-region-header *::before, .sb-region-sidebar *::before, .sb-region-main *::before,
  .sb-region-header *::after, .sb-region-sidebar *::after, .sb-region-main *::after {
    color: transparent !important;
    background: none !important;
    border-color: transparent !important;
    box-shadow: none !important;
    text-decoration-color: transparent !important;
  }
  .sb-badge, .sb-code, .sb-sandbox, img, svg { visibility: hidden !important; }
`

const hex = (pixel: number[]) => `#${pixel.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`

for (const scheme of ['light', 'dark'] as const) {
  test(`text stays readable on every theme's panels (${scheme})`, async ({ browser }) => {
    test.setTimeout(120_000)
    expect(THEMES.length).toBeGreaterThan(5)
    const misses: string[] = []

    for (const theme of THEMES) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: scheme })
      await context.addInitScript((name) => localStorage.setItem('shabd-palette', name), theme)
      const page = await context.newPage()
      await page.goto(`${BUILT}/guide/intro`)
      await page.waitForSelector('html[data-shabd="ready"]')
      await expect(page.locator('html')).toHaveAttribute('data-palette', theme)

      const inks = await page.evaluate(() => {
        const style = getComputedStyle(document.documentElement)
        const read = (name: string) => style.getPropertyValue(name).trim()
        return { text: read('--sb-text'), muted: read('--sb-muted'), accent: read('--sb-accent') }
      })
      await page.addStyleTag({ content: HIDE_FOREGROUND })

      for (const [panel, selector] of Object.entries(PANELS)) {
        const box = await page.locator(selector).boundingBox()
        if (!box) throw new Error(`${theme}: no ${panel} on the page`)
        const picture = await page.screenshot({
          clip: { x: box.x + 4, y: box.y + 4, width: box.width - 8, height: Math.min(box.height, 790 - box.y) - 8 },
        })
        // Read the picture back in the page: a canvas is the PNG decoder every browser has.
        const pixels = await page.evaluate(async (data) => {
          const image = new Image()
          image.src = `data:image/png;base64,${data}`
          await image.decode()
          const canvas = document.createElement('canvas')
          canvas.width = image.width
          canvas.height = image.height
          const drawing = canvas.getContext('2d')!
          drawing.drawImage(image, 0, 0)
          const { data: bytes } = drawing.getImageData(0, 0, image.width, image.height)
          // Every pixel, not a sample of them: a star is two pixels wide, and a grid whose lines fall
          // between the sampled rows would never be looked at. Only the distinct colours go back.
          const seen = new Set<number>()
          for (let at = 0; at < bytes.length; at += 4) seen.add((bytes[at]! << 16) | (bytes[at + 1]! << 8) | bytes[at + 2]!)
          return [...seen]
        }, picture.toString('base64'))

        for (const [ink, floor] of Object.entries(FLOORS) as [keyof typeof FLOORS, number][]) {
          let worst = Infinity
          let behind = ''
          for (const packed of pixels) {
            const colour = hex([(packed >> 16) & 255, (packed >> 8) & 255, packed & 255])
            const ratio = contrast(inks[ink], colour)
            if (ratio < worst) [worst, behind] = [ratio, colour]
          }
          if (worst < floor) misses.push(`${theme} ${scheme}: ${ink} ${inks[ink]} on the ${panel} falls to ${worst.toFixed(2)} (over ${behind}), needs ${floor}`)
        }
      }
      await context.close()
    }

    expect(misses).toEqual([])
  })
}
