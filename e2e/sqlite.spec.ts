/**
 * The SQLite search store. The fixture is built with it when the tests are
 * started as:
 *
 *     SHABD_E2E_STORE=sqlite npx playwright test e2e/sqlite.spec.ts
 */
import { BUILT, DEV, expect, open, test } from './support/fixtures.js'

test.skip(process.env.SHABD_E2E_STORE !== 'sqlite', 'needs the fixture built with SHABD_E2E_STORE=sqlite')

test('the build ships the index as a SQLite database, with a manifest that describes it', async ({ request }) => {
  const manifest = (await (await request.get(`${BUILT}/_shabd/search-manifest.json`)).json()) as {
    version: string
    bytes: number
    sections: number
  }
  expect(manifest.sections).toBeGreaterThan(10)
  expect(manifest.version).toMatch(/^[0-9a-f]{16}$/)

  const database = await (await request.get(`${BUILT}/_shabd/search.sqlite`)).body()
  expect(database.subarray(0, 15).toString()).toBe('SQLite format 3')
  expect(database.length).toBe(manifest.bytes)

  // The dev server builds the same database on demand.
  const dev = await (await request.get(`${DEV}/_shabd/search.sqlite`)).body()
  expect(dev.subarray(0, 15).toString()).toBe('SQLite format 3')
})

test('search runs on SQLite in the browser', async ({ page }) => {
  await open(page, `${BUILT}/guide/intro`)
  await page.locator('.sb-search-button').click()
  const dialog = page.locator('dialog.sb-search')
  await expect(dialog).toHaveAttribute('data-store', 'sqlite', { timeout: 20_000 })

  const input = dialog.getByRole('combobox')
  const hits = dialog.locator('.sb-search-hit')

  await input.fill('pelicans')
  await expect(hits).toHaveCount(1)
  await expect(hits.first()).toContainText('Setting up')
  await expect(hits.first()).toContainText('Second step')

  // A word that is still being typed matches by prefix.
  await input.fill('zeb')
  await expect(hits.first()).toContainText('Introduction')

  // Whatever is typed is searched for as words, not run as a query.
  await input.fill('title:pelicans OR "')
  await expect(hits.first()).toContainText('Setting up')

  await input.fill('qqzzxx')
  await expect(dialog.locator('.sb-search-empty')).toContainText('Nothing matches')

  await input.fill('step')
  await expect(hits.nth(1)).toBeVisible()
  await input.press('Enter')
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(/\/guide\/setup#(first|second)-step$/)
})

test('the database is stored in the browser and not downloaded again', async ({ page, browserName }) => {
  const downloads: string[] = []
  await page.context().route('**/_shabd/search.sqlite', async (route) => {
    downloads.push(route.request().url())
    await route.continue()
  })

  const openSearch = async () => {
    await open(page, `${BUILT}/guide/intro`)
    await page.locator('.sb-search-button').click()
    const dialog = page.locator('dialog.sb-search')
    await expect(dialog).toHaveAttribute('data-store', 'sqlite', { timeout: 20_000 })
    await dialog.getByRole('combobox').fill('pelicans')
    await expect(dialog.locator('.sb-search-hit')).toHaveCount(1)
    return dialog
  }

  const first = await openSearch()
  const persistent = (await first.getAttribute('data-persistent')) !== null
  test.info().annotations.push({ type: 'opfs', description: `${browserName}: stored between visits = ${persistent}` })
  // Where the browser offers its private file system to workers, the store must use it.
  if (browserName === 'chromium') expect(persistent).toBe(true)

  const firstVisit = downloads.length
  await page.reload()
  const second = await openSearch()
  if (persistent) {
    await expect(second).toHaveAttribute('data-persistent', '')
    // Request interception sees worker requests in Chromium only, so the count is only meaningful there.
    if (browserName === 'chromium') {
      expect(firstVisit).toBe(1)
      expect(downloads.length).toBe(1)
    }
  }
})
