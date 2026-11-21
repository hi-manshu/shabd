/**
 * The colours of code under the presets of the theme menu.
 *
 * A page carries the colours of its own code in the site's two syntax
 * themes. The colours under every other theme the menu can reach are in one
 * stylesheet for the whole site, which a page names and does not load: it is
 * fetched for a reader who picks a preset, and for nobody else.
 */
import type { Page } from '@playwright/test'
import { BUILT, DEV, expect, open, test } from './support/fixtures.js'

const SHEET = /\/_shabd\/code-themes\.[0-9a-f]{8}\.css$/

/** The addresses of that stylesheet the page asked for. */
function watchFor(page: Page): string[] {
  const asked: string[] = []
  page.on('request', (request) => {
    if (SHEET.test(new URL(request.url()).pathname)) asked.push(request.url())
  })
  return asked
}

const keywordInk = (page: Page) => page.locator('figure.sb-code span[class^="sbk-"]').first().evaluate((span) => getComputedStyle(span).color)

test.describe('code colours for the theme menu', () => {
  test('are not on the page, and are fetched when the reader opens the menu', async ({ page }) => {
    const asked = watchFor(page)
    await open(page, `${BUILT}/guide/intro`)

    // The page's own stylesheet for its code: the site's two themes, and nothing that waits on a preset.
    const own = await page.locator('style[data-sb-code]').textContent()
    expect(own).toMatch(/^\.sbk-[a-z0-9]+\{--sb-tok:#[0-9a-f]{6}\}/)
    expect(own).toContain('[data-theme=dark]{')
    expect(own).not.toContain('data-code')
    // It is named, for whoever comes to need it, and not loaded.
    await expect(page.locator('meta[name="shabd-code-themes"]')).toHaveAttribute('content', SHEET)
    await expect(page.locator('#sb-code-themes')).toHaveCount(0)
    expect(asked).toEqual([])

    // Opening the menu fetches it, so that it is there when a preset is picked.
    const before = await keywordInk(page)
    await page.getByRole('button', { name: 'Choose a theme' }).click()
    await expect(page.locator('link#sb-code-themes')).toHaveCount(1)
    await page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'Forest' }).click()
    await expect.poll(() => keywordInk(page)).not.toBe(before)
    expect(asked).toHaveLength(1)

    // Once is enough: another page, reached without a reload, and the menu opened again.
    await page.locator('.sb-region-sidebar').getByRole('link', { name: 'Setting up' }).click()
    await expect(page).toHaveURL(`${BUILT}/guide/setup`)
    await page.getByRole('button', { name: 'Choose a theme' }).click()
    await expect(page.locator('link#sb-code-themes')).toHaveCount(1)
    expect(asked).toHaveLength(1)
  })

  test('are there before the first paint for a reader who comes back with a preset', async ({ browser }) => {
    const context = await browser.newContext()
    await context.addInitScript(() => localStorage.setItem('shabd-palette', 'forest'))
    const page = await context.newPage()
    const asked = watchFor(page)
    // Until the document is read and no further: before the app has run.
    await page.goto(`${BUILT}/guide/intro`, { waitUntil: 'domcontentloaded' })
    // Written into the head by the script there, as the document was being read, and so before the body
    // was laid out: a stylesheet the parser meets holds the first paint, and one added later does not.
    const link = page.locator('head > link#sb-code-themes')
    await expect(link).toHaveCount(1)
    expect(await link.evaluate((element) => element.previousElementSibling?.tagName)).toBe('SCRIPT')
    expect(asked).toHaveLength(1)

    // The code is in the preset's colours, which are not the site's own.
    await page.waitForSelector('html[data-shabd="ready"]')
    const themed = await keywordInk(page)
    await page.evaluate(() => {
      delete document.documentElement.dataset.palette
      delete document.documentElement.dataset.code
    })
    expect(await keywordInk(page)).not.toBe(themed)
    await context.close()
  })

  test('are asked for by nobody who has not picked a preset, with or without JavaScript', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false })
    const page = await context.newPage()
    const asked = watchFor(page)
    await page.goto(`${BUILT}/guide/intro`)
    await expect(page.locator('figure.sb-code').first()).toBeVisible()
    expect(asked).toEqual([])
    await context.close()
  })

  test('are in each page while shabd dev runs, where there is no such stylesheet', async ({ page }) => {
    const asked = watchFor(page)
    await open(page, `${DEV}/guide/intro`)
    await expect(page.locator('meta[name="shabd-code-themes"]')).toHaveCount(0)
    expect(await page.locator('style[data-sb-code]').textContent()).toContain(':root[data-code=')

    const before = await keywordInk(page)
    await page.getByRole('button', { name: 'Choose a theme' }).click()
    await page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'Forest' }).click()
    await expect.poll(() => keywordInk(page)).not.toBe(before)
    expect(asked).toEqual([])
    // The choice is the reader's own, in their browser. It is put back so that it is not met by the next test.
    await page.evaluate(() => localStorage.removeItem('shabd-palette'))
  })
})
