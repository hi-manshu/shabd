/** The day a page was last changed, from Git and from frontmatter. */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatDay, lastCommitDates } from '../src/node/content/git.js'
import { createContext } from '../src/node/context.js'
import { KEYWORD_SEARCH, temporaryBuilds } from './helpers/build.js'
import { temporarySites } from './helpers/site.js'

const site = temporarySites()
const build = temporaryBuilds()

/** Git with nothing of the machine's own in it: no hooks, no signing, no name from elsewhere. */
function git(cwd: string, args: string[], date?: string): string {
  return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
    },
  })
}

const CONFIG = 'site:\n  title: Docs\n  lang: en-GB\ndefaults:\n  lastUpdated: true\n'

async function repository(): Promise<string> {
  const dir = await site({
    'shabd.config.yaml': CONFIG,
    'content/first.md': '# First\n',
    'content/guide/second.md': '# Second\n',
  })
  git(dir, ['init', '--quiet', '--initial-branch=main'])
  git(dir, ['add', '.'])
  git(dir, ['commit', '--quiet', '-m', 'Start'], '2026-03-04T10:00:00+05:30')
  // Late in the evening where the author is, and already the next day in UTC.
  writeFileSync(path.join(dir, 'content/first.md'), '# First\n\nMore.\n')
  git(dir, ['commit', '--quiet', '-am', 'Say more'], '2026-07-08T23:30:00-08:00')
  return dir
}

describe('the day a page was last changed', () => {
  it('is the day of the last commit that touched the file, where its author was', async () => {
    const dir = await repository()
    const { dates, note } = await lastCommitDates(path.join(dir, 'content'))
    expect(note).toBeUndefined()
    expect(Object.fromEntries([...dates].map(([file, day]) => [path.relative(dir, file), day]))).toEqual({
      [path.join('content', 'first.md')]: '2026-07-08',
      [path.join('content', 'guide', 'second.md')]: '2026-03-04',
    })
  })

  it('reaches each page, written out in the site\'s language', async () => {
    const dir = await repository()
    const { store } = await createContext(dir, { dev: false })
    expect(store.byPath('/first')?.updated).toEqual({ day: '2026-07-08', text: '8 July 2026' })
    expect(store.byPath('/guide/second')?.updated).toEqual({ day: '2026-03-04', text: '4 March 2026' })
    expect(store.lastUpdatedNote).toBeUndefined()
  })

  it('gives way to a day written in the page, and to a page that wants none', async () => {
    const dir = await repository()
    writeFileSync(path.join(dir, 'content/first.md'), '---\nlastUpdated: 2020-01-02\n---\n\n# First\n')
    writeFileSync(path.join(dir, 'content/guide/second.md'), '---\nlastUpdated: false\n---\n\n# Second\n')
    const { store } = await createContext(dir, { dev: false })
    expect(store.byPath('/first')?.updated).toEqual({ day: '2020-01-02', text: '2 January 2020' })
    expect(store.byPath('/guide/second')?.updated).toBeUndefined()
  })

  it('is left out, with the reason, where Git has no history to go by', async () => {
    const plain = await site({ 'shabd.config.yaml': CONFIG, 'content/first.md': '# First\n' })
    const none = await createContext(plain, { dev: false })
    expect(none.store.byPath('/first')?.updated).toBeUndefined()
    expect(none.store.lastUpdatedNote).toBe('the content folder is not in a Git repository')

    // A build machine often fetches the newest commit alone. Every page would then show today.
    const full = await repository()
    const shallow = `${full}-shallow`
    git(path.dirname(full), ['clone', '--quiet', '--depth', '1', `file://${full}`, shallow])
    const cut = await createContext(shallow, { dev: false })
    expect(cut.store.byPath('/first')?.updated).toBeUndefined()
    expect(cut.store.lastUpdatedNote).toContain('shallow clone')
  })

  it('is not read from Git unless the site asks, but a day written in a page is still shown', async () => {
    const dir = await repository()
    writeFileSync(path.join(dir, 'shabd.config.yaml'), 'site:\n  title: Docs\n')
    writeFileSync(path.join(dir, 'content/guide/second.md'), '---\nlastUpdated: 2021-05-06\n---\n\n# Second\n')
    const { store } = await createContext(dir, { dev: false })
    expect(store.byPath('/first')?.updated).toBeUndefined()
    expect(store.byPath('/guide/second')?.updated).toEqual({ day: '2021-05-06', text: 'May 6, 2021' })
  })

  it('writes a day as readers of the language do, and falls back when the language is not one it knows', () => {
    expect(formatDay('2026-11-17', 'en-GB')).toBe('17 November 2026')
    expect(formatDay('2026-11-17', 'de')).toBe('17. November 2026')
    expect(formatDay('2026-11-17', 'not a language')).toBe('November 17, 2026')
    expect(formatDay('not a day', 'en')).toBe('not a day')
  })

  it('is shown at the end of the page and given to search engines in the sitemap', async () => {
    const built = await build({
      'shabd.config.yaml': `site:\n  title: Docs\n  url: https://docs.example\n${KEYWORD_SEARCH}`,
      'content/index.md': '# Home\n',
      'content/dated.md': '---\nlastUpdated: 2026-01-02\n---\n\n# Dated\n',
    })
    expect(await built.read('dated/index.html')).toContain(
      '<p class="sb-page-updated">Last updated <time dateTime="2026-01-02">January 2, 2026</time></p>',
    )
    expect(await built.read('index.html')).not.toContain('sb-page-updated')
    const sitemap = await built.read('sitemap.xml')
    expect(sitemap).toContain('<url><loc>https://docs.example/dated</loc><lastmod>2026-01-02</lastmod></url>')
    expect(sitemap).toContain('<url><loc>https://docs.example/</loc></url>')
  })
})
