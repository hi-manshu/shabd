/**
 * Versions of the docs and languages of the site. The fixture has an older
 * version, the pages of content/v1, and German, the pages of content/de.
 * Each is a site within the site: its own sidebar, its own search, and a
 * menu that leads to the same page in the others.
 */
import type { Page } from '@playwright/test'
import { BUILT, expect, markPage, open, test } from './support/fixtures.js'

const menu = (page: Page, kind: 'version' | 'language') => page.locator(`.sb-edition-menu[data-kind="${kind}"]`)

/** What search finds for a query, as the addresses its results lead to. */
async function found(page: Page, query: string): Promise<string[]> {
  if ((await page.locator('dialog.sb-search').count()) === 0) await page.locator('.sb-search-button').click()
  const dialog = page.locator('dialog.sb-search')
  await dialog.getByRole('combobox').fill(query)
  // Either there are results, or it says that there are none.
  await expect(dialog.locator('.sb-search-hit, .sb-search-empty').first()).toBeVisible()
  return dialog.locator('.sb-search-hit').evaluateAll((hits) => hits.map((hit) => hit.getAttribute('href') ?? hit.querySelector('a')?.getAttribute('href') ?? ''))
}

test.describe('versions', () => {
  test('the menu leads to the same page in another version, and a page of an older one says what it is', async ({ page }) => {
    await open(page, `${BUILT}/guide/intro`)
    const stayed = await markPage(page)
    const versions = menu(page, 'version')
    await expect(versions.locator('.sb-edition-long')).toHaveText('2.x')
    await expect(page.locator('.sb-version-notice')).toHaveCount(0)

    await versions.locator('summary').click()
    await versions.getByRole('link', { name: '1.x' }).click()
    await expect(page).toHaveURL(`${BUILT}/v1/guide/intro`)
    // The reader was taken there in place, and the list they chose from is closed.
    expect(await stayed()).toBe(true)
    await expect(versions).not.toHaveAttribute('open')
    await expect(versions.locator('.sb-edition-long')).toHaveText('1.x')

    // The page says which version it is, and where the current one is.
    const notice = page.locator('.sb-version-notice')
    await expect(notice).toContainText('You are reading the documentation for 1.x.')
    // Its sidebar is the older version's own.
    const sidebar = page.locator('.sb-region-sidebar')
    await expect(sidebar.getByRole('link', { name: 'Retired' })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'Setting up' })).toHaveCount(0)

    await notice.getByRole('link', { name: 'Read this page in 2.x, the current version.' }).click()
    await expect(page).toHaveURL(`${BUILT}/guide/intro`)
    await expect(notice).toHaveCount(0)
    await expect(versions.locator('.sb-edition-long')).toHaveText('2.x')

    // A page the current version does not have leads to where the current version starts.
    await open(page, `${BUILT}/v1/guide/retired`)
    // Search engines are asked not to list a page of an older version: it is in the page as it is served.
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex')
    await expect(page.locator('.sb-version-notice a')).toHaveText('Go to 2.x, the current version.')
    await expect(page.locator('.sb-version-notice a')).toHaveAttribute('href', '/')
  })

  test('the menu opens and closes with the keyboard, and closes on a click elsewhere', async ({ page, browserName }) => {
    await open(page, `${BUILT}/guide/intro`)
    const versions = menu(page, 'version')
    const summary = versions.locator('summary')
    // What it is called says what the word on it is.
    await expect(summary).toHaveAccessibleName('Version: 2.x')

    await summary.focus()
    await page.keyboard.press('Enter')
    await expect(versions).toHaveAttribute('open')
    // WebKit reaches links with Option + Tab.
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab')
    await expect(versions.getByRole('link', { name: '2.x' })).toBeFocused()
    await expect(versions.getByRole('link', { name: '2.x' })).toHaveAttribute('aria-current', 'true')
    await page.keyboard.press('Escape')
    await expect(versions).not.toHaveAttribute('open')
    await expect(summary).toBeFocused()

    await summary.click()
    await expect(versions).toHaveAttribute('open')
    await page.locator('h1.sb-page-title').click()
    await expect(versions).not.toHaveAttribute('open')
  })

  test('search finds what is in the version being read, and nothing of the others', async ({ page }) => {
    await open(page, `${BUILT}/guide/intro`)
    // Both versions and the German page say "zebras". The current version's are found from here.
    const current = await found(page, 'zebras')
    expect(current.length).toBeGreaterThan(0)
    expect(current.filter((href) => href.startsWith('/v1') || href.startsWith('/de'))).toEqual([])
    // A word only the older version has is not found from the current one.
    expect(await found(page, 'quaggas')).toEqual([])

    await open(page, `${BUILT}/v1/guide/intro`)
    const older = await found(page, 'zebras')
    expect(older.length).toBeGreaterThan(0)
    expect(older.every((href) => href.startsWith('/v1/'))).toBe(true)
    expect((await found(page, 'quaggas')).map((href) => href.split('#')[0])).toEqual(['/v1/guide/intro'])
    // What only the current version says is not found from here.
    expect(await found(page, 'pelicans')).toEqual([])
  })
})

