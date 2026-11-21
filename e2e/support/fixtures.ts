import { test as base, expect, type Page } from '@playwright/test'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PORTS } from './ports.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))

/** `shabd dev` on a copy of the fixture that tests may edit. */
export const DEV = `http://localhost:${PORTS.dev}`
/** `shabd preview` of a production build of the fixture. */
export const BUILT = `http://localhost:${PORTS.preview}`

const DEV_ROOT = path.join(here, '..', '.work', 'dev')

/**
 * The dev server's file watcher reports a file as changed at most once in 50
 * milliseconds, and drops a second change inside that time. A person cannot
 * save twice that fast, but a test can, and then the server never sees the
 * second save. So two changes to one file are kept this far apart.
 */
const SAVE_GAP = 150
const lastChange = new Map<string, number>()

async function spaced(file: string, change: () => Promise<void>): Promise<void> {
  const wait = (lastChange.get(file) ?? 0) + SAVE_GAP - Date.now()
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  await change()
  lastChange.set(file, Date.now())
}

/**
 * The dev server's files. Everything a test changes is put back when the test
 * ends: each file returns to what it held when the test first touched it.
 */
export class SiteFiles {
  /** What each touched file held before the test; null for files the test created. */
  #originals = new Map<string, string | null>()

  path(file: string): string {
    return path.join(DEV_ROOT, file)
  }

  read(file: string): Promise<string> {
    return readFile(this.path(file), 'utf8')
  }

  /** Remember a file's current contents, so it is restored even if something other than this class changes it (the Studio). */
  async track(file: string): Promise<void> {
    if (this.#originals.has(file)) return
    this.#originals.set(file, existsSync(this.path(file)) ? await this.read(file) : null)
  }

  async write(file: string, contents: string): Promise<void> {
    await this.track(file)
    await mkdir(path.dirname(this.path(file)), { recursive: true })
    await spaced(this.path(file), () => writeFile(this.path(file), contents))
  }

  async edit(file: string, change: (text: string) => string): Promise<void> {
    const before = await this.read(file)
    const after = change(before)
    if (after === before) throw new Error(`edit of ${file} changed nothing`)
    await this.write(file, after)
  }

  async remove(file: string): Promise<void> {
    await this.track(file)
    await spaced(this.path(file), () => rm(this.path(file), { force: true }))
  }

  async restore(): Promise<void> {
    for (const [file, original] of this.#originals) {
      if (original === null) await spaced(this.path(file), () => rm(this.path(file), { force: true }))
      else await spaced(this.path(file), () => writeFile(this.path(file), original))
    }
    // Give the dev server a moment to take the restored files in before the next test.
    if (this.#originals.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, 400))
      await pagesSettled()
    }
    this.#originals.clear()
  }
}

/** The page files in a folder, as paths from it. What starts with `_` or `.` is not a page, as in the content store. */
async function pageFiles(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(folder, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .filter((file) => /\.mdx?$/i.test(file) && !file.split('/').some((part) => part.startsWith('_') || part.startsWith('.')))
    .sort()
}

/**
 * Wait until the dev server knows exactly the pages that are on disk.
 *
 * A test that makes a page leaves a file to be removed when it ends, and the
 * server hears of a removal a tenth of a second later at best, and later on
 * a busy machine. The next test would otherwise start on a site that still
 * has the page: in its navigation, and before or after other pages there.
 */
async function pagesSettled(): Promise<void> {
  const onDisk = JSON.stringify(await pageFiles(path.join(DEV_ROOT, 'content')))
  const deadline = Date.now() + 10_000
  let known = 'nothing'
  while (Date.now() < deadline) {
    try {
      // The module the site's own pages read their list of pages from.
      const module = await (await fetch(`${DEV}/@id/__x00__virtual:shabd/data`)).text()
      const data = JSON.parse(module.slice(module.indexOf('{'), module.lastIndexOf('}') + 1)) as { pagesInDev: Record<string, { id: string; generated?: boolean }> }
      // Pages made from an OpenAPI description have no file among the content: no test makes or removes one.
      const written = Object.values(data.pagesInDev).filter((page) => !page.generated)
      known = JSON.stringify(written.map((page) => page.id).sort())
      if (known === onDisk) return
    } catch {
      // The server is restarting, or the module is being made: ask again.
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`the dev server did not catch up with the files of the last test: it knows ${known}, and on disk are ${onDisk}`)
}

export const test = base.extend<{ site: SiteFiles; problems: string[] }>({
  site: async ({}, use) => {
    const site = new SiteFiles()
    await use(site)
    await site.restore()
  },

  // Every test fails on an uncaught exception in the page. Tests that also
  // want a clean console (hydration warnings arrive there) assert on `problems`.
  problems: [
    async ({ page }, use) => {
      const problems: string[] = []
      const crashes: string[] = []
      page.on('console', (message) => {
        if (message.type() === 'error' || message.type() === 'warning') problems.push(message.text())
      })
      page.on('pageerror', (error) => crashes.push(String(error)))
      await use(problems)
      expect(crashes, 'uncaught exceptions in the page').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }

/** Open a page and wait until the app is interactive (hydrated, or rendered in dev). */
export async function open(page: Page, url: string): Promise<void> {
  await page.goto(url)
  await expect(page.locator('html[data-shabd="ready"]')).toBeAttached({ timeout: 15_000 })
}

/** Leave a mark that a full page load would wipe out, to prove navigation and updates happen in place. */
export async function markPage(page: Page): Promise<() => Promise<boolean>> {
  await page.evaluate(() => {
    ;(window as unknown as { __mark: boolean }).__mark = true
  })
  return () => page.evaluate(() => (window as unknown as { __mark?: boolean }).__mark === true)
}

export const regions = (page: Page): Promise<string[]> =>
  page.locator('.sb-region').evaluateAll((elements) =>
    elements.map((element) => element.className.replace('sb-region sb-region-', '')),
  )
