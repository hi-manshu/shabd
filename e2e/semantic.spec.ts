/**
 * Semantic search, with the real embedding model: running in the browser,
 * for a reader, and in the two servers, behind their MCP route.
 * It downloads about 22 MB from Hugging Face, so it only runs when asked:
 *
 *     SHABD_E2E_SEMANTIC=1 npx playwright test e2e/semantic.spec.ts
 *
 * Add SHABD_E2E_STORE=sqlite to run the reader's tests against the SQLite store,
 * and SHABD_E2E_MODEL=site to have the site serve the model itself. The build
 * still downloads the model then, once, to embed the site's text with.
 */
import type { Page } from '@playwright/test'
import { BUILT, DEV, expect, open, test } from './support/fixtures.js'

test.skip(!process.env.SHABD_E2E_SEMANTIC, 'needs the fixture built with SHABD_E2E_SEMANTIC=1')

const fromSite = process.env.SHABD_E2E_MODEL === 'site'

/** Open search, wait for the model, and find the section on hosting by words it does not contain. */
async function findByMeaning(page: Page, origin: string): Promise<void> {
  await open(page, `${origin}/guide/intro`)
  await page.locator('.sb-search-button').click()
  const dialog = page.locator('dialog.sb-search')
  const input = dialog.getByRole('combobox')
  const hits = dialog.locator('.sb-search-hit')
  const status = dialog.getByRole('status')

  // Before the model has loaded, the same words find nothing: no section contains them.
  await input.fill('where can I deploy my website ')
  await expect(status).toContainText('Searching by keyword')

  await expect(status).toHaveText('Searching by keyword and by meaning. Your query stays on this device.', {
    timeout: 150_000,
  })
  await expect(hits.first()).toContainText('Going live')
  await expect(hits.first()).toContainText('Hosting')
  await expect(hits.first().locator('.sb-search-hit-related')).toContainText('Related')

  // Keyword matches still work, and a nonsense query still finds nothing.
  await input.fill('pelicans ')
  await expect(hits.first()).toContainText('Second step')
  await expect(hits.first().locator('.sb-search-hit-related')).toHaveCount(0)
  await input.fill('qqzzxx ')
  await expect(dialog.locator('.sb-search-empty')).toContainText('Nothing matches')

  if (process.env.SHABD_E2E_STORE === 'sqlite') await expect(dialog).toHaveAttribute('data-store', 'sqlite')
}

test('finds a section by meaning when it shares no word with the query', async ({ page, context, browserName }) => {
  test.setTimeout(180_000)
  // Every request the page and its worker make to another host. Only Chromium shows a worker's requests here.
  const elsewhere: string[] = []
  context.on('request', (request) => {
    // The runtime is started from a blob the page made itself, which is not a request to anywhere.
    if (/^https?:/.test(request.url()) && !request.url().startsWith(BUILT)) elsewhere.push(new URL(request.url()).host)
  })

  await findByMeaning(page, BUILT)

  if (browserName === 'chromium') {
    const hosts = [...new Set(elsewhere)].sort()
    // Left to itself the browser fetches the model from Hugging Face and the runtime that executes it from jsDelivr.
    if (fromSite) expect(hosts).toEqual([])
    else expect(hosts).toEqual(expect.arrayContaining(['cdn.jsdelivr.net', 'huggingface.co']))
  }
})

test.describe('with the model served from the site', () => {
  test.skip(!fromSite, 'needs the fixture built with SHABD_E2E_MODEL=site')

  test('search by meaning loads with every other host out of reach', async ({ browser }) => {
    test.setTimeout(180_000)
    // A proxy that is not there, for everything but this machine: a request to another host fails. This holds
    // for a worker's requests too, in every engine, where watching requests does not.
    const context = await browser.newContext({ proxy: { server: 'http://127.0.0.1:9', bypass: 'localhost' } })
    try {
      await findByMeaning(await context.newPage(), BUILT)
    } finally {
      await context.close()
    }
  })

  test('the dev server serves the model and the runtime too', async ({ browser, request }) => {
    test.setTimeout(180_000)
    const config = await request.get(`${DEV}/_shabd/models/Xenova/all-MiniLM-L6-v2/config.json`)
    expect(config.ok()).toBe(true)
    expect(config.headers()['content-type']).toContain('application/json')
    const runtime = await request.head(`${DEV}/_shabd/runtime/ort-wasm-simd-threaded.asyncify.wasm`)
    expect(runtime.headers()['content-type']).toBe('application/wasm')
    // Only the files that are meant to be served are: nothing else of the folders they lie in.
    expect((await request.get(`${DEV}/_shabd/models/..%2F..%2Fpackage.json`)).ok()).toBe(false)
    expect((await request.get(`${DEV}/_shabd/runtime/ort.node.min.js`)).ok()).toBe(false)

    const context = await browser.newContext({ proxy: { server: 'http://127.0.0.1:9', bypass: 'localhost' } })
    try {
      await findByMeaning(await context.newPage(), DEV)
    } finally {
      await context.close()
    }
  })
})

test('an agent finds the same section by meaning, through `shabd preview` and through `shabd dev`', async ({ request }) => {
  test.setTimeout(180_000)
  const search = async (server: string, query: string) => {
    const response = await request.post(`${server}/mcp`, {
      headers: { accept: 'application/json, text/event-stream' },
      data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_docs', arguments: { query } } },
      // The first search loads the model into the server, which has not needed it until now.
      timeout: 150_000,
    })
    return ((await response.json()) as { result: { content: { text: string }[] } }).result.content[0]!.text
  }

  for (const server of [BUILT, DEV]) {
    // No section contains these words. The one on hosting is about them.
    expect(await search(server, 'where can I deploy my website'), server).toContain(
      '1. Going live > Hosting\n   path: /guide/hosting#hosting',
    )
    // Keyword matches still work, and a nonsense query still finds nothing.
    expect(await search(server, 'pelicans'), server).toContain('path: /guide/setup#second-step')
    expect(await search(server, 'qqzzxx'), server).toContain('No results')
  }
})
