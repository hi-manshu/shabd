/**
 * A page saved twice in quick succession while `shabd dev` runs.
 *
 * Vite's watcher reports a file once in 50 milliseconds. Where no faster
 * watcher is to be had the second save went unreported, and the page stayed
 * one save behind. The dev server now reads a changed file once more, a
 * moment later.
 */
import { writeFile } from 'node:fs/promises'
import { DEV, expect, markPage, open, test } from './support/fixtures.js'

const FILE = 'content/guide/setup.md'

for (const gap of [5, 30]) {
  test(`two saves ${gap} ms apart: the page shows the second`, async ({ page, site }) => {
    await open(page, `${DEV}/guide/setup`)
    const stayed = await markPage(page)
    const original = await site.read(FILE)
    // The fixture puts the file back when the test ends.
    await site.track(FILE)

    // Written directly: the fixture's own `write` keeps two saves of one file apart, and here they must be close.
    await writeFile(site.path(FILE), original.replace('Install the thing.', `Saved once, ${gap}.`))
    await new Promise((resolve) => setTimeout(resolve, gap))
    await writeFile(site.path(FILE), original.replace('Install the thing.', `Saved twice, ${gap}.`))

    await expect(page.locator('.sb-content')).toContainText(`Saved twice, ${gap}.`)
    // In place, as any edit arrives.
    expect(await stayed()).toBe(true)
  })
}
