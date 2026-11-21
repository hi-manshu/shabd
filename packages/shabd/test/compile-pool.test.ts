/**
 * Pages compiled on more than one core (src/node/markdown/compile-pool.ts).
 *
 * The threads that compile are started from a file of this package's build,
 * so these tests use the build: `npm run build` makes it. Run without one, or
 * with one older than the source, they are skipped and say why. The first
 * test needs no build: it is what happens when there is none.
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { createContext } from '../src/node/context.js'
import { warmCompileCache } from '../src/node/markdown/compile-pool.js'
import { WORK } from './helpers/build.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const BUILT = path.join(here, '..', 'dist', 'node')
const SOURCE = path.join(here, '..', 'src', 'node')

/**
 * Is the build there, and no older than the source it was built from? Every file of the source counts:
 * the workers run the whole of the node side, and a build runs the browser's source through it.
 */
const newest = (folder: string): number =>
  Math.max(0, ...readdirSync(folder, { recursive: true, withFileTypes: true }).flatMap((entry) => (entry.isFile() && /\.tsx?$/.test(entry.name) ? [statSync(path.join(entry.parentPath, entry.name)).mtimeMs] : [])))
const worker = path.join(BUILT, 'markdown', 'compile-worker.js')
const built = existsSync(worker) && statSync(worker).mtimeMs >= Math.max(newest(SOURCE), newest(path.join(SOURCE, '..', 'shared')))
if (!built) console.warn('compile-pool.test.ts: the build of this package is missing or older than its source, so the tests of the worker threads are skipped. Run `npm run build`.')

type Context = Awaited<ReturnType<typeof createContext>>
/** The package as it is built: the same functions as the source's, with a worker beside them. */
const fromBuild = async () => {
  const load = (file: string) => import(/* @vite-ignore */ pathToFileURL(path.join(BUILT, file)).href) as Promise<Record<string, unknown>>
  const context = await load('context.js')
  const pool = await load('markdown/compile-pool.js')
  const build = await load('build/build.js')
  return {
    createContext: context.createContext as typeof createContext,
    compilePage: context.compilePage as (context: Context, page: Context['store'] extends { pages(): readonly (infer Page)[] } ? Page : never) => Promise<{ code: string; cached: boolean }>,
    warmCompileCache: pool.warmCompileCache as typeof warmCompileCache,
    build: build.build as (root: string, options?: { semantic?: boolean }) => Promise<void>,
  }
}

const dirs: string[] = []
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))))

/** A site of `count` pages, each a little different, in a folder of its own. */
async function site(count: number, extra: Record<string, string> = {}): Promise<string> {
  await mkdir(WORK, { recursive: true })
  const dir = await mkdtemp(path.join(WORK, 'pool-'))
  dirs.push(dir)
  const files: Record<string, string> = { 'shabd.config.yaml': 'site:\n  title: Docs\nfeatures:\n  search: { semantic: false }\n', ...extra }
  for (let page = 0; page < count; page++) {
    files[`content/guide/page-${page}.md`] = `---\ntitle: Page ${page}\n---\n\nThe text of page ${page}, with a [link](./page-${(page + 1) % count}.md).\n\n\`\`\`ts\nexport const page = ${page}\n\`\`\`\n`
  }
  for (const [name, contents] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true })
    await writeFile(path.join(dir, name), contents)
  }
  return dir
}

describe('compiling pages side by side', () => {
  it('is left alone where there is no worker to start, and the pages compile as they are asked for', async () => {
    // This file runs the source, which has no built worker beside it.
    const context = await createContext(await site(12), { dev: false })
    expect(await warmCompileCache(context, context.store.pages(), { worthIt: 1 })).toBeUndefined()
  })

  it.skipIf(!built)('compiles what is not in the cache on several threads, and each page is what one thread makes of it', async () => {
    const { createContext, compilePage, warmCompileCache } = await fromBuild()
    const dir = await site(40)
    const context = await createContext(dir, { dev: false })
    const pages = context.store.pages()

    const warmed = await warmCompileCache(context, pages, { worthIt: 10 })
    expect(warmed?.pages).toBe(40)
    expect(warmed?.workers).toBeGreaterThanOrEqual(2)

    // Every page is found compiled, by the thread that asks.
    const together = await Promise.all(pages.map((page) => compilePage(context, page)))
    expect(together.map((page) => page.cached)).toEqual(pages.map(() => true))

    // The same site in another folder, compiled one page at a time: the same code, but for where the files are.
    const other = await site(40)
    const alone = await createContext(other, { dev: false })
    const apart = await Promise.all(alone.store.pages().map((page) => compilePage(alone, page)))
    expect(apart.map((page) => page.cached)).toEqual(pages.map(() => false))
    expect(together.map((page) => page.code.replaceAll(dir, ''))).toEqual(apart.map((page) => page.code.replaceAll(other, '')))

    // Asked again, there is nothing left to hand out.
    expect(await warmCompileCache(context, pages, { worthIt: 10 })).toBeUndefined()
  })

  it.skipIf(!built)('leaves a page that does not compile to whoever asks for it, who is told why', async () => {
    const { createContext, compilePage, warmCompileCache } = await fromBuild()
    const dir = await site(30, { 'content/guide/broken.mdx': '# Broken\n\n<Unclosed>\n' })
    const context = await createContext(dir, { dev: false })
    const pages = context.store.pages()
    expect((await warmCompileCache(context, pages, { worthIt: 10 }))?.pages).toBe(31)

    const broken = pages.find((page) => page.id === 'guide/broken.mdx')!
    await expect(compilePage(context, broken)).rejects.toThrow(/Unclosed/)
    const rest = await Promise.all(pages.filter((page) => page !== broken).map((page) => compilePage(context, page)))
    expect(rest.every((page) => page.cached)).toBe(true)
  })

  it.skipIf(!built)('is how a build of a few hundred pages compiles them, and the pages come out the same', async () => {
    const { build } = await fromBuild()
    const dir = await site(220)
    const printed: string[] = []
    const log = vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
      printed.push(parts.join(' '))
    })
    try {
      await build(dir, { semantic: false })
    } finally {
      log.mockRestore()
    }
    // eslint-disable-next-line no-control-regex
    const output = printed.join('\n').replace(/\u001b\[[0-9;]*m/g, '')
    expect(output).toMatch(/220 pages compiled, 220 of them on \d+ cores/)
    const html = await readFile(path.join(dir, 'dist', 'guide', 'page-7', 'index.html'), 'utf8')
    expect(html).toContain('The text of page 7')
    expect(html).toContain('href="/guide/page-8"')

    // A second build finds every page in the cache, and starts no thread for them.
    printed.length = 0
    const again = vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
      printed.push(parts.join(' '))
    })
    try {
      await build(dir, { semantic: false })
    } finally {
      again.mockRestore()
    }
    // eslint-disable-next-line no-control-regex
    expect(printed.join('\n').replace(/\u001b\[[0-9;]*m/g, '')).toMatch(/220 pages compiled\n/)
  }, 120_000)
})
