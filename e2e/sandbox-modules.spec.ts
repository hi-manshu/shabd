/**
 * What a live snippet may import, besides React: the modules a site names in
 * `features.sandbox.modules`. The fixture names a package and a file of its own.
 */
import type { Page } from '@playwright/test'
import { snippetEditor } from './support/editor.js'
import { BUILT, DEV, expect, open, test } from './support/fixtures.js'

const sandbox = (page: Page, title: string) => page.locator('.sb-sandbox', { has: page.locator('.sb-code-label', { hasText: title }) })

for (const [where, origin] of [
  ['a built site', BUILT],
  ['the dev server', DEV],
] as const) {
  test.describe(`modules for snippets, on ${where}`, () => {
    test('a snippet imports a package the site names, and a file of its own', async ({ page, problems }) => {
      await open(page, `${origin}/play/sandbox`)

      // A default export and a named one, of a package.
      await expect(sandbox(page, 'Package').locator('.sb-sandbox-stage output')).toHaveText('a-package twice twice-1', { timeout: 20_000 })
      // The same of a file, which is a component of the site's.
      const file = sandbox(page, 'File')
      await expect(file.locator('.sb-sandbox-stage [data-gauge]')).toHaveText('3 bar', { timeout: 20_000 })
      await expect(file.locator('.sb-sandbox-stage small')).toHaveText('in bar')
      await expect(page.locator('.sb-sandbox-problem')).toHaveCount(0)
      expect(problems).toEqual([])
    })

    test('a module is fetched when a reader writes its name into a snippet', async ({ page }) => {
      await open(page, `${origin}/play/sandbox`)
      const first = page.locator('.sb-sandbox').first()
      await expect(first.locator('.sb-sandbox-stage button')).toHaveText('Clicked 0 times', { timeout: 20_000 })

      await snippetEditor(first).fill("import Gauge from 'fixture/gauge'\n\nexport default () => <Gauge value={12} />")
      await expect(first.locator('.sb-sandbox-stage [data-gauge]')).toHaveText('12 bar')

      // A name the site has not given is refused, and the answer says which names there are.
      await snippetEditor(first).fill("import pad from 'left-pad'\n\nexport default () => <p>{pad('a', 3)}</p>")
      await expect(first.locator('.sb-sandbox-problem')).toHaveText(
        'Live snippets cannot import "left-pad". Available: react, shabd/client, @himanshoe/shabd/client, github-slugger, fixture/gauge.',
      )
      // What worked last is still shown.
      await expect(first.locator('.sb-sandbox-stage [data-gauge]')).toHaveText('12 bar')
    })
  })
}

test('the dev server shows a change to a file that snippets import', async ({ page, site }) => {
  await open(page, `${DEV}/play/sandbox`)
  const gauge = sandbox(page, 'File').locator('.sb-sandbox-stage [data-gauge]')
  await expect(gauge).toHaveText('3 bar', { timeout: 20_000 })

  await site.edit('components/Gauge.tsx', (text) => text.replace("'bar'", "'psi'"))
  await expect(gauge).toHaveText('3 psi', { timeout: 20_000 })
  await expect(sandbox(page, 'File').locator('.sb-sandbox-stage small')).toHaveText('in psi')
})

test('a page with no snippet on it fetches none of those modules', async ({ page }) => {
  const scripts: string[] = []
  page.on('response', async (response) => {
    if (!/\.js$/.test(new URL(response.url()).pathname)) return
    const body = await response.text().catch(() => '')
    // Not the script for the frames of isolated snippets, which has every such module in it and is
    // fetched for a page that shows one (sandbox-frame.spec.ts).
    if (body.includes('of-the-fixture') && !body.includes('what runs in the frame of an isolated snippet')) scripts.push(response.url())
  })

  await open(page, `${BUILT}/guide/intro`)
  await page.waitForLoadState('networkidle')
  expect(scripts).toEqual([])

  // The same watch does find it where a snippet imports it: the check above is not passing for nothing.
  await open(page, `${BUILT}/play/sandbox`)
  await expect(sandbox(page, 'File').locator('.sb-sandbox-stage [data-gauge]')).toHaveText('3 bar', { timeout: 20_000 })
  await expect.poll(() => scripts.length).toBe(1)
})
