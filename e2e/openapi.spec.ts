/**
 * Pages made from an OpenAPI description.
 *
 * The fixture names `store.yaml` under `openapi:`, with its pages at
 * /store and "Try it" on each. None of those pages is a file of the site.
 */
import { BUILT, DEV, expect, markPage, open, test } from './support/fixtures.js'

test.describe('an API made from a description', () => {
  test('has an overview and a page for each operation, listed as the description has them', async ({ page }) => {
    await open(page, `${BUILT}/store`)
    await expect(page.locator('h1.sb-page-title')).toHaveText('Fixture store')
    // The overview leads to every operation.
    await page.locator('.sb-content').getByRole('link', { name: 'Add an item' }).click()
    await expect(page).toHaveURL(`${BUILT}/store/items/add-item`)

    // In the sidebar the API is a part of the site, called what its description calls it. Its tags are
    // its groups, and the operations are in the order they were written, not in the order of the alphabet.
    const api = page.locator('.sb-region-sidebar .sb-nav-category', { hasText: 'Fixture store' })
    await expect(api.locator('.sb-nav-link')).toHaveText(['Fixture store', 'List items', 'Add an item', 'Count what is left'])
    await expect(api.locator('.sb-nav-folder > summary')).toHaveText(['Items', 'Stock'])
    await expect(api.locator('.sb-nav-link[aria-current="page"]')).toHaveText('Add an item')

    // The page of an operation: the request line, what it takes and what it answers.
    await expect(page.locator('.sb-shell')).toHaveAttribute('data-layout', 'api')
    await expect(page.locator('.sb-api-method')).toHaveText('POST')
    await expect(page.locator('.sb-api-path')).toHaveText('https://store.fixture.test/v2/items')
    await expect(page.locator('.sb-api-auth')).toContainText('Bearer')
    await expect(page.locator('.sb-content')).toContainText('Its number in the catalogue.')
    await expect(page.locator('.sb-content figure.sb-code').last()).toContainText('curl --request POST')

    // Nobody can edit a page that has no file, so the link to do it is not there.
    await expect(page.getByRole('link', { name: 'Edit this page' })).toHaveCount(0)
    await open(page, `${BUILT}/guide/intro`)
    await expect(page.getByRole('link', { name: 'Edit this page' })).toBeVisible()
  })

  test('lets the request be tried, starting from the body the description gives as an example', async ({ page }) => {
    const sent: { url: string; body: unknown }[] = []
    await page.route('https://store.fixture.test/**', async (route) => {
      const request = route.request()
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*, authorization', 'access-control-allow-methods': '*' }
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      sent.push({ url: request.url(), body: request.postDataJSON() })
      await route.fulfill({ status: 201, headers: { ...cors, 'content-type': 'application/json' }, body: request.postData() ?? '' })
    })
    await open(page, `${BUILT}/store/items/add-item`)
    await page.getByRole('button', { name: 'Try it' }).click()
    const form = page.locator('.sb-api-try')
    await expect(form.getByLabel('Body')).toHaveValue('{\n  "sku": "lamp-7",\n  "name": "Desk lamp",\n  "price": 39.5\n}')
    await form.getByRole('button', { name: 'Send POST' }).click()
    await expect(form.getByRole('status')).toContainText('201')
    expect(sent).toEqual([{ url: 'https://store.fixture.test/v2/items', body: { sku: 'lamp-7', name: 'Desk lamp', price: 39.5 } }])
  })

  test('is found by search and written into llms.txt, like any other page', async ({ page, request }) => {
    await open(page, `${BUILT}/guide/intro`)
    await page.keyboard.press('/')
    const dialog = page.locator('dialog.sb-search')
    await dialog.getByRole('combobox').fill('catalogue')
    await expect(dialog.locator('.sb-search-hit').first()).toContainText(/Add an item|Count what is left|List items/)

    const llms = await (await request.get(`${BUILT}/llms.txt`)).text()
    expect(llms).toContain('[Count what is left](https://fixture.test/store/stock/get-stock.md)')
    const copy = await (await request.get(`${BUILT}/store/stock/get-stock.md`)).text()
    // The Markdown copy has no frontmatter, so the command at its end is what says how to make the request.
    expect(copy).toContain('curl --request GET')
    expect(copy).toContain("--url 'https://store.fixture.test/v2/stock/{sku}'")
  })
})

test.describe('a description that changes while shabd dev runs', () => {
  test('changes the page on screen and the sidebar in place, and its pages are not offered to the Studio', async ({ page, site }) => {
    await open(page, `${DEV}/store/items/list-items`)
    const stayed = await markPage(page)
    await expect(page.locator('h1.sb-page-title')).toHaveText('List items')
    // There is no file of this page to edit. A page of the site's own has the button.
    await expect(page.getByRole('button', { name: 'Edit page' })).toHaveCount(0)

    await site.edit('store.yaml', (text) => text.replace('summary: List items', 'summary: Everything on the shelves').replace('How many to return.', 'How many to send back.'))
    await expect(page.locator('h1.sb-page-title')).toHaveText('Everything on the shelves')
    await expect(page.locator('.sb-content')).toContainText('How many to send back.')
    await expect(page.locator('.sb-region-sidebar .sb-nav-link[aria-current="page"]')).toHaveText('Everything on the shelves')

    // An operation that is new gets a page, and a place in the sidebar, without a reload.
    await site.edit('store.yaml', (text) =>
      text.replace(
        'components:',
        '  /stock:\n    get:\n      operationId: listStock\n      summary: Count everything\n      tags: [Stock]\n      responses:\n        "200": { description: A count for each item. }\ncomponents:',
      ),
    )
    const added = page.locator('.sb-region-sidebar').getByRole('link', { name: 'Count everything' })
    await expect(added).toBeVisible()
    await added.click()
    await expect(page).toHaveURL(`${DEV}/store/stock/list-stock`)
    await expect(page.locator('.sb-api-path')).toHaveText('https://store.fixture.test/v2/stock')
    expect(await stayed()).toBe(true)

    await open(page, `${DEV}/guide/setup`)
    await expect(page.getByRole('button', { name: 'Edit page' })).toBeVisible()
  })
})