test.describe('languages', () => {
  test('the menu names each language in itself, and the page says which language it is in', async ({ page }) => {
    await open(page, `${BUILT}/guide/intro`)
    const stayed = await markPage(page)
    const languages = menu(page, 'language')
    await expect(languages.locator('.sb-edition-long')).toHaveText('English')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')

    await languages.locator('summary').click()
    const german = languages.getByRole('link', { name: 'Deutsch' })
    // The name is in German, and says so, for whoever has it read out.
    await expect(german).toHaveAttribute('lang', 'de')
    await german.click()
    await expect(page).toHaveURL(`${BUILT}/de/guide/intro`)
    expect(await stayed()).toBe(true)
    await expect(page.locator('h1.sb-page-title')).toHaveText('Einführung')
    await expect(page.locator('html')).toHaveAttribute('lang', 'de')
    await expect(languages.locator('.sb-edition-long')).toHaveText('Deutsch')
    // The site's own words are German where German gives them, and English where it does not.
    await expect(languages.locator('summary')).toHaveAccessibleName('Sprache: Deutsch (DE)')
    await expect(menu(page, 'version').locator('summary')).toHaveAccessibleName('Fassung: 2.x')

    // German has no older version of this page: the menu leads to where the older version starts.
    await menu(page, 'version').locator('summary').click()
    await expect(menu(page, 'version').getByRole('link', { name: '1.x' })).toHaveAttribute('href', '/de/v1')

    // Search from a German page finds German.
    const hits = await found(page, 'zebras')
    expect(hits.map((href) => href.split('#')[0])).toEqual(['/de/guide/intro'])
    await page.keyboard.press('Escape')

    await languages.locator('summary').click()
    await languages.getByRole('link', { name: 'English' }).click()
    await expect(page).toHaveURL(`${BUILT}/guide/intro`)
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')

    // A page German does not have leads to where German starts.
    await open(page, `${BUILT}/guide/setup`)
    await languages.locator('summary').click()
    await expect(languages.getByRole('link', { name: 'Deutsch' })).toHaveAttribute('href', '/de')
  })

  test('the links of the header follow the reader, and a language has links, a footer and words of its own', async ({ page, problems }) => {
    // In an older version a link leads to its page in that version, where the version has it.
    await open(page, `${BUILT}/v1/guide/intro`)
    const nav = page.locator('.sb-nav')
    await expect(nav.getByRole('link', { name: 'Guide' })).toHaveAttribute('href', '/v1/guide/intro')
    await expect(nav.getByRole('link', { name: 'Guide' })).toHaveAttribute('aria-current', 'true')
    await expect(nav.getByRole('link', { name: 'API' })).toHaveAttribute('href', '/api/ping')
    // The site has no footer of its own, so no page in English has one.
    await expect(page.locator('.sb-footer')).toHaveCount(0)
    await expect(page.locator('.sb-site-title')).toHaveAttribute('href', '/')

    // German has its own links and its own footer, and the site's title leads to where German starts.
    await open(page, `${BUILT}/de/guide/intro`)
    await expect(nav.getByRole('link')).toHaveText(['Anleitung'])
    await expect(nav.getByRole('link', { name: 'Anleitung' })).toHaveAttribute('aria-current', 'true')
    await expect(page.locator('.sb-footer')).toHaveText('Eine Seite für die Browsertests von Shabd.')
    await expect(page.locator('.sb-site-title')).toHaveAttribute('href', '/de')
    // The words around the page are German where German gives them.
    await expect(page.locator('.sb-search-button-label')).toHaveText('Suche')
    await expect(page.locator('.sb-toc-title')).toHaveText('Auf dieser Seite')

    // The page for an address that does not exist is written once, in the site's own language. Under
    // German's path it is drawn in German, with German's sidebar, and nothing is said in the console
    // but that the address was not found.
    problems.length = 0
    const response = await page.goto(`${BUILT}/de/keine/solche/seite`)
    expect(response?.status()).toBe(404)
    await expect(page.locator('html[data-shabd="ready"]')).toBeAttached()
    await expect(page.locator('h1.sb-page-title')).toHaveText('Seite nicht gefunden')
    await expect(page).toHaveTitle('Seite nicht gefunden | Fixture')
    await expect(page.locator('html')).toHaveAttribute('lang', 'de')
    await expect(nav.getByRole('link')).toHaveText(['Anleitung'])
    await expect(page.locator('.sb-region-sidebar').getByRole('link', { name: 'Einführung' })).toBeVisible()
    await expect(page.locator('.sb-not-found a')).toHaveAttribute('href', '/de')
    expect(problems.filter((problem) => !/404|Not Found/i.test(problem))).toEqual([])
  })

  test('a language written from right to left has the page the other way round', async ({ page }) => {
    await open(page, `${BUILT}/guide/intro`)
    const sidebar = page.locator('.sb-region-sidebar')
    const main = page.locator('.sb-region-main')
    const left = async (region: typeof sidebar) => (await region.boundingBox())!.x
    expect(await left(sidebar)).toBeLessThan(await left(main))

    // Reached in place, from the menu: the direction is the page's, and goes with it.
    const languages = menu(page, 'language')
    await languages.locator('summary').click()
    await languages.getByRole('link', { name: 'العربية' }).click()
    await expect(page).toHaveURL(`${BUILT}/ar/guide/intro`)
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
    await expect(page.locator('h1.sb-page-title')).toHaveText('مقدمة')
    expect(await left(sidebar)).toBeGreaterThan(await left(main))
    // Nothing is wider than the window: a page that was not mirrored throughout would scroll sideways.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)

    // The same page as it is served says so in the document, before any script runs.
    await open(page, `${BUILT}/ar/guide/intro`)
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    expect(await left(sidebar)).toBeGreaterThan(await left(main))

    await languages.locator('summary').click()
    await languages.getByRole('link', { name: 'English' }).click()
    await expect(page).toHaveURL(`${BUILT}/guide/intro`)
    await expect(page.locator('html')).not.toHaveAttribute('dir')
    expect(await left(sidebar)).toBeLessThan(await left(main))
  })

  test('with no script at all the menus are lists of links that lead somewhere', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false })
    const page = await context.newPage()
    await page.goto(`${BUILT}/guide/intro`)
    const versions = menu(page, 'version')
    await expect(versions.getByRole('link', { name: '1.x' })).toBeHidden()
    await versions.locator('summary').click()
    await versions.getByRole('link', { name: '1.x' }).click()
    await expect(page).toHaveURL(`${BUILT}/v1/guide/intro`)
    await expect(page.locator('.sb-version-notice')).toContainText('You are reading the documentation for 1.x.')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await page.goto(`${BUILT}/de/guide/intro`)
    await expect(page.locator('html')).toHaveAttribute('lang', 'de')
    await context.close()
  })
})
