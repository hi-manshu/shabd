/** The content store and what is derived from it, against a real folder on disk. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { collectProblems } from '../src/node/check.js'
import { isShabdError } from '../src/node/config/errors.js'
import { createContext, type ShabdContext } from '../src/node/context.js'
import { renderLlmsFull, renderLlmsTxt } from '../src/node/llms/llms-txt.js'
import { pageMarkdown, stripEsm } from '../src/node/llms/markdown.js'

let root: string

async function site(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(root, 'site-'))
  for (const [name, contents] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true })
    await writeFile(path.join(dir, name), contents)
  }
  return dir
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'shabd-test-'))
})
afterAll(() => rm(root, { recursive: true, force: true }))

const CONFIG = 'site:\n  title: Acme\n  description: Acme docs.\n  url: https://docs.acme.test\n'

describe('content store', () => {
  let context: ShabdContext
  let dir: string

  beforeAll(async () => {
    dir = await site({
      'shabd.config.yaml': CONFIG,
      'sidebar.yaml': '- category: Guide\n  items: [guide/install]\n',
      'content/index.md': '---\ntitle: Home\nlayout: splash\n---\n\nWelcome.\n',
      'content/guide/install.md': '# Install the CLI\n\nRun it. See [the API](../api/index.md#auth).\n',
      'content/guide/Getting Started.md': '---\ndescription: First steps.\n---\n\nNo heading here.\n',
      'content/api/index.md': '---\ntitle: API\n---\n\n## Auth\n\nUse a token.\n',
      'content/api/secret.md': '---\ntitle: Secret\ndraft: true\n---\n\nNot yet.\n',
      'content/_snippets/note.md': 'A partial.\n',
      'content/guide/demo.mdx': "---\ntitle: Demo\n---\n\nimport X from './x'\n\nexport const n = 1\n\nText {n}.\n",
    })
    context = await createContext(dir, { dev: false })
  })

  it('turns file paths into routes, skipping partials and drafts', () => {
    expect(context.store.pages().map((page) => page.path)).toEqual([
      '/',
      '/api',
      '/guide/demo',
      '/guide/getting-started',
      '/guide/install',
    ])
  })

  it('takes a title from frontmatter, then a leading heading, then the file name', () => {
    const title = (route: string) => context.store.byPath(route)?.title
    expect(title('/')).toBe('Home')
    expect(title('/guide/install')).toBe('Install the CLI')
    expect(title('/guide/getting-started')).toBe('Getting Started')
    expect(context.store.byPath('/guide/install')?.titleFromHeading).toBe(true)
  })

  it('includes drafts in dev', async () => {
    const dev = await createContext(dir, { dev: true })
    expect(dev.store.byPath('/api/secret')?.title).toBe('Secret')
  })

  it('resolves the sidebar, generating the folder sidebar.yaml does not mention', () => {
    const { sidebar, unlisted } = context.store.sidebar
    expect(sidebar.map((node) => (node.type === 'group' ? `${node.label}${node.auto ? ' (auto)' : ''}` : node.type))).toEqual([
      'Guide',
      'API (auto)',
    ])
    // `guide/` is curated by hand, so its unlisted pages are reported rather than added.
    expect(unlisted).toEqual(['guide/demo', 'guide/getting-started'])
  })

  it('classifies an edit by what it affects', async () => {
    const file = path.join(dir, 'content/guide/install.md')
    const original = context.store.byFile(file)!.source
    expect((await context.store.upsert(file, original)).change).toBe('none')
    expect((await context.store.upsert(file, `${original}\nMore.\n`)).change).toBe('body')
    expect((await context.store.upsert(file, original.replace('Install the CLI', 'Set up'))).change).toBe('meta')
    expect((await context.store.upsert(path.join(dir, 'content/guide/new.md'), '# New\n')).change).toBe('added')
    context.store.remove(path.join(dir, 'content/guide/new.md'))
    await context.store.upsert(file, original)
  })

  it('keeps a page with invalid frontmatter routable and carries the error', async () => {
    const file = path.join(dir, 'content/guide/broken.md')
    const { page } = await context.store.upsert(file, '---\ntitle: Broken\nlayout: nope\n---\n\nBody\n')
    expect(page.path).toBe('/guide/broken')
    expect(page.error?.issues[0]).toMatchObject({ path: ['layout'], line: 3 })
    expect(context.store.errors()).toHaveLength(1)
    context.store.remove(file)
  })

  it('keeps the last good title and options while an edit is invalid', async () => {
    const file = path.join(dir, 'content/api/index.md')
    const original = context.store.byFile(file)!.source
    const { page, change } = await context.store.upsert(file, original.replace('title: API', 'title: API\nlayout: splsh'))
    expect(page.error?.issues[0]?.message).toContain('Did you mean "splash"?')
    // Navigation data is untouched, so nothing else needs to refresh.
    expect(page.title).toBe('API')
    expect(change).toBe('body')
    const fixed = await context.store.upsert(file, original)
    expect(fixed.page.error).toBeUndefined()
  })

  it('writes llms.txt in sidebar order with links to Markdown copies', () => {
    expect(renderLlmsTxt(context)).toBe(
      [
        '# Acme',
        '> Acme docs.',
        'The complete documentation in one file: https://docs.acme.test/llms-full.txt',
        '## Guide',
        '- [Install the CLI](https://docs.acme.test/guide/install.md)',
        '## API',
        '- [API](https://docs.acme.test/api.md)',
        '## Optional',
        '- [Demo](https://docs.acme.test/guide/demo.md)\n- [Getting Started](https://docs.acme.test/guide/getting-started.md): First steps.',
        '',
      ].join('\n\n').replace(/\n\n$/, '\n'),
    )
  })

  it('writes every page into llms-full.txt, as clean Markdown', () => {
    const full = renderLlmsFull(context)
    expect(full).toContain('Source: https://docs.acme.test/guide/install\n\n# Install the CLI')
    expect(full).toContain('# Demo\n\nText {n}.')
    expect(full).not.toContain('import X')
    expect(full).not.toContain('draft')
    expect(full.indexOf('# Install the CLI')).toBeLessThan(full.indexOf('# API'))
  })

  it('adds the title a page gets from frontmatter to its Markdown copy', () => {
    expect(pageMarkdown(context.store.byPath('/api')!)).toBe('# API\n\n## Auth\n\nUse a token.\n')
    expect(pageMarkdown(context.store.byPath('/guide/install')!)).toMatch(/^# Install the CLI\n\nRun it\./)
  })

  it('checks links between pages, including their anchors', async () => {
    const good = await collectProblems(context)
    expect(good.problems.filter((problem) => problem.level === 'error')).toEqual([])

    const file = path.join(dir, 'content/guide/install.md')
    const original = context.store.byFile(file)!.source
    await context.store.upsert(file, '# Install\n\n[a](./missing.md) [b](../api/index.md#nope) [c](../api/index.md#auth)\n')
    const bad = await collectProblems(context)
    expect(bad.problems.filter((problem) => problem.level === 'error').map((problem) => problem.message)).toEqual([
      'Broken link: no page at /guide/missing',
      'Broken link: /api has no heading "#nope"',
    ])
    await context.store.upsert(file, original)
  })
})

describe('content store errors', () => {
  it('refuses two files that map to one address', async () => {
    const dir = await site({
      'shabd.config.yaml': CONFIG,
      'content/guide.md': '# A\n',
      'content/guide/index.md': '# B\n',
    })
    const error = await createContext(dir, { dev: false }).catch((e: unknown) => e)
    expect(isShabdError(error) && error.message).toContain('Two pages map to the same URL /guide')
  })

  it('explains a missing content folder and a missing config', async () => {
    const noContent = await site({ 'shabd.config.yaml': CONFIG })
    const first = await createContext(noContent, { dev: false }).catch((e: unknown) => e)
    expect(isShabdError(first) && first.message).toContain('Content directory not found')

    const empty = await site({ 'content/index.md': '# Hi\n' })
    const second = await createContext(empty, { dev: false }).catch((e: unknown) => e)
    expect(isShabdError(second) && second.message).toContain('No shabd.config.yaml found')
  })
})

describe('stripEsm', () => {
  it('removes import and export blocks but leaves code fences alone', () => {
    const body = [
      "import A from './a'",
      "import {",
      '  B,',
      "} from './b'",
      '',
      'Prose.',
      '',
      '```js',
      "import fenced from 'kept'",
      '```',
      '',
      'export const x = 1',
      '',
      'End.',
    ].join('\n')
    expect(stripEsm(body)).toBe(['Prose.', '', '```js', "import fenced from 'kept'", '```', '', 'End.'].join('\n'))
  })
})
