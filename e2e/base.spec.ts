/**
 * `shabd dev` for a site that is not at the root of its host.
 *
 * Every other spec runs on a site at `/`. Two faults lived in that gap. A
 * site with a `site.base` showed an empty page in dev, because the address of
 * the script that starts the app was written with the base twice. And the
 * Studio, after it had made or moved a page, went to that page's address
 * without the base, which is outside the site.
 *
 * This spec has a dev server of its own, on a copy of the fixture with
 * `site.base: /docs/` (e2e/support/serve-base.mjs).
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, markPage, open, test } from './support/fixtures.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(here, '.work', 'base')
const file = (name: string) => path.join(ROOT, name)

let server: ChildProcess | undefined
/** The site: its origin and its base, without the slash at the end. */
let site = ''

test.beforeAll(async () => {
  const started = spawn(process.execPath, [path.join(here, 'support', 'serve-base.mjs')], { stdio: ['ignore', 'pipe', 'pipe'] })
  server = started
  const port = await new Promise<string>((resolve, reject) => {
    let said = ''
    const giveUp = setTimeout(() => reject(new Error(`The dev server did not start in a minute. It said:\n${said}`)), 60_000)
    const hear = (chunk: Buffer) => {
      said += String(chunk)
      const ready = /ready on :(\d+)/.exec(said)
      if (!ready) return
      clearTimeout(giveUp)
      resolve(ready[1]!)
    }
    started.stdout!.on('data', hear)
    started.stderr!.on('data', hear)
    started.once('exit', (code) => {
      clearTimeout(giveUp)
      reject(new Error(`The dev server stopped with code ${code}. It said:\n${said}`))
    })
  })
  site = `http://localhost:${port}/docs`
})

test.afterAll(() => {
  server?.kill()
})

test.describe('a site under a base path, in dev', () => {
  test('opens, and moves between its pages without leaving the base', async ({ page, problems }) => {
    const missing: string[] = []
    page.on('response', (response) => {
      if (response.status() >= 400) missing.push(`${response.status()} ${new URL(response.url()).pathname}`)
    })

    await open(page, `${site}/guide/intro`)
    await expect(page.locator('h1.sb-page-title')).toHaveText('Introduction')
    const stillThere = await markPage(page)

    await page.locator('.sb-region-sidebar').getByRole('link', { name: 'Setting up' }).click()
    await expect(page).toHaveURL(`${site}/guide/setup`)
    await expect(page.locator('h1.sb-page-title')).toHaveText('Setting up')
    expect(await stillThere()).toBe(true)

    // Everything the pages asked for was there, under the base.
    expect(missing).toEqual([])
    expect(problems).toEqual([])
  })

  test('a page follows its file when the file is saved', async ({ page }) => {
    const source = file('content/guide/setup.md')
    const before = await readFile(source, 'utf8')
    try {
      await open(page, `${site}/guide/setup`)
      const stillThere = await markPage(page)
      await writeFile(source, before.replace('Install the thing.', 'Install it under a base.'))
      await expect(page.locator('.sb-content')).toContainText('Install it under a base.')
      expect(await stillThere()).toBe(true)
    } finally {
      await writeFile(source, before)
    }
  })

  test('the Studio makes, moves and deletes a page, and stays inside the site', async ({ page }) => {
    await open(page, `${site}/guide/setup`)
    await page.getByRole('button', { name: 'Edit page' }).click()
    // This server has just started: the editor's code is compiled when it is first asked for.
    await expect(page.getByRole('textbox', { name: /^Markdown source of / })).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.sb-studio-file strong')).toHaveText('content/guide/setup.md')
    const stillThere = await markPage(page)

    await page.getByRole('button', { name: 'New page' }).click()
    await page.getByLabel('File for the new page, in content/').fill('guide/notes')
    await page.getByRole('button', { name: 'Create page' }).click()
    await expect(page).toHaveURL(`${site}/guide/notes`)
    await expect(page.locator('.sb-studio-file strong')).toHaveText('content/guide/notes.md')
    expect(existsSync(file('content/guide/notes.md'))).toBe(true)

    await page.getByRole('button', { name: 'Rename', exact: true }).click()
    await page.getByLabel('New name for guide/notes.md, in content/').fill('guide/field-notes')
    await page.getByRole('button', { name: 'Rename page' }).click()
    await expect(page).toHaveURL(`${site}/guide/field-notes`)
    await expect(page.locator('.sb-studio-file strong')).toHaveText('content/guide/field-notes.md')
    expect(existsSync(file('content/guide/notes.md'))).toBe(false)
    expect(existsSync(file('content/guide/field-notes.md'))).toBe(true)

    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await page.getByRole('button', { name: 'Delete page' }).click()
    await expect(page.locator('.sb-studio-outcome')).toContainText('Deleted content/guide/field-notes.md.')
    expect(existsSync(file('content/guide/field-notes.md'))).toBe(false)
    // It goes on to another page of the site, which is under the base like every other.
    expect(page.url().startsWith(`${site}/`) || page.url() === site).toBe(true)
    await expect(page).not.toHaveTitle(/Page not found/)
    await expect(page.locator('.sb-studio-file strong')).toHaveText(/^content\//)
    // All of it happened in the page that was opened: nothing sent the browser to an address outside the site.
    expect(await stillThere()).toBe(true)
  })
})
