/**
 * One measurement of one site, in a process of its own, so that what one
 * measurement left in memory is not counted in the next.
 *
 *     node scripts/bench/measure.mjs <scan|build|check|dev|browse> <site folder>
 *
 * The last line it prints is `RESULT ` and what was measured, as JSON.
 * run.mjs starts it and reads that line.
 */
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { build, check, createContext, dev, preview } from '../../packages/shabd/dist/node/index.js'

const [what, folder] = process.argv.slice(2)
const dir = path.resolve(folder ?? '')
const round = (ms) => Math.round(ms)
const MB = 1024 * 1024

/** The most memory this process has held, in megabytes. Node reports kilobytes on every platform. */
const peakMemory = () => Math.round(process.resourceUsage().maxRSS / 1024)

async function timed(run) {
  const started = performance.now()
  const value = await run()
  return { ms: round(performance.now() - started), value }
}

/** Every file under a folder, with its size. */
async function files(root, at = '') {
  const found = []
  for (const entry of await readdir(path.join(root, at), { withFileTypes: true })) {
    const name = path.posix.join(at, entry.name)
    if (entry.isDirectory()) found.push(...(await files(root, name)))
    else found.push({ name, bytes: (await stat(path.join(root, name))).size })
  }
  return found
}

/** What a reader might type. The words are common ones in documentation, made up or real. */
const QUERIES = ['token', 'retry timeout', 'create', 'region', 'request header', 'error', 'default value']

const sum = (list) => list.reduce((total, file) => total + file.bytes, 0)
const median = (numbers) => [...numbers].sort((a, b) => a - b)[Math.floor(numbers.length / 2)]

/** A page of the site that is not the home page, as a route and as its file: the first one, by name. */
async function somePage() {
  const context = await createContext(dir, { dev: false })
  const pages = context.store.pages().filter((page) => page.path !== '/' && !page.path.endsWith('/index'))
  const page = pages.sort((a, b) => a.path.localeCompare(b.path))[Math.floor(pages.length / 2)]
  return { route: page.path, file: page.file, other: pages[Math.floor(pages.length / 3)].path, count: context.store.pages().length }
}

