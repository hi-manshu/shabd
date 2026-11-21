import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { mkdir, readdir, readFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { resolveConfig } from '../src/node/config/load.js'
import { addRedirect, planRedirect } from '../src/node/config/redirect-edit.js'
import { createPage, deletePage, movePage } from '../src/node/vite/studio-files.js'
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
