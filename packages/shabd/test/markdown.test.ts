import { describe, expect, it } from 'vitest'
import { isShabdError } from '../src/node/config/errors.js'
import { parseCodeMeta } from '../src/node/markdown/code-meta.js'
import { MarkdownCompiler, type CompileInput } from '../src/node/markdown/compile.js'
import { resolvePageLink } from '../src/node/markdown/plugins/rehype-links.js'
import { renderCompiled } from './helpers/render.js'

const compiler = new MarkdownCompiler({
  themes: { light: 'github-light', dark: 'tokyo-night' },
  sandbox: true,
  fingerprint: 'test',
})

const page = (source: string, overrides: Partial<CompileInput> = {}): CompileInput => ({
  file: '/site/content/guide/page.md',
  id: 'guide/page.md',
  routePath: '/guide/page',
  format: 'md',
  source,
  ...overrides,
})

describe('markdown pipeline', () => {
  it('gives headings ids and records the outline and searchable sections', async () => {
    const result = await compiler.compile(
      page('Intro text.\n\n## Install\n\nRun the installer.\n\n### With npm\n\nUse npm.\n\n## Install\n\nAgain.\n'),
    )
    expect(result.toc).toEqual([
      { depth: 2, id: 'install', text: 'Install' },
      { depth: 3, id: 'with-npm', text: 'With npm' },
      { depth: 2, id: 'install-1', text: 'Install' },
    ])
    expect(result.sections).toEqual([
      { anchor: '', heading: '', depth: 0, text: 'Intro text.' },
      { anchor: 'install', heading: 'Install', depth: 2, text: 'Run the installer.' },
      { anchor: 'with-npm', heading: 'With npm', depth: 3, text: 'Use npm.' },
      { anchor: 'install-1', heading: 'Install', depth: 2, text: 'Again.' },
    ])
    const html = await renderCompiled(result.code)
    expect(html).toContain('<h2 id="install">Install</h2>')
    expect(html).toContain('<h3 id="with-npm">With npm</h3>')
  })

  it('turns GitHub alerts into Callout components', async () => {
    const result = await compiler.compile(
      page(
        [
          '> [!NOTE]',
          '> Plain note.',
          '',
          '> [!WARNING] Read this first',
          '> Body with **bold**.',
          '',
          '> [!danger]',
          '> Alias.',
          '',
          '> [!UNKNOWN]',
          '> Stays a quote.',
          '',
          '> Just a quote.',
        ].join('\n'),
      ),
    )
    const html = await renderCompiled(result.code)
    expect(html).toContain('<aside data-callout="note">\n<p>Plain note.</p>\n</aside>')
    expect(html).toContain('<aside data-callout="warning" data-title="Read this first">')
    expect(html).toContain('<p>Body with <strong>bold</strong>.</p>')
    expect(html).toContain('<aside data-callout="caution">')
    expect(html).toContain('<blockquote>\n<p>[!UNKNOWN]')
    expect(html).toContain('<blockquote>\n<p>Just a quote.</p>')
  })

  it('highlights code at compile time for both colour modes', async () => {
    const result = await compiler.compile(
      page('```ts title="src/app.ts" {2} showLineNumbers\nconst a = 1\nconst b = 2\n```\n\n```nonsense\nplain\n```\n'),
    )
    const html = await renderCompiled(result.code)
    expect(html).toMatch(/<pre class="shiki[^"]*"/)
    expect(html).toContain('data-lang="ts"')
    expect(html).toContain('data-title="src/app.ts"')
    expect(html).toContain('data-line-numbers=""')
    expect(html).toContain('--shiki-light:')
    expect(html).toContain('--shiki-dark:')
    expect(html.match(/class="line/g)).toHaveLength(3)
    expect(html.match(/sb-line-highlight/g)).toHaveLength(1)
    // An unknown language falls back to plain text rather than failing the build.
    expect(html).toContain('data-lang="nonsense"')
  })

  it('turns live fences into sandboxes and leaves other fences alone', async () => {
    const source = '```tsx live group="demo"\n<button>Hi</button>\n```\n\n```tsx\nconst x = <b />\n```\n'
    const html = await renderCompiled((await compiler.compile(page(source))).code)
    expect(html).toContain('<div data-sandbox="tsx" data-group="demo">&lt;button&gt;Hi&lt;/button&gt;</div>')
    expect(html.match(/<pre class="shiki/g)).toHaveLength(1)

    const off = new MarkdownCompiler({ ...compiler.options, sandbox: false, fingerprint: 'no-sandbox' })
    const plain = await renderCompiled((await off.compile(page(source))).code)
    expect(plain).not.toContain('data-sandbox')
    expect(plain.match(/<pre class="shiki/g)).toHaveLength(2)
  })

  it('rewrites links between pages and records them', async () => {
    const result = await compiler.compile(
      page(
        '[a](./install.md#steps) [b](../reference/cli.mdx) [c](/guide/intro/) [d](https://example.com) [e](#top) [f](./file.pdf) [g](writing/index.md)',
      ),
    )
    const html = await renderCompiled(result.code)
    expect(html).toContain('href="/guide/install#steps"')
    expect(html).toContain('href="/reference/cli"')
    expect(html).toContain('href="/guide/intro"')
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('href="#top"')
    expect(html).toContain('href="./file.pdf"')
    expect(html).toContain('href="/guide/writing"')
    expect(result.links).toEqual(['/guide/install#steps', '/reference/cli', '/guide/intro', '/guide/writing'])
  })

  it('lifts a leading heading out of the body when asked', async () => {
    const lifted = await compiler.compile(page('# The Title\n\nBody.\n', { liftTitle: true }))
    expect(lifted.title).toBe('The Title')
    expect(await renderCompiled(lifted.code)).toBe('<p>Body.</p>')

    const kept = await compiler.compile(page('# The Title\n\nBody.\n', { liftTitle: false }))
    expect(kept.title).toBeUndefined()
    expect(await renderCompiled(kept.code)).toContain('<h1 id="the-title">The Title</h1>')
  })

  it('compiles MDX: expressions, exports and GFM tables', async () => {
    const result = await compiler.compile(
      page('---\ntitle: T\n---\n\nexport const n = 2\n\nTwo plus two is {n + n}.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n', {
        file: '/site/content/guide/page.mdx',
        id: 'guide/page.mdx',
        format: 'mdx',
      }),
    )
    const html = await renderCompiled(result.code)
    expect(html).toContain('<p>Two plus two is 4.</p>')
    expect(html).toContain('<table>')
    // Frontmatter is consumed, never rendered.
    expect(html).not.toContain('title: T')
  })

  it('imports relative images so the bundler can fingerprint them', async () => {
    const result = await compiler.compile(page('![Diagram](./diagram.png)\n\n![Logo](/logo.svg)\n'))
    expect(result.code).toMatch(/import \w+ from ["']\.\/diagram\.png["']/)
    expect(result.code).toContain('"/logo.svg"')
  })

  it('reports MDX syntax errors with a line number', async () => {
    const error = await compiler
      .compile(page('Fine.\n\n<Unclosed>\n', { format: 'mdx', file: '/site/content/bad.mdx', id: 'bad.mdx' }))
      .catch((e: unknown) => e)
    expect(isShabdError(error)).toBe(true)
    if (isShabdError(error)) {
      expect(error.file).toBe('/site/content/bad.mdx')
      expect(error.issues[0]?.line).toBe(3)
    }
  })

  it('serves an unchanged page from cache and recompiles a changed one', async () => {
    const source = '## Cached\n\n```js\nlet a = 1\n```\n'
    const first = await compiler.compile(page(source, { id: 'cache.md' }))
    const second = await compiler.compile(page(source, { id: 'cache.md' }))
    const edited = await compiler.compile(page(`${source}\nMore.\n`, { id: 'cache.md' }))
    expect(first.cached).toBe(false)
    expect(second.cached).toBe(true)
    expect(second.code).toBe(first.code)
    expect(edited.cached).toBe(false)
    expect(edited.sections.at(-1)?.text).toContain('More.')
  })
})

describe('code fence meta', () => {
  it('parses titles, line ranges, flags and attributes', () => {
    const meta = parseCodeMeta('title="a b.ts" {1,3-5} live group=cart showLineNumbers')
    expect(meta.title).toBe('a b.ts')
    expect(meta.highlight).toEqual([1, 3, 4, 5])
    expect([...meta.flags]).toEqual(['live', 'showLineNumbers'])
    expect(meta.attrs).toEqual({ group: 'cart' })
  })
})

describe('resolvePageLink', () => {
  it('resolves relative to the file, like links on disk', () => {
    expect(resolvePageLink('./b.md', 'guide/a.md')).toBe('/guide/b')
    expect(resolvePageLink('b', 'guide/index.md')).toBe('/guide/b')
    expect(resolvePageLink('../index.md', 'guide/a.md')).toBe('/')
    expect(resolvePageLink('../../outside.md', 'guide/a.md')).toBeUndefined()
    expect(resolvePageLink('mailto:a@b.c', 'guide/a.md')).toBeUndefined()
  })
})
