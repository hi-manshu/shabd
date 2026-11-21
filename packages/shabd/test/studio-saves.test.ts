/**
 * Saves that reach the dev server from editors that share a draft
 * (src/client/studio/draft.ts). Each of them saves the text it holds, so
 * saves of one file arrive together, and from editors that last saw the
 * file at different moments.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { createServer, type ViteDevServer } from 'vite'
import { afterEach, describe, expect, it } from 'vitest'
import { createContext } from '../src/node/context.js'
import { shabd } from '../src/node/vite/plugin.js'
import { KEYWORD_SEARCH, WORK } from './helpers/build.js'

describe('saves from editors that share a draft', () => {
  let dir: string
  let server: ViteDevServer | undefined
  let origin: string
  let token: string

  const start = async () => {
    await mkdir(WORK, { recursive: true })
    dir = await mkdtemp(path.join(WORK, 'studio-saves-'))
    const files = { 'shabd.config.yaml': `site:\n  title: Docs\n${KEYWORD_SEARCH}`, 'content/index.md': '# Home\n', 'content/guide.md': 'As it was.\n' }
    for (const [name, contents] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(dir, name)), { recursive: true })
      await writeFile(path.join(dir, name), contents)
    }
    const context = await createContext(dir, { dev: true })
    server = await createServer({
      configFile: false,
      root: dir,
      logLevel: 'silent',
      plugins: [shabd({ context })],
      server: { watch: null, host: '127.0.0.1', port: 0 },
      optimizeDeps: { noDiscovery: true, include: [] },
    })
    await server.listen()
    origin = `http://127.0.0.1:${(server.httpServer!.address() as AddressInfo).port}`
    token = ((await (await fetch(`${origin}/_shabd/studio/session`)).json()) as { token: string }).token
  }
  afterEach(async () => {
    await server?.close()
    server = undefined
    await rm(dir, { recursive: true, force: true })
  })

  const onDisk = () => readFile(path.join(dir, 'content/guide.md'), 'utf8')
  const read = async () =>
    (await (await fetch(`${origin}/_shabd/studio/source?id=guide.md`, { headers: { 'x-shabd-studio': token } })).json()) as { source: string; hash: string; draft?: string }
  const save = async (source: string, baseHash: string, draft?: string) => {
    const response = await fetch(`${origin}/_shabd/studio/source`, {
      method: 'PUT',
      headers: { 'x-shabd-studio': token },
      body: JSON.stringify({ id: 'guide.md', source, baseHash, ...(draft ? { draft } : {}) }),
    })
    return { status: response.status, ...((await response.json()) as { hash?: string; source?: string }) }
  }

  it('do not take one another for a change from outside, and anything else is still one', async () => {
    await start()
    const opened = await read()
    expect(opened.draft).toBeUndefined()

    // Two editors of one draft, which both last saw the file as it was opened.
    const first = await save('The first editor saved.\n', opened.hash, 'draft-one')
    expect(first.status).toBe(200)
    const second = await save('The first editor saved, and the second.\n', opened.hash, 'draft-one')
    expect(second.status).toBe(200)
    expect(await onDisk()).toBe('The first editor saved, and the second.\n')
    // An editor that reads the file again is told the draft it was saved from.
    expect((await read()).draft).toBe('draft-one')

    // The same text again is nothing to write, whoever sends it.
    expect((await save('The first editor saved, and the second.\n', opened.hash, 'draft-one')).hash).toBe(second.hash)

    // An editor of another draft, or of none, last saw another file: that is a conflict, and it is told what is there.
    const other = await save('From another draft.\n', opened.hash, 'draft-two')
    expect(other).toMatchObject({ status: 409, source: 'The first editor saved, and the second.\n', hash: second.hash })
    expect((await save('From no draft.\n', opened.hash)).status).toBe(409)
    expect(await onDisk()).toBe('The first editor saved, and the second.\n')

    // So is a change from outside, for the editors of the draft too.
    await writeFile(path.join(dir, 'content/guide.md'), 'Changed in another program.\n')
    expect((await read()).draft).toBeUndefined()
    expect((await save('The draft, a moment on.\n', second.hash!, 'draft-one')).status).toBe(409)
    expect(await onDisk()).toBe('Changed in another program.\n')

    // So is a file that another program set back to a text the draft once had: a checkout, an undo elsewhere.
    // The editors of the draft are not told that it is theirs, and do not write over it without having seen it.
    const again = await read()
    expect((await save('What the draft holds.\n', again.hash, 'draft-one')).status).toBe(200)
    expect((await save('What the draft holds, a moment on.\n', again.hash, 'draft-one')).status).toBe(200)
    await writeFile(path.join(dir, 'content/guide.md'), 'What the draft holds.\n')
    expect((await read()).draft).toBeUndefined()
    expect((await save('What the draft holds, two moments on.\n', again.hash, 'draft-one')).status).toBe(409)
    expect(await onDisk()).toBe('What the draft holds.\n')

    // An editor that has seen the change may write over it, and the draft it writes from is the page's from then on.
    const seen = await read()
    expect((await save('From another draft.\n', seen.hash, 'draft-two')).status).toBe(200)
    expect((await read()).draft).toBe('draft-two')
    expect((await save('The first draft, late.\n', second.hash!, 'draft-one')).status).toBe(409)
  })

  it('take their turn: none reads the file while another is half way through writing it', async () => {
    await start()
    const opened = await read()
    // Long enough that writing one takes a while, and all sent at once, by editors that last saw the file as it was opened.
    // One long word each: a page of that many lines would take the dev server longer to compile than to write.
    const texts = Array.from({ length: 16 }, (_, index) => `${String(index).padStart(2, '0')}${'a'.repeat(600_000)}\n`)
    const results = await Promise.all(texts.map((text) => save(text, opened.hash, 'draft-one')))
    expect(results.map((result) => result.status)).toEqual(texts.map(() => 200))
    // What is on disk is one of them, whole.
    expect(texts).toContain(await onDisk())
    // And a read in the middle of a save is not of half a file either.
    const [, during] = await Promise.all([save(texts[0]!, opened.hash, 'draft-one'), read()])
    expect(texts).toContain(during.source)
  })
})
