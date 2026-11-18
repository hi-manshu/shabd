/**
 * Semantic search, with the real embedding model: running in the browser,
 * for a reader, and in the two servers, behind their MCP route.
 * It downloads about 22 MB from Hugging Face, so it only runs when asked:
 *
 *     SHABD_E2E_SEMANTIC=1 npx playwright test e2e/semantic.spec.ts
 *
 * Add SHABD_E2E_STORE=sqlite to run the reader's test against the SQLite store.
 */
import { BUILT, DEV, expect, open, test } from './support/fixtures.js'

test.skip(!process.env.SHABD_E2E_SEMANTIC, 'needs the fixture built with SHABD_E2E_SEMANTIC=1')

test('finds a section by meaning when it shares no word with the query', async ({ page }) => {
  test.setTimeout(180_000)
  await open(page, `${BUILT}/guide/intro`)
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
