/** `shabd dev` and a file that is saved twice in quick succession: the second save is not missed. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Node's own watcher is taken away, and Vite's is switched off below. What the dev server hears of a
// file is then exactly what a test tells it, which is how a save that goes unreported can be staged.
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  watch: () => {
    throw new Error('not watching in this test')
  },
}))

import { createContext, type ShabdContext } from '../src/node/context.js'
import { shabd } from '../src/node/vite/plugin.js'
import { SECOND_LOOK_MS, SecondLook } from '../src/node/vite/second-look.js'
import { WORK } from './helpers/build.js'

describe('a second look at a changed file', () => {
  beforeEach(() => void vi.useFakeTimers())
  afterEach(() => void vi.useRealTimers())

  /** A file that holds what the test last put in it, and a record of what was reported. */
  const watched = (text: string | undefined) => {
    const disk = { text, reads: 0 }
    const reported: string[] = []
    const look = new SecondLook({
      read: async () => {
        disk.reads++
        if (disk.text === undefined) throw Object.assign(new Error('gone'), { code: 'ENOENT' })
        return disk.text
      },
      report: (file) => reported.push(file),
    })
    return { disk, reported, look }
  }

  it('reports the file when it no longer holds what was read', async () => {
    const { disk, reported, look } = watched('first save')
    look.after('/site/page.md', 'first save')
    disk.text = 'second save'

    await vi.advanceTimersByTimeAsync(SECOND_LOOK_MS - 1)
    expect(reported).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(reported).toEqual(['/site/page.md'])
  })

  it('says nothing when the change that was handled was the last one', async () => {
    const { reported, look } = watched('only save')
    look.after('/site/page.md', 'only save')
    await vi.advanceTimersByTimeAsync(SECOND_LOOK_MS * 3)
    expect(reported).toEqual([])
  })

  it('looks once after a run of changes, and compares with the last of them', async () => {
    const { disk, reported, look } = watched('one')
    look.after('/site/page.md', 'one')
    await vi.advanceTimersByTimeAsync(SECOND_LOOK_MS / 2)
    disk.text = 'two'
    look.after('/site/page.md', 'two')
    // The first look was put off by the second change, and what it would have compared with is forgotten.
    await vi.advanceTimersByTimeAsync(SECOND_LOOK_MS)
    expect(reported).toEqual([])
    expect(disk.reads).toBe(1)
  })

  it('keeps each file to itself', async () => {
    const { disk, reported, look } = watched('same for both')
    look.after('/site/a.md', 'same for both')
    look.after('/site/b.md', 'older text')
    disk.text = 'same for both'
    await vi.advanceTimersByTimeAsync(SECOND_LOOK_MS)
    expect(reported).toEqual(['/site/b.md'])
  })

  it('leaves a file that has gone to the watcher, which reports removals itself', async () => {
    const { disk, reported, look } = watched('here')
    look.after('/site/page.md', 'here')
    disk.text = undefined
    await vi.advanceTimersByTimeAsync(SECOND_LOOK_MS)
    expect(reported).toEqual([])
  })

  it('does nothing once it is closed', async () => {
    const { disk, reported, look } = watched('first save')
    look.after('/site/page.md', 'first save')
    disk.text = 'second save'
    look.close()
    await vi.advanceTimersByTimeAsync(SECOND_LOOK_MS * 2)
    expect(reported).toEqual([])
  })
})

describe('the dev server', () => {
  let dir: string
  let server: ViteDevServer | undefined
  let context: ShabdContext

  const start = async (files: Record<string, string>) => {
    await mkdir(WORK, { recursive: true })
    dir = await mkdtemp(path.join(WORK, 'watch-'))
    for (const [name, contents] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(dir, name)), { recursive: true })
      await writeFile(path.join(dir, name), contents)
    }
    context = await createContext(dir, { dev: true })
    server = await createServer({
      configFile: false,
      root: dir,
      logLevel: 'silent',
      plugins: [shabd({ context })],
      // No watching: a change is what the test reports, and nothing else.
      server: { watch: null },
      optimizeDeps: { noDiscovery: true, include: [] },
    })
  }
  afterEach(async () => {
    await server?.close()
    server = undefined
    await rm(dir, { recursive: true, force: true })
  })
  afterAll(() => vi.restoreAllMocks())

  /** Save a file, and tell the server about it or not, as a watcher might. */
  const save = async (file: string, text: string, reported: boolean) => {
    await writeFile(path.join(dir, file), text)
    if (reported) server!.watcher.emit('change', path.join(dir, file))
  }
  const held = (file: string) => context.store.byFile(path.join(dir, file))?.source

  it('reads a page again after a change, and so finds a save that was never reported', async () => {
    await start({ 'shabd.config.yaml': 'site:\n  title: Docs\n', 'content/index.md': '# Home\n', 'content/page.md': '# Page\n\nAs it was.\n' })

    await save('content/page.md', '# Page\n\nThe first save.\n', true)
    await expect.poll(() => held('content/page.md')).toContain('The first save.')

    // The second save follows before the first has been looked at again, and no watcher speaks of it.
    await save('content/page.md', '# Page\n\nThe second save.\n', false)
    await expect.poll(() => held('content/page.md'), { timeout: 3000 }).toContain('The second save.')
  })

  it('does the same for the sidebar file', async () => {
    await start({
      'shabd.config.yaml': 'site:\n  title: Docs\n',
      'sidebar.yaml': '- category: Guide\n  items: [a]\n',
      'content/index.md': '# Home\n',
      'content/a.md': '# A\n',
      'content/b.md': '# B\n',
    })
    const labels = () => JSON.stringify(context.store.sidebar.sidebar)

    await save('sidebar.yaml', '- category: First\n  items: [a]\n', true)
    await expect.poll(labels).toContain('First')
    await save('sidebar.yaml', '- category: Second\n  items: [a, b]\n', false)
    await expect.poll(labels, { timeout: 3000 }).toContain('Second')
  })
})
