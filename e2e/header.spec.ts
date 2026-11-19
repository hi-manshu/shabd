/**
 * A header with a colour of its own.
 *
 * `colors.headerText` gives the header an ink, so that it can be a dark bar
 * on a light page. The Windows XP preset has one: a blue bar written in
 * white. The fixture's own palette has none.
 */
import type { Browser } from '@playwright/test'
import { BUILT, expect, test } from './support/fixtures.js'

async function openWith(browser: Browser, palette: string | undefined, scheme: 'light' | 'dark') {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: scheme })
  if (palette) await context.addInitScript((name) => localStorage.setItem('shabd-palette', name), palette)
  const page = await context.newPage()
  await page.goto(`${BUILT}/guide/intro`)
  await page.waitForSelector('html[data-shabd="ready"]')
  const token = (name: string) => page.evaluate((property) => getComputedStyle(document.documentElement).getPropertyValue(property).trim(), name)
  return { context, page, token }
}

/** A colour as the browser computes it, so that two ways of writing one colour compare equal. */
const computed = (page: import('@playwright/test').Page, colour: string) =>
  page.evaluate((value) => {
    const probe = document.createElement('span')
    probe.style.color = value
    document.body.append(probe)
    const seen = getComputedStyle(probe).color
    probe.remove()
    return seen
  }, colour)

test.describe('the header', () => {
  test('is written in the page\'s colours when it has no ink of its own', async ({ browser }) => {
    for (const scheme of ['light', 'dark'] as const) {
      const { context, page, token } = await openWith(browser, undefined, scheme)
      const header = page.locator('.sb-region-header')
      await expect(header).toHaveCSS('color', await computed(page, await token('--sb-text')))
      // A link of the header that is not the current one is in the page's quiet colour.
      await expect(header.locator('.sb-nav a:not([aria-current])').first()).toHaveCSS('color', await computed(page, await token('--sb-muted')))
      // The logo follows the page.
      await expect(header.locator('.sb-logo.sb-only-light')).toBeVisible({ visible: scheme === 'light' })
      await expect(header.locator('.sb-logo.sb-only-dark')).toBeVisible({ visible: scheme === 'dark' })
      await context.close()
    }
  })

  test('takes its own ink from a preset that has one, with the logo drawn for the dark', async ({ browser, browserName }) => {
    // Safari moves to links and buttons with Option and Tab, and keeps Tab alone for text fields.
    const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab'
    const { context, page, token } = await openWith(browser, 'xp', 'light')
    const header = page.locator('.sb-region-header')
    const white = await computed(page, '#ffffff')
    expect(await token('--sb-text')).toBe('#000000')
    await expect(header).toHaveCSS('color', white)
    await expect(header.locator('.sb-site-title')).toHaveCSS('color', white)

    // The quieter links are the same ink with the header showing through, not the page's grey.
    const link = header.locator('.sb-nav a:not([aria-current])').first()
    await expect(link).not.toHaveCSS('color', await computed(page, await token('--sb-muted')))
    expect(await link.evaluate((element) => getComputedStyle(element).color)).toMatch(/0\.76\)$/)
    // Under the pointer it is the full ink.
    await link.hover()
    await expect(link).toHaveCSS('color', white)

    // A light page, and still the logo drawn for the dark: the bar it stands on is dark.
    await expect(header.locator('.sb-logo.sb-only-dark')).toBeVisible()
    await expect(header.locator('.sb-logo.sb-only-light')).toBeHidden()

    // The keyboard's focus is ringed in the ink, which shows on the bar where the page's accent would not.
    await link.focus()
    await page.keyboard.press(tab)
    const focused = page.locator('.sb-region-header :focus-visible')
    await expect(focused).toHaveCSS('outline-color', white)

    // The palette menu opens from the header and is a panel of the page: nothing in it is written in white.
    await header.getByRole('button', { name: 'Choose a theme' }).click()
    const list = header.locator('.sb-theme-menu-list')
    await expect(list).toBeVisible()
    await expect(list).toHaveCSS('color', await computed(page, await token('--sb-text')))
    for (const colour of await list.locator('.sb-theme-option').evaluateAll((options) => options.map((option) => getComputedStyle(option).color))) {
      expect(colour).not.toBe(white)
    }
    await list.locator('.sb-theme-option').first().focus()
    await page.keyboard.press(tab)
    await expect(list.locator(':focus-visible')).toHaveCSS('outline-color', await computed(page, await token('--sb-accent')))
    await context.close()
  })
})