const MEASUREMENTS = {
  /** Reading the site: the config, the sidebar, and the frontmatter of every page. Both commands start with it. */
  async scan() {
    const { ms, value: context } = await timed(() => createContext(dir, { dev: false }))
    return { ms, pages: context.store.pages().length, memoryMB: peakMemory() }
  },

  async build() {
    const { ms } = await timed(() => build(dir))
    const written = await files(path.join(dir, 'dist'))
    const html = written.filter((file) => file.name.endsWith('.html'))
    const index = written.find((file) => file.name === '_shabd/search-index.json')
    const largest = html.reduce((most, file) => (file.bytes > most.bytes ? file : most), html[0])
    return {
      ms,
      memoryMB: peakMemory(),
      files: written.length,
      distMB: +(sum(written) / MB).toFixed(1),
      htmlMB: +(sum(html) / MB).toFixed(1),
      htmlMedianKB: Math.round(median(html.map((file) => file.bytes)) / 1024),
      htmlLargestKB: Math.round(largest.bytes / 1024),
      scriptMB: +(sum(written.filter((file) => /\.(js|css)$/.test(file.name))) / MB).toFixed(1),
      indexMB: index ? +(index.bytes / MB).toFixed(2) : null,
      indexGzipMB: index ? +(gzipSync(await readFile(path.join(dir, 'dist', index.name))).length / MB).toFixed(2) : null,
      sections: index ? sectionsIn(JSON.parse(await readFile(path.join(dir, 'dist', index.name), 'utf8'))) : null,
    }
  },

  async check() {
    const log = console.log
    // The report is not what is measured, and on a made-up site it is long.
    console.log = () => {}
    const { ms, value: clean } = await timed(() => check(dir))
    console.log = log
    return { ms, clean, memoryMB: peakMemory() }
  },

  /** `shabd dev`, as a writer meets it: until the first page is on screen, then a page not seen before, then edits. */
  async dev() {
    const { chromium } = await import('@playwright/test')
    const { route, file, other } = await somePage()
    const started = performance.now()
    const server = await dev(dir, { port: 0 })
    const listening = round(performance.now() - started)
    const origin = server.resolvedUrls.local[0].replace(/\/$/, '')

    const browser = await chromium.launch()
    const page = await browser.newPage()
    const open = async (to) => {
      const { ms } = await timed(async () => {
        await page.goto(`${origin}${to}`)
        await page.waitForSelector('html[data-shabd="ready"]', { state: 'attached', timeout: 300_000 })
      })
      return ms
    }
    // The first page waits for Vite to prepare React and the rest, once for the site.
    const first = await open(route)
    const second = await open(other)
    const again = await open(route)

    // An edit, from the save to the words being on the page.
    const original = await readFile(file, 'utf8')
    const edits = []
    try {
      for (let turn = 1; turn <= 7; turn++) {
        const words = `Measured edit number ${turn}.`
        const { ms } = await timed(async () => {
          await writeFile(file, `${original}\n${words}\n`)
          await page.getByText(words).waitFor({ timeout: 120_000 })
        })
        edits.push(ms)
        // The watcher drops a second change that follows the first too closely.
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
    } finally {
      await writeFile(file, original)
    }
    await browser.close()
    await server.close()
    return { listeningMs: listening, firstPageMs: first, newPageMs: second, seenPageMs: again, editMs: median(edits.slice(1)), firstEditMs: edits[0], memoryMB: peakMemory() }
  },

  /** The built site, as a reader meets it: a page, then a search. */
  async browse() {
    const { chromium } = await import('@playwright/test')
    const { route } = await somePage()
    const server = await preview(dir, { port: 0 })
    const origin = server.resolvedUrls.local[0].replace(/\/$/, '')
    const browser = await chromium.launch()
    const page = await browser.newPage()

    const { ms: ready } = await timed(async () => {
      await page.goto(`${origin}${route}`)
      await page.waitForSelector('html[data-shabd="ready"]', { state: 'attached', timeout: 120_000 })
    })

    // The index is fetched when search is first opened. The first answer waits for it.
    const dialog = page.locator('dialog.sb-search')
    const input = dialog.getByRole('combobox')
    const answered = dialog.locator('.sb-search-hit, .sb-search-empty').first()
    const { ms: firstAnswer } = await timed(async () => {
      await page.keyboard.press('/')
      await input.fill(QUERIES[0])
      await answered.waitFor({ timeout: 300_000 })
    })
    // After that, each query is answered from what the page holds.
    const queries = []
    for (const words of QUERIES.slice(1)) {
      // Emptied first: the answers to the query before stay on screen until the next ones arrive.
      await input.fill('')
      await answered.waitFor({ state: 'detached' })
      const { ms } = await timed(async () => {
        await input.fill(words)
        await answered.waitFor({ timeout: 60_000 })
      })
      queries.push(ms)
    }
    await browser.close()
    await server.close()
    return { pageReadyMs: ready, firstAnswerMs: firstAnswer, queryMs: median(queries), slowestQueryMs: Math.max(...queries) }
  },
}

/** How many sections the index holds, whatever shape it has. */
function sectionsIn(index) {
  if (Array.isArray(index)) return index.length
  for (const key of ['sections', 'documents', 'docs', 'entries']) if (Array.isArray(index[key])) return index[key].length
  return null
}

if (!MEASUREMENTS[what] || !folder) {
  console.error(`Usage: node scripts/bench/measure.mjs <${Object.keys(MEASUREMENTS).join('|')}> <site folder>`)
  process.exit(1)
}
const result = await MEASUREMENTS[what]()
console.log(`RESULT ${JSON.stringify(result)}`)
// The dev server and the browser can leave handles open; the measuring is done.
process.exit(0)
