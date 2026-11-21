import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { mkdir, readdir, readFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { resolveConfig } from '../src/node/config/load.js'
import { addRedirect, planRedirect } from '../src/node/config/redirect-edit.js'
import { createPage, deletePage, movePage, saveImage } from '../src/node/vite/studio-files.js'
import { IMAGE_BYTES_LIMIT, imageFileName, sniffImage } from '../src/shared/image-file.js'
import { pagePathProblem, pageRoute } from '../src/shared/page-path.js'
import { temporarySites } from './helpers/site.js'

/** Every way of naming a file that is not a page inside the content folder. None may be accepted anywhere. */
const BAD_PATHS: [what: string, path: unknown][] = [
  ['goes up a folder', '../outside.md'],
  ['goes up two', '../../outside.md'],
  ['goes up from inside', 'guide/../../outside.md'],
  ['goes up and comes back', 'guide/../guide/page.md'],
  ['starts at the root of the disk', '/tmp/outside.md'],
  ['starts at a Windows drive', 'C:\\outside.md'],
  ['is relative to a Windows drive', 'C:outside.md'],
  ['goes up with backslashes', '..\\outside.md'],
  ['hides a way up behind backslashes', 'guide\\..\\..\\outside.md'],
  ['names the folder it is in', './page.md'],
  ['has a part that stays put', 'guide/./page.md'],
  ['has an empty part', 'guide//page.md'],
  ['ends in a slash', 'guide/page.md/'],
  ['is a folder', 'guide/'],
  ['has no extension', 'guide/page'],
  ['is not Markdown', 'guide/page.txt'],
  ['only looks like Markdown', 'guide/page.md.txt'],
  ['is a script', 'guide/page.mdx.js'],
  ['is a partial', '_partial.md'],
  ['is a partial in a folder', 'guide/_partial.md'],
  ['is in a folder of partials', '_drafts/page.md'],
  ['is hidden', '.hidden.md'],
  ['is in a hidden folder', 'guide/.hidden/page.md'],
  ['is in the repository\'s own folder', '.git/page.md'],
  ['is nothing but an extension', 'guide/.md'],
  ['holds a null', 'page\u0000.md'],
  ['holds a line break', 'page\n.md'],
  ['holds a character Windows refuses', 'what?.md'],
  ['holds a colon', 'a:b.md'],
  ['starts with a space', ' page.md'],
  ['ends with a space', 'page.md '],
  ['has a folder that ends with a space', 'guide /page.md'],
  ['has a folder that ends with a full stop', 'guide./page.md'],
  ['is empty', ''],
  ['is only spaces', '   '],
  ['is too long', `${'a'.repeat(600)}.md`],
  ['is a number', 42],
  ['is null', null],
  ['is missing', undefined],
  ['is a list', ['page.md']],
  ['is an object that prints as a path', { toString: () => 'page.md' }],
]

describe('the path of a new page', () => {
  it('accepts a Markdown file in the content folder or in folders under it', () => {
    const good = ['page.md', 'page.mdx', 'guide/page.md', 'guide/deep/er/page.mdx', 'guide/index.md', 'v1.2/notes.md', 'PAGE.MD']
    for (const path of [...good, 'Guide/Getting Started.md', 'गाइड/परिचय.md']) expect(pagePathProblem(path), path).toBeUndefined()
  })

  it.each(BAD_PATHS)('refuses one that %s', (_what, bad) => {
    expect(pagePathProblem(bad)).toEqual(expect.any(String))
  })

  it('says what is wrong in words for the person who typed it', () => {
    expect(pagePathProblem('../outside.md')).toBe('A path cannot contain "." or "..". Name the folder the page is in.')
    expect(pagePathProblem('guide/_partial.md')).toBe('"_partial.md" starts with "_", and a file or folder that does is not a page.')
    expect(pagePathProblem('guide/page.txt')).toBe('A page is a file whose name ends in .md or .mdx.')
    expect(pagePathProblem('guide\\page.md')).toBe('Write folders with a forward slash, as in guide/new-page.md.')
  })

  it('works out the address a file will have, as the content store does', () => {
    expect(pageRoute('guide/Getting Started.md')).toBe('/guide/getting-started')
    expect(pageRoute('guide/index.mdx')).toBe('/guide')
    expect(pageRoute('index.md')).toBe('/')
  })
})

/** Can this machine link one folder to another? Not every account on Windows may. */
const canLink = (() => {
  const folder = mkdtempSync(path.join(tmpdir(), 'shabd-link-'))
  try {
    symlinkSync(folder, path.join(folder, 'link'), 'junction')
    return true
  } catch {
    return false
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})()

describe('files the Studio makes, moves and deletes', () => {
  const site = temporarySites()
  /** Every file under a folder, as paths from it with forward slashes. */
  const filesIn = async (folder: string) =>
    (await readdir(folder, { recursive: true, withFileTypes: true }))
      .filter((entry) => !entry.isDirectory())
      .map((entry) => path.relative(folder, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
      .sort()
  const refusal = (status: number) => expect.objectContaining({ status })

  it('makes a page, and the folders on the way to it', async () => {
    const root = await site({ 'content/index.md': '# Home\n' })
    const content = path.join(root, 'content')

    expect(await createPage(content, 'guide/deep/new.md', '# New\n')).toBe(path.join(content, 'guide', 'deep', 'new.md'))
    expect(await readFile(path.join(content, 'guide', 'deep', 'new.md'), 'utf8')).toBe('# New\n')
    expect(await filesIn(root)).toEqual(['content/guide/deep/new.md', 'content/index.md'])
  })

  it('never writes over a file that is there', async () => {
    const root = await site({ 'content/index.md': '# Home\n', 'content/guide/page.md': 'kept\n' })
    const content = path.join(root, 'content')

    await expect(createPage(content, 'guide/page.md', 'lost')).rejects.toEqual(refusal(409))
    await expect(createPage(content, 'index.md', 'lost')).rejects.toEqual(refusal(409))
    expect(await readFile(path.join(content, 'guide', 'page.md'), 'utf8')).toBe('kept\n')
    expect(await readFile(path.join(content, 'index.md'), 'utf8')).toBe('# Home\n')

    // A folder has the name, or a file stands where a folder would have to be.
    await mkdir(path.join(content, 'folder.md'))
    await expect(createPage(content, 'folder.md', 'lost')).rejects.toThrow()
    await expect(createPage(content, 'guide/page.md/inside.md', 'lost')).rejects.toEqual(refusal(400))
    expect(await filesIn(root)).toEqual(['content/guide/page.md', 'content/index.md'])
  })

  it.each(BAD_PATHS)('makes nothing for a path that %s', async (_what, bad) => {
    const root = await site({ 'content/index.md': '# Home\n', 'content/guide/page.md': 'kept\n', 'outside.md': 'kept\n' })
    const content = path.join(root, 'content')
    const before = await filesIn(root)

    await expect(createPage(content, bad, 'made')).rejects.toEqual(refusal(400))
    await expect(movePage(content, path.join(content, 'guide', 'page.md'), bad)).rejects.toEqual(refusal(400))
    expect(await filesIn(root)).toEqual(before)
    expect(await readFile(path.join(root, 'outside.md'), 'utf8')).toBe('kept\n')
    expect(await readFile(path.join(content, 'guide', 'page.md'), 'utf8')).toBe('kept\n')
  })

  it('takes an absolute path to a file inside the content folder for what it is: not a name in it', async () => {
    const root = await site({ 'content/index.md': '# Home\n' })
    const content = path.join(root, 'content')
    await expect(createPage(content, path.join(content, 'page.md'), 'made')).rejects.toEqual(refusal(400))
    expect(await filesIn(root)).toEqual(['content/index.md'])
  })

  it.runIf(canLink)('does not follow a link out of the content folder', async () => {
    const root = await site({ 'content/index.md': '# Home\n', 'content/guide/page.md': 'kept\n', 'elsewhere/kept.md': 'kept\n' })
    const content = path.join(root, 'content')
    const elsewhere = path.join(root, 'elsewhere')

    // A folder in the content folder that is a link to one outside it.
    await symlink(elsewhere, path.join(content, 'linked'), 'junction')
    await expect(createPage(content, 'linked/new.md', 'made')).rejects.toEqual(refusal(400))
    await expect(createPage(content, 'linked/deeper/new.md', 'made')).rejects.toEqual(refusal(400))
    await expect(movePage(content, path.join(content, 'guide', 'page.md'), 'linked/moved.md')).rejects.toEqual(refusal(400))
    expect(await filesIn(elsewhere)).toEqual(['kept.md'])
    expect(existsSync(path.join(content, 'guide', 'page.md'))).toBe(true)

    // A link to a folder that is inside the content folder is only another way into it.
    await symlink(path.join(content, 'guide'), path.join(content, 'also-guide'), 'junction')
    await createPage(content, 'also-guide/new.md', 'made')
    expect(await readFile(path.join(content, 'guide', 'new.md'), 'utf8')).toBe('made')
  })

  it.runIf(canLink && process.platform !== 'win32')('does not write through a link that has the new file\'s name', async () => {
    const root = await site({ 'content/index.md': '# Home\n', 'content/guide/page.md': 'kept\n', 'elsewhere/kept.md': 'kept\n' })
    const content = path.join(root, 'content')
    const elsewhere = path.join(root, 'elsewhere')

    // One that leads to a file outside, and one that leads to where a file outside could be made.
    await symlink(path.join(elsewhere, 'kept.md'), path.join(content, 'to-a-file.md'))
    await symlink(path.join(elsewhere, 'not-there.md'), path.join(content, 'to-nothing.md'))
    for (const trap of ['to-a-file.md', 'to-nothing.md']) {
      await expect(createPage(content, trap, 'made')).rejects.toEqual(refusal(409))
      await expect(movePage(content, path.join(content, 'guide', 'page.md'), trap)).rejects.toEqual(refusal(409))
    }
    expect(await filesIn(elsewhere)).toEqual(['kept.md'])
    expect(await readFile(path.join(elsewhere, 'kept.md'), 'utf8')).toBe('kept\n')
    expect(await readFile(path.join(content, 'guide', 'page.md'), 'utf8')).toBe('kept\n')
  })

  it('moves a page, into a new folder if need be, and never onto a file that is there', async () => {
    const root = await site({ 'content/guide/page.md': 'the page\n', 'content/guide/other.md': 'the other\n' })
    const content = path.join(root, 'content')
    const page = path.join(content, 'guide', 'page.md')

    await expect(movePage(content, page, 'guide/other.md')).rejects.toEqual(refusal(409))
    expect(await readFile(page, 'utf8')).toBe('the page\n')
    expect(await readFile(path.join(content, 'guide', 'other.md'), 'utf8')).toBe('the other\n')

    expect(await movePage(content, page, 'handbook/start/page.mdx')).toBe(path.join(content, 'handbook', 'start', 'page.mdx'))
    expect(await filesIn(content)).toEqual(['guide/other.md', 'handbook/start/page.mdx'])
    expect(await readFile(path.join(content, 'handbook', 'start', 'page.mdx'), 'utf8')).toBe('the page\n')
  })

  it('deletes a file and refuses a folder', async () => {
    const root = await site({ 'content/guide/page.md': 'the page\n', 'content/guide/other.md': 'the other\n' })
    const content = path.join(root, 'content')

    await deletePage(path.join(content, 'guide', 'page.md'))
    expect(await filesIn(content)).toEqual(['guide/other.md'])
    await expect(deletePage(path.join(content, 'guide'))).rejects.toThrow()
    expect(await filesIn(content)).toEqual(['guide/other.md'])
  })
})

describe('a redirect added to the config', () => {
  const CONFIG = [
    '# A comment at the top.',
    'site:',
    '  title: "Docs"   # quoted, with a comment after it',
    '  nav:',
    '    - { label: Guide, link: /guide/intro }',
    '',
    'redirects:',
    '  /guide/start: /guide/intro',
    "  '/old-setup': /guide/setup#second-step # where it went",
    '',
    'features:',
    '  search: { semantic: false }',
    '',
  ].join('\n')

  /** `after` is `before` with exactly `added` put in, and nothing else touched. */
  const onlyAdds = (before: string, after: string, added: string) => {
    const at = after.indexOf(added)
    expect(at, `"${added}" is in the result`).toBeGreaterThan(-1)
    expect(after.slice(0, at) + after.slice(at + added.length)).toBe(before)
  }

  it('puts one line after the last redirect and leaves every other character as it was', () => {
    const edit = addRedirect(CONFIG, '/guide/setup', '/guide/renamed')
    if (!edit.ok) throw new Error(edit.problem)
    expect(edit.line).toBe('/guide/setup: /guide/renamed')
    onlyAdds(CONFIG, edit.source, '\n  /guide/setup: /guide/renamed')
    // It is the next line after the last one, comment and all, and before the empty line that ends the block.
    expect(edit.source).toContain("  '/old-setup': /guide/setup#second-step # where it went\n  /guide/setup: /guide/renamed\n\nfeatures:")
    expect(resolveConfig('/site', '/site/shabd.config.yaml', edit.source).config.redirects).toEqual({
      '/guide/start': '/guide/intro',
      '/old-setup': '/guide/setup#second-step',
      '/guide/setup': '/guide/renamed',
    })
  })

  it('follows the indent and the line endings the file has', () => {
    const wide = 'site:\n    title: Docs\nredirects:\n    /a: /b\n'
    const edit = addRedirect(wide, '/c', '/d')
    expect(edit).toMatchObject({ ok: true, source: 'site:\n    title: Docs\nredirects:\n    /a: /b\n    /c: /d\n' })

    const windows = 'site:\r\n  title: Docs\r\nredirects:\r\n  /a: /b\r\n'
    expect(addRedirect(windows, '/c', '/d')).toMatchObject({ ok: true, source: `${windows.slice(0, -2)}\r\n  /c: /d\r\n` })

    const unended = 'site:\n  title: Docs\nredirects:\n  /a: /b'
    expect(addRedirect(unended, '/c', '/d')).toMatchObject({ ok: true, source: `${unended}\n  /c: /d` })
  })

  it('starts the block when there is none, at the end of the file', () => {
    const none = '# Mine.\nsite:\n  title: Docs\n'
    expect(addRedirect(none, '/a', '/b')).toMatchObject({ ok: true, source: `${none}\nredirects:\n  /a: /b\n` })
    // With the indent the rest of the file uses, and a line break first where the file had none at its end.
    expect(addRedirect('site:\n    title: Docs', '/a', '/b')).toMatchObject({ ok: true, source: 'site:\n    title: Docs\n\nredirects:\n    /a: /b\n' })

    const empty = 'site:\n  title: Docs\nredirects: # none yet\nfeatures:\n  search: false\n'
    expect(addRedirect(empty, '/a', '/b')).toMatchObject({
      ok: true,
      source: 'site:\n  title: Docs\nredirects: # none yet\n  /a: /b\nfeatures:\n  search: false\n',
    })
  })

  it('puts a path in quotes when YAML would read it as something else', () => {
    const edit = addRedirect('site:\n  title: Docs\n', '/guide/ça va', '/guide/#1')
    expect(edit).toMatchObject({ ok: true, line: '"/guide/ça va": "/guide/#1"' })
    if (edit.ok) expect((parse(edit.source) as { redirects: unknown }).redirects).toEqual({ '/guide/ça va': '/guide/#1' })
  })

  it('adds nothing where a line cannot be put in without rewriting what is there', () => {
    for (const [config, reason] of [
      ['site: { title: Docs }\nredirects: { /a: /b }\n', /between braces/],
      ['site: { title: Docs }\nredirects: {}\n', /between braces/],
      ['site: { title: Docs }\nredirects: null\n', /not written as paths/],
      ['site: { title: Docs }\nredirects: [/a, /b]\n', /not written as paths/],
      ['{ site: { title: Docs }, redirects: { /a: /b } }\n', /not written as keys/],
      ['- site\n- redirects\n', /not written as keys/],
      ['site:\n  title: "Docs\n', /cannot be read as YAML/],
      // The same address twice is not the same config with one redirect more.
      ['site: { title: Docs }\nredirects:\n  /c: /elsewhere\n', /without changing something else/],
    ] as const) {
      const edit = addRedirect(config, '/c', '/d')
      expect(edit, config).toMatchObject({ ok: false, line: '/c: /d' })
      if (!edit.ok) expect(edit.problem, config).toMatch(reason)
    }
  })

  it('is only planned from an address that has no page to one that has', () => {
    const config = resolveConfig('/site', '/site/shabd.config.yaml', CONFIG)
    const pages = new Set(['/guide/intro', '/guide/renamed'])
    const plan = (from: unknown, to: unknown) => planRedirect(config, CONFIG, from, to, (route) => pages.has(route))

    expect(plan('/guide/setup', '/guide/renamed')).toMatchObject({ ok: true, line: '/guide/setup: /guide/renamed' })
    expect(plan('/guide/setup', '/guide/nowhere')).toMatchObject({ ok: false, problem: 'There is no page at /guide/nowhere to send readers to.' })
    expect(plan('/guide/intro', '/guide/renamed')).toMatchObject({ ok: false, problem: expect.stringContaining('There is a page at /guide/intro') })
    expect(plan('/guide/start', '/guide/renamed')).toMatchObject({
      ok: false,
      problem: 'shabd.config.yaml already has a redirect from /guide/start, to /guide/intro.',
    })
    for (const bad of [undefined, 42, '', 'guide/setup', '/guide/setup/', 'https://elsewhere.example/', '//elsewhere.example']) {
      expect(plan(bad, '/guide/renamed'), String(bad)).toMatchObject({ ok: false })
      expect(plan('/guide/setup', bad), String(bad)).toMatchObject({ ok: false })
    }
  })

  it('is not planned when the config would stop being valid, as when a page moves back to where it was', () => {
    // The page went from /a to /b once and a redirect was added. Now it goes back to /a.
    const source = 'site: { title: Docs }\nredirects:\n  /a: /b\n'
    const config = resolveConfig('/site', '/site/shabd.config.yaml', source)
    const plan = planRedirect(config, source, '/b', '/a', (route) => route === '/a')
    expect(plan).toMatchObject({ ok: false, line: '/b: /a' })
    if (!plan.ok) expect(plan.problem).toContain('Redirects lead in a circle')
  })
})

const bytes = (...parts: (string | number[])[]) =>
  Uint8Array.from(parts.flatMap((part) => (typeof part === 'string' ? [...part].map((letter) => letter.charCodeAt(0)) : part)))

/** How a file of each kind begins. Only the first bytes are real: that is all that is read. */
const IMAGES = {
  png: bytes([0x89], 'PNG\r\n', [0x1a], '\n', [0, 0, 0, 13], 'IHDR'),
  jpg: bytes([0xff, 0xd8, 0xff, 0xe0, 0, 16], 'JFIF', [0]),
  gif: bytes('GIF89a', [1, 0, 1, 0]),
  webp: bytes('RIFF', [36, 0, 0, 0], 'WEBPVP8 '),
  avif: bytes([0, 0, 0, 28], 'ftypavif', [0, 0, 0, 0], 'avifmif1miaf'),
}

/** Files that are not images, and files that are close to one. */
const NOT_IMAGES: [what: string, bytes: Uint8Array][] = [
  ['nothing at all', bytes()],
  ['two bytes', bytes([0xff, 0xd8])],
  ['text', bytes('Just some words.\n')],
  ['a page', bytes('---\ntitle: A page\n---\n')],
  ['a web page', bytes('<!doctype html><script>alert(1)</script>')],
  ['an SVG, which is text and can hold a script', bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
  ['a script', bytes('export default 1\n')],
  ['a PDF', bytes('%PDF-1.7\n')],
  ['an archive', bytes('PK', [3, 4, 20, 0])],
  ['a program', bytes([0x7f], 'ELF', [2, 1, 1])],
  ['sound in the wrapper WebP uses', bytes('RIFF', [36, 0, 0, 0], 'WAVEfmt ')],
  ['video in the wrapper WebP uses', bytes('RIFF', [36, 0, 0, 0], 'AVI LIST')],
  ['video in the wrapper AVIF uses', bytes([0, 0, 0, 24], 'ftypisom', [0, 0, 2, 0], 'isomiso2')],
  ['a HEIC picture, which browsers do not show', bytes([0, 0, 0, 24], 'ftypheic', [0, 0, 0, 0], 'mif1heic')],
  ['a PNG with one byte of its signature wrong', bytes([0x89], 'PNG\r\n', [0x1b], '\n')],
  ['a GIF of a version there is not', bytes('GIF90a', [1, 0, 1, 0])],
  ['a bitmap', bytes('BM', [70, 0, 0, 0])],
  ['an icon', bytes([0, 0, 1, 0, 1, 0])],
]

describe('what the Studio takes for an image', () => {
  it('knows a PNG, a JPEG, a GIF, a WebP and an AVIF by how they begin', () => {
    expect(Object.entries(IMAGES).map(([name, start]) => [name, sniffImage(start)?.extension])).toEqual([
      ['png', 'png'],
      ['jpg', 'jpg'],
      ['gif', 'gif'],
      ['webp', 'webp'],
      ['avif', 'avif'],
    ])
    expect(sniffImage(bytes('GIF87a'))?.extension).toBe('gif')
    // An AVIF may say first that it is of the family, and only then that it is an AVIF.
    expect(sniffImage(bytes([0, 0, 0, 28], 'ftypmif1', [0, 0, 0, 0], 'mif1avifmiaf'))?.extension).toBe('avif')
    expect(sniffImage(bytes([0, 0, 0, 28], 'ftypavis', [0, 0, 0, 0], 'avismsf1miaf'))?.extension).toBe('avif')
  })

  it.each(NOT_IMAGES)('does not take %s', (_what, start) => {
    expect(sniffImage(start)).toBeUndefined()
  })

  it('names the file itself, from what it was called and what it is', () => {
    const png = sniffImage(IMAGES.png)!
    const jpg = sniffImage(IMAGES.jpg)!
    expect(imageFileName('Screenshot 2026-11-19 at 10.00.00.png', png)).toBe('screenshot-2026-11-19-at-10-00-00.png')
    expect(imageFileName('Çà et là.webp', png)).toBe('ca-et-la.png')
    expect(imageFileName('photo.JPEG', jpg)).toBe('photo.jpg')
    // The extension is that of the content, whatever the name said.
    expect(imageFileName('page.md', png)).toBe('page.png')
    expect(imageFileName('evil.svg', png)).toBe('evil.png')
    expect(imageFileName('run.php.png', png)).toBe('run-php.png')
    // A name that is taken gets a number.
    expect(imageFileName('shot.png', png, 2)).toBe('shot-2.png')
    expect(imageFileName('shot.png', png, 31)).toBe('shot-31.png')
    // Nothing to make a name from.
    for (const nameless of ['', '.png', '.htaccess', '...', '///', 'снимок.png', undefined, null, 42, ['shot.png']]) {
      expect(imageFileName(nameless, png), String(nameless)).toBe('image.png')
    }
    expect(imageFileName(`${'long-'.repeat(40)}name.png`, png)).toBe(`${'long-'.repeat(12).slice(0, -1)}.png`)
  })

  it('makes no name that could be anywhere but in the folder it is saved to', () => {
    const png = sniffImage(IMAGES.png)!
    const attempts = [
      '../outside.png',
      '../../outside.png',
      '/tmp/outside.png',
      'C:\\outside.png',
      '..\\..\\outside.png',
      'folder/inside.png',
      './here.png',
      '..',
      '.',
      '%2e%2e%2foutside.png',
      'a\u0000b.png',
      'a\nb.png',
      ' leading and trailing .png ',
      'CON.png',
    ]
    for (const attempt of attempts) {
      for (const turn of [1, 2]) expect(imageFileName(attempt, png, turn), attempt).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*\.png$/)
    }
    expect(imageFileName('../../outside.png', png)).toBe('outside.png')
    expect(imageFileName('C:\\Users\\me\\Desktop\\shot.png', png)).toBe('shot.png')
    // A name Windows keeps for a device is not used as it is.
    expect(imageFileName('CON.png', png)).toBe('image-con.png')
    expect(imageFileName('lpt1.png', png, 2)).toBe('image-lpt1-2.png')
  })
})

describe('an image saved beside a page', () => {
  const site = temporarySites()
  const names = async (folder: string) => (await readdir(folder)).sort()

  it('is written into the page\'s folder under a name of its own', async () => {
    const root = await site({ 'content/guide/page.md': '# Page\n' })
    const content = path.join(root, 'content')
    const page = path.join(content, 'guide', 'page.md')

    expect(await saveImage(content, page, 'My Shot.PNG', IMAGES.png)).toBe('my-shot.png')
    expect(new Uint8Array(await readFile(path.join(content, 'guide', 'my-shot.png')))).toEqual(IMAGES.png)
    // The same name again, and a third time: each is another file, and none is written over.
    expect(await saveImage(content, page, 'My Shot.PNG', IMAGES.jpg)).toBe('my-shot.jpg')
    expect(await saveImage(content, page, 'my shot.png', IMAGES.gif)).toBe('my-shot.gif')
    expect(await saveImage(content, page, 'my-shot.png', IMAGES.png.slice(0, 12))).toBe('my-shot-2.png')
    expect(await saveImage(content, page, 'my-shot.png', IMAGES.png.slice(0, 10))).toBe('my-shot-3.png')
    expect(await names(path.join(content, 'guide'))).toEqual(['my-shot-2.png', 'my-shot-3.png', 'my-shot.gif', 'my-shot.jpg', 'my-shot.png', 'page.md'])
    expect(new Uint8Array(await readFile(path.join(content, 'guide', 'my-shot.png')))).toEqual(IMAGES.png)
  })

  it('stays in that folder whatever it was called', async () => {
    const root = await site({ 'content/guide/page.md': '# Page\n', 'content/index.md': '# Home\n', 'outside.md': 'kept\n' })
    const content = path.join(root, 'content')
    const page = path.join(content, 'guide', 'page.md')

    for (const name of ['../up.png', '../../outside.png', path.join(root, 'absolute.png'), '..\\..\\back.png', 'deeper/down.png', '../index.md', 'page.md']) {
      await saveImage(content, page, name, IMAGES.png)
    }
    expect(await names(root)).toEqual(['content', 'outside.md'])
    expect(await names(content)).toEqual(['guide', 'index.md'])
    expect(await names(path.join(content, 'guide'))).toEqual(['absolute.png', 'back.png', 'down.png', 'index.png', 'outside.png', 'page.md', 'page.png', 'up.png'])
    // The page itself, and the one that was named, are as they were.
    expect(await readFile(page, 'utf8')).toBe('# Page\n')
    expect(await readFile(path.join(content, 'index.md'), 'utf8')).toBe('# Home\n')
  })

  it.each(NOT_IMAGES)('is not written when it is %s', async (_what, start) => {
    const root = await site({ 'content/guide/page.md': '# Page\n' })
    const content = path.join(root, 'content')
    await expect(saveImage(content, path.join(content, 'guide', 'page.md'), 'shot.png', start)).rejects.toMatchObject({ status: 415 })
    expect(await names(path.join(content, 'guide'))).toEqual(['page.md'])
  })

  it('is not written when it is larger than the limit, and is at the limit', async () => {
    const root = await site({ 'content/guide/page.md': '# Page\n' })
    const content = path.join(root, 'content')
    const page = path.join(content, 'guide', 'page.md')
    const large = new Uint8Array(IMAGE_BYTES_LIMIT + 1)
    large.set(IMAGES.png)

    await expect(saveImage(content, page, 'large.png', large)).rejects.toMatchObject({ status: 413, message: 'That image is larger than 10 MB.' })
    expect(await names(path.join(content, 'guide'))).toEqual(['page.md'])
    expect(await saveImage(content, page, 'large.png', large.subarray(0, IMAGE_BYTES_LIMIT))).toBe('large.png')
  })

  it.runIf(canLink)('is not written beside a page that a link has put outside the content folder', async () => {
    const root = await site({ 'content/index.md': '# Home\n', 'elsewhere/page.md': '# Elsewhere\n' })
    const content = path.join(root, 'content')
    await symlink(path.join(root, 'elsewhere'), path.join(content, 'linked'), 'junction')

    await expect(saveImage(content, path.join(content, 'linked', 'page.md'), 'shot.png', IMAGES.png)).rejects.toMatchObject({ status: 400 })
    expect(await names(path.join(root, 'elsewhere'))).toEqual(['page.md'])
  })
})
