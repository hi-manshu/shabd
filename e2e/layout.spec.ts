/** The layout at sizes and in states the other tests do not reach. */
import type { Locator } from '@playwright/test'
import { BUILT, expect, open, test } from './support/fixtures.js'

const edges = (locator: Locator) =>
  locator.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { top: Math.round(rect.top), bottom: Math.round(rect.bottom) }
  })

test.describe('a block with a condition', () => {
  test('is on the pages its condition names and on no others, also after moving between them', async ({ page }) => {
    // The site puts a notice in every layout's banner, for pages under /extras.
    await open(page, `${BUILT}/extras/alpha`)
    await expect(page.locator('.sb-region-banner')).toHaveText('A notice above the header.')

    // Without loading a new document: the layout is worked out again for the page that is arrived at.
    await page.locator('.sb-region-sidebar').getByRole('link', { name: 'Introduction' }).click()
    await expect(page).toHaveURL(`${BUILT}/guide/intro`)
    await expect(page.locator('.sb-region-banner')).toHaveCount(0)

    await page.goBack()
    await expect(page.locator('.sb-region-banner')).toHaveText('A notice above the header.')
  })
})

test.describe('prose beside code', () => {
  const cells = async (page: import('@playwright/test').Page) => {
    await open(page, `${BUILT}/api/ping`)
    const prose = await page.locator('.sb-split-prose').first().boundingBox()
    const code = await page.locator('.sb-split-code').first().boundingBox()
    return { prose: prose!, code: code! }
  }

  test('an api page sets its code beside its text on a wide screen', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const { prose, code } = await cells(page)
    // Side by side: the code starts to the right of where the text ends, at the same height.
    expect(code.x).toBeGreaterThan(prose.x + prose.width)
    expect(Math.abs(code.y - prose.y)).toBeLessThan(2)
    await expect(page.locator('.sb-split-code figure.sb-code')).toContainText('curl https://api.fixture.test/v1/ping/eu')
  })

  test('and under it on a narrow one', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 })
    const { prose, code } = await cells(page)
    expect(code.y).toBeGreaterThanOrEqual(prose.y + prose.height)
    expect(Math.abs(code.x - prose.x)).toBeLessThan(2)
  })
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
