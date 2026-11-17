/** The layout at sizes and in states the other tests do not reach. */
import type { Locator } from '@playwright/test'
import { BUILT, expect, open, test } from './support/fixtures.js'

const edges = (locator: Locator) =>
  locator.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { top: Math.round(rect.top), bottom: Math.round(rect.bottom) }
  })

test.describe('a sidebar longer than a small screen', () => {
  test.use({ viewport: { width: 390, height: 480 } })

  test('fills the space under the header and scrolls inside it, and does not cover the header', async ({ page }) => {
    // A page with a banner above the header, so that the header is not at the top of the window.
    await open(page, `${BUILT}/guide/hosting`)
    const header = page.locator('.sb-region-header')
    const sidebar = page.locator('.sb-region-sidebar')
    await page.getByRole('button', { name: 'Open navigation' }).click()
    await expect(sidebar).toBeVisible()

    // The panel runs from the foot of the header to the foot of the window, however much is in it.
    await expect.poll(async () => (await edges(sidebar)).top).toBe((await edges(header)).bottom)
    expect((await edges(sidebar)).bottom).toBe(480)
    // There is more in it than fits, and that scrolls inside the panel.
    expect(await sidebar.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)

    // The last entry is below the fold. It can be reached and pressed.
    await sidebar.getByRole('link', { name: 'Beta notes' }).click()
    await expect(page).toHaveURL(`${BUILT}/extras/beta`)
    await expect(sidebar).toBeHidden()
  })
})
