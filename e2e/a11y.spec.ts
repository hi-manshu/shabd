/**
 * Accessibility: what a checker can find, and what only a keyboard can.
 *
 * axe looks at each kind of page, and at the parts that open over a page,
 * in both colour modes. It finds what can be found by rule: a control with
 * no name, a role used wrongly, text too faint for what is behind it. It
 * cannot tell whether a dialog can be left, or where the focus goes when a
 * panel closes. The tests after it press the keys.
 */
import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { BUILT, expect, open, test } from './support/fixtures.js'

/** What axe finds on the page as it is now, one line for each rule and place. */
async function findings(page: Page, within?: string): Promise<string[]> {
  let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
  if (within) builder = builder.include(within)
  const { violations } = await builder.analyze()
  return violations.flatMap((violation) => violation.nodes.map((node) => `${violation.id}: ${node.target.join(' ')} — ${node.failureSummary?.split('\n')[1]?.trim() ?? violation.help}`))
}

const PAGES = {
  'a doc page': '/guide/intro',
  'the home page': '/',
  'an API page': '/api/ping',
  'a page of components': '/play/writing',
  'a page made from a description': '/store/items/add-item',
  'a page of an older version': '/v1/guide/intro',
  'a page in another language': '/de/guide/intro',
  'a page written from right to left': '/ar/guide/intro',
}

test.describe('what a checker finds', () => {
  for (const scheme of ['light', 'dark'] as const) {
    for (const [name, path] of Object.entries(PAGES)) {
      test(`nothing on ${name}, in the ${scheme} mode`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme })
        await open(page, `${BUILT}${path}`)
        await expect(page.locator('html')).toHaveAttribute('data-theme', scheme)
        expect(await findings(page)).toEqual([])
      })
    }
  }

  test('nothing in the search dialog, with results and with none', async ({ page }) => {
    await open(page, `${BUILT}/guide/intro`)
    await page.keyboard.press('/')
    const dialog = page.locator('dialog.sb-search')
    await dialog.getByRole('combobox').fill('step')
    await expect(dialog.locator('.sb-search-hit').nth(1)).toBeVisible()
    expect(await findings(page, 'dialog.sb-search')).toEqual([])
    await dialog.getByRole('combobox').fill('qqzzxx')
    await expect(dialog.locator('.sb-search-empty')).toBeVisible()
    expect(await findings(page, 'dialog.sb-search')).toEqual([])
  })

  test('nothing in the theme menu, or in the form that tries a request', async ({ page }) => {
    await open(page, `${BUILT}/api/create`)
    await page.getByRole('button', { name: 'Choose a theme' }).click()
    await expect(page.getByRole('group', { name: 'Theme' })).toBeVisible()
    expect(await findings(page, '.sb-theme-menu')).toEqual([])
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Try it' }).click()
    await expect(page.locator('.sb-api-try')).toBeVisible()
    expect(await findings(page, '.sb-api-endpoint')).toEqual([])
  })

  test('nothing on a phone-size screen, with the navigation closed and open', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 })
    await open(page, `${BUILT}/guide/intro`)
    expect(await findings(page)).toEqual([])
    await page.getByRole('button', { name: 'Open navigation' }).click()
    // The panel fades in. Half-way there its text is half as dark, which is not what a reader is left with.
    await expect(page.locator('.sb-region-sidebar')).toHaveCSS('opacity', '1')
    expect(await findings(page)).toEqual([])
  })
})

/** Safari moves to links and buttons with Option and Tab, and keeps Tab alone for text fields. */
const tabKey = (browserName: string) => (browserName === 'webkit' ? 'Alt+Tab' : 'Tab')

/** What has the keyboard's focus: the region it is in, and its text or its name. */
const focused = (page: Page) =>
  page.evaluate(() => {
    const element = document.activeElement
    const region = element?.closest('.sb-region')?.className.replace('sb-region sb-region-', '') ?? (element?.closest('dialog') ? 'dialog' : 'none')
    return `${region}: ${element?.getAttribute('aria-label') ?? element?.textContent?.trim() ?? ''}`
  })

