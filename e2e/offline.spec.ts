/**
 * Reading the site without a connection (`features.offline`), with the
 * worker a build writes, in a real browser.
 *
 * It runs only when asked for, on a fixture built with the feature on. The
 * worker answers every request of the site, which gets in the way of the
 * tests that answer requests themselves, so the other tests run without it.
 *
 *     SHABD_E2E_OFFLINE=1 npx playwright test e2e/offline.spec.ts
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { BUILT, expect, test } from './support/fixtures.js'

test.skip(!process.env.SHABD_E2E_OFFLINE, 'needs the fixture built with SHABD_E2E_OFFLINE=1')

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '.work', 'preview', 'dist')

/**
 * Playwright cuts the connection of a page. In its Firefox a worker's own
 * requests still reach the server, so there a test of what happens without
 * a connection would pass with the worker doing nothing.
 */
const CUTS_WORKERS_OFF = (browserName: string) => browserName !== 'firefox'

/** Open a page and wait until the worker has fetched the site and answers for this page. */
async function visitAndKeep(page: Page, address: string): Promise<void> {
  await page.goto(`${BUILT}${address}`)
  await page.waitForSelector('html[data-shabd="ready"]')
  // Installed, which is when every file has been fetched, and in charge of this page.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
}

/** Ask for an address from inside the page, as a script of the site would: what came back, or that nothing did. */
const ask = (page: Page, address: string, method = 'GET') =>
  page.evaluate(
    ([url, verb]) =>
      fetch(url!, { method: verb! }).then(
        async (response) => ({ status: response.status, text: await response.text() }),
        () => ({ status: 0, text: '' }),
      ),
    [address, method],
  )

test.describe('a site kept for reading offline', () => {
  test('is fetched whole by a worker on the first visit, which then answers for the site', async ({ page }) => {
    await visitAndKeep(page, '/guide/intro')
    expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(`${BUILT}/shabd-sw.js`)
    const copies = await page.evaluate(async () => {
      const names = (await caches.keys()).filter((name) => name.startsWith('shabd:/:'))
      const kept = await (await caches.open(names[0]!)).keys()
      return { names: names.length, addresses: kept.map((request) => new URL(request.url).pathname) }
    })
    // One copy of the site: this build's. In it, pages that were never opened, and what search reads.
    expect(copies.names).toBe(1)
    expect(copies.addresses).toEqual(expect.arrayContaining(['/play/writing/index.html', '/guide/setup/index.html', '/_shabd/search-index.json', '/_shabd/offline.html']))
    // And nothing that only a program reads.
    expect(copies.addresses.filter((address) => /\.md$|llms|sitemap|rss/.test(address))).toEqual([])
  })

  test('opens with no connection: the page that was read, and pages that never were', async ({ page, context, browserName }) => {
    test.skip(!CUTS_WORKERS_OFF(browserName), 'a worker keeps its connection in this browser when the page is cut off')
    await visitAndKeep(page, '/guide/intro')

    await context.setOffline(true)
    // The page that was read, loaded again from nothing.
    await page.reload()
    await page.waitForSelector('html[data-shabd="ready"]')
    await expect(page.locator('h1.sb-page-title')).toHaveText('Introduction')
    await expect(page.locator('figure.sb-code').first()).toBeVisible()

    // A page that was never opened, by its address.
    await page.goto(`${BUILT}/play/writing`)
    await page.waitForSelector('html[data-shabd="ready"]')
    await expect(page.locator('h1.sb-page-title')).toHaveText('Writing components')

    // And another, from the sidebar, without loading a new document.
    await page.locator('.sb-region-sidebar').getByRole('link', { name: 'Setting up' }).click()
    await expect(page).toHaveURL(`${BUILT}/guide/setup`)
    await expect(page.locator('h1.sb-page-title')).toHaveText('Setting up')

    // Search has its index, and finds by keyword.
    await page.keyboard.press('/')
    const dialog = page.locator('dialog.sb-search')
    await dialog.getByRole('combobox').fill('pelicans')
    await expect(dialog.locator('.sb-search-hit').first()).toContainText('Second step')
    await page.keyboard.press('Escape')

    // Reading is all the worker does. A request that writes is not answered from a copy.
    expect((await ask(page, '/guide/intro')).status).toBe(200)
    expect((await ask(page, '/guide/intro', 'POST')).status).toBe(0)

    // A diagram is drawn by a library of megabytes, which is not fetched ahead. This reader never saw one,
    // so the page opens with the diagram as the text it was written as. It is opened in a tab of its own:
    // a browser reports a script that could not be fetched, and here that is what is meant to happen.
    const tab = await context.newPage()
    await tab.goto(`${BUILT}/play/diagram`)
    await tab.waitForSelector('html[data-shabd="ready"]')
    await expect(tab.locator('h1.sb-page-title')).toHaveText('A diagram')
    await expect(tab.locator('.sb-mermaid').first()).toContainText('flowchart')
    await expect(tab.locator('.sb-mermaid svg')).toHaveCount(0)
    await tab.close()

    // An address the site has no page for: the reader is told there is no connection, in the site's own look.
    const missing = await page.goto(`${BUILT}/guide/nowhere-at-all`)
    expect(missing?.status()).toBe(503)
    await expect(page.locator('h1')).toHaveText('There is no connection')
    await page.getByRole('link', { name: 'Go to the home page' }).click()
    await expect(page.locator('h1.sb-hero-title')).toHaveText('A fixture site')

    await context.setOffline(false)
  })

  test('keeps what a page loaded on demand, from the first time it did', async ({ page, context, browserName }) => {
    test.skip(!CUTS_WORKERS_OFF(browserName), 'a worker keeps its connection in this browser when the page is cut off')
    await visitAndKeep(page, '/guide/intro')
    // With a connection, the page with a diagram is opened once: the library that draws it is fetched then.
    await page.goto(`${BUILT}/play/diagram`)
    await expect(page.locator('.sb-mermaid svg').first()).toBeVisible({ timeout: 20_000 })

    await context.setOffline(true)
    await page.reload()
    await page.waitForSelector('html[data-shabd="ready"]')
    const drawing = page.locator('.sb-mermaid svg').first()
    await expect(drawing).toBeVisible({ timeout: 20_000 })
    await expect(drawing).toContainText('shabd build')
    await context.setOffline(false)
  })

  test('with a connection, a page is what is published now and not the copy that was kept', async ({ page, context, browserName }) => {
    await visitAndKeep(page, '/guide/intro')
    const file = path.join(DIST, 'guide', 'setup', 'index.html')
    const published = await readFile(file, 'utf8')
    try {
      // The site is published again with a change, and this browser still holds the page as it was.
      await writeFile(file, published.replace('Install the thing.', 'Install the newer thing.'))
      expect((await ask(page, '/guide/setup')).text).toContain('Install the newer thing.')

      // Cut off, the same address is answered from the copy, which is the page as it was kept.
      if (CUTS_WORKERS_OFF(browserName)) {
        await context.setOffline(true)
        const copy = await ask(page, '/guide/setup')
        expect(copy.status).toBe(200)
        expect(copy.text).toContain('Install the thing.')
        await context.setOffline(false)
      }
    } finally {
      await writeFile(file, published)
    }
  })
})