test.describe('with the keyboard', () => {
  test('the navigation on a phone-size screen opens, keeps the focus off the page it covers, and closes with Escape', async ({ page, browserName }) => {
    await page.setViewportSize({ width: 390, height: 800 })
    await open(page, `${BUILT}/guide/intro`)
    const toggle = page.locator('.sb-menu-toggle')
    const main = page.locator('#sb-main')
    // The button says what it opens, and whether it is open.
    await expect(toggle).toHaveAttribute('aria-controls', 'sb-sidebar')
    await expect(page.locator('#sb-sidebar')).toHaveClass(/sb-region-sidebar/)
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(main).not.toHaveAttribute('inert', /.*/)

    await toggle.focus()
    await page.keyboard.press('Enter')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(toggle).toHaveAccessibleName('Close navigation')
    // The page under the panel cannot be seen, and so cannot be reached.
    await expect(main).toHaveAttribute('inert', /.*/)
    await expect(page.locator('.sb-region-aside')).toHaveAttribute('inert', /.*/)
    await expect(page.locator('.sb-region-header')).not.toHaveAttribute('inert', /.*/)
    await expect(page.locator('#sb-sidebar')).not.toHaveAttribute('inert', /.*/)

    // Tab goes on through the header and into the panel, and never to what is behind it.
    const visited: string[] = []
    for (let presses = 0; presses < 30; presses++) {
      await page.keyboard.press(tabKey(browserName))
      visited.push(await focused(page))
    }
    expect(visited.some((place) => place.startsWith('sidebar: '))).toBe(true)
    expect(visited.filter((place) => /^(main|aside|footer): /.test(place))).toEqual([])

    // Escape, from inside the panel, closes it and gives the focus back to the button.
    await page.locator('#sb-sidebar a').first().focus()
    await page.keyboard.press('Escape')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(toggle).toBeFocused()
    await expect(main).not.toHaveAttribute('inert', /.*/)
  })

  test('a navigation left open is closed when the window grows, and the page is not left out of reach', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 })
    await open(page, `${BUILT}/guide/intro`)
    await page.getByRole('button', { name: 'Open navigation' }).click()
    await expect(page.locator('#sb-main')).toHaveAttribute('inert', /.*/)

    await page.setViewportSize({ width: 1280, height: 800 })
    await expect(page.locator('.sb-shell')).not.toHaveAttribute('data-sidebar-open', /.*/)
    await expect(page.locator('#sb-main')).not.toHaveAttribute('inert', /.*/)
    // The sidebar is a column of the page again, and a link in the page can be followed.
    await expect(page.locator('#sb-sidebar')).toBeVisible()
    await page.locator('.sb-pagination-link[rel="next"]').click()
    await expect(page).toHaveURL(`${BUILT}/guide/setup`)
  })

  test('the search dialog names its field, says how many results there are, keeps the focus inside and gives it back', async ({ page, browserName }) => {
    await open(page, `${BUILT}/guide/intro`)
    const button = page.locator('.sb-search-button')
    await button.focus()
    await page.keyboard.press('Enter')
    const dialog = page.locator('dialog.sb-search')
    // The field is called what it is for, not what the button beside it does.
    const field = dialog.getByRole('combobox', { name: 'Search the docs' })
    await expect(field).toBeFocused()
    await expect(dialog.getByRole('button', { name: 'Esc: close search' })).toHaveText('esc')

    // What a screen reader is told as the results change.
    const said = dialog.locator('[aria-live="polite"]')
    await expect(said).toHaveText('')
    await field.fill('pelicans')
    await expect(said).toHaveText('1 result')
    await field.fill('step')
    await expect(said).toHaveText(/^[2-9] results$/)
    await field.fill('qqzzxx')
    await expect(said).toHaveText('0 results')
    // The option the arrow keys are on is named to the field, which keeps the focus.
    await field.fill('step')
    await page.keyboard.press('ArrowDown')
    const active = await field.getAttribute('aria-activedescendant')
    await expect(dialog.locator(`[id="${active}"]`)).toHaveAttribute('aria-selected', 'true')
    await expect(field).toBeFocused()

    // Tab never reaches the page behind a modal dialog. It goes round the dialog and the browser's own
    // controls, and while it is on those the page has the focus nowhere.
    const visited: string[] = []
    for (let presses = 0; presses < 8; presses++) {
      await page.keyboard.press(tabKey(browserName))
      visited.push(await focused(page))
    }
    expect(visited.filter((place) => !/^(dialog|none): /.test(place))).toEqual([])
    expect(visited.some((place) => place.startsWith('dialog: '))).toBe(true)

    // Escape closes it, and the focus is back where it was.
    await field.focus()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(button).toBeFocused()
  })

  test('tabs move with the arrows, Home and End, and Tab goes from a tab into its panel', async ({ page, browserName }) => {
    await open(page, `${BUILT}/play/writing`)
    const set = page.locator('.sb-tabs').nth(1)
    const tabs = set.getByRole('tab')
    await expect(tabs).toHaveText(['npm', 'pnpm', 'yarn'])
    // One tab of a set is in the tab order: the one that is chosen.
    expect(await tabs.evaluateAll((all) => all.map((tab) => tab.tabIndex))).toEqual([0, -1, -1])

    await tabs.nth(0).focus()
    await page.keyboard.press('ArrowRight')
    await expect(tabs.nth(1)).toBeFocused()
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('End')
    await expect(tabs.nth(2)).toBeFocused()
    // Round the end, and back.
    await page.keyboard.press('ArrowRight')
    await expect(tabs.nth(0)).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect(tabs.nth(2)).toBeFocused()
    await page.keyboard.press('Home')
    await expect(tabs.nth(0)).toBeFocused()
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true')

    // The panel of the chosen tab is named by it, and is where Tab goes next.
    const panel = set.getByRole('tabpanel')
    await expect(panel).toHaveCount(1)
    await expect(panel).toHaveAccessibleName('npm')
    await page.keyboard.press(tabKey(browserName))
    await expect(panel).toBeFocused()
    await expect(panel).toHaveText('And npm there.')
  })
})
