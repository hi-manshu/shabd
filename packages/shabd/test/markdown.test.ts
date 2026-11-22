import { describe, expect, it } from 'vitest'
import { isShabdError } from '../src/node/config/errors.js'
import { parseCodeMeta } from '../src/node/markdown/code-meta.js'
import { MarkdownCompiler, type CompileInput } from '../src/node/markdown/compile.js'
import { themedCodeCss } from '../src/node/markdown/plugins/rehype-code.js'
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

  it('applies site-wide line numbers and wrapping, which a block can turn off', async () => {
    const numbered = new MarkdownCompiler({
      themes: { light: 'github-light', dark: 'tokyo-night' },
      wrap: true,
      lineNumbers: true,
      sandbox: false,
      fingerprint: 'test-code-defaults',
    })
    const html = await renderCompiled(
      (await numbered.compile(page('```ts\nconst a = 1\n```\n\n```ts noLineNumbers noWrap\nconst b = 2\n```\n'))).code,
    )
    const [first, second] = html.match(/<pre [^>]*>/g) ?? []
    expect(first).toContain('data-line-numbers=""')
    expect(first).toContain('data-wrap=""')
    expect(second).not.toContain('data-line-numbers')
    expect(second).not.toContain('data-wrap')
  })

  it('colours code for every syntax theme a reader can pick, and says which rule is which', async () => {
    const menu = new MarkdownCompiler({
      themes: { light: 'github-light', dark: 'tokyo-night' },
      more: ['everforest-light', 'everforest-dark'],
      sandbox: false,
      fingerprint: 'test-code-themes',
    })
    const result = await menu.compile(page('```ts\nconst a = 1\n```\n\nNo code here.\n'))
    const html = await renderCompiled(result.code)
    const keyword = /<span class="(sbk-[a-z0-9]+)">const<\/span>/.exec(html)?.[1]
    // The page's own stylesheet has the site's two themes and nothing of the menu's: every reader gets it.
    expect(result.codeCss).toContain(`.${keyword}{--sb-tok:#d73a49}`)
    expect(result.codeCss).not.toContain('data-code')
    // The menu's themes are beside it, as colours, for whoever writes the stylesheet a reader fetches on picking one.
    expect(menu.highlighter.keys).toEqual(['light', 'dark', 't2', 't3'])
    expect(result.codeColours[keyword!]).toHaveLength(4)
    const themed = themedCodeCss(menu.highlighter.keys, result.codeColours)
    expect(themed.startsWith('@media screen{:root[data-code=light]{')).toBe(true)
    const block = (key: string) => new RegExp(`:root\\[data-code=${key}\\]\\{([^}]*\\})*?\\.${keyword}\\{--sb-tok:(#[0-9a-f]{6})\\}`).exec(themed)?.[2]
    // The site's own two keep their names; the others are numbered.
    expect(block('light')).toBe('#d73a49')
    expect(block('dark')).toBe('#9d7cd8')
    expect(block('t2')).toMatch(/^#[0-9a-f]{6}$/)
    expect(block('t3')).toMatch(/^#[0-9a-f]{6}$/)
    expect(block('t2')).not.toBe(block('light'))
    // A site with no menu has only its two themes, and nothing to put in such a stylesheet.
    expect(themedCodeCss(['light', 'dark'], result.codeColours)).toBe('')

    // The same colours give the same class in another compiler, so cached pages agree with fresh ones.
    const again = new MarkdownCompiler({
      themes: { light: 'github-light', dark: 'tokyo-night' },
      more: ['everforest-light', 'everforest-dark'],
      sandbox: false,
      fingerprint: 'test-code-themes-2',
    })
    expect(await renderCompiled((await again.compile(page('```ts\nconst b = 2\n```\n'))).code)).toContain(`class="${keyword}">const<`)

    // A page without code has no stylesheet at all.
    const plain = await menu.compile(page('Just text.\n'))
    expect(plain.codeCss).toBe('')
    expect(plain.codeColours).toEqual({})
  })

  it('moves a syntax colour that is too faint for the code background, and only that one', async () => {
    const options = {
      themes: { light: 'github-light', dark: 'tokyo-night' },
      // No tint is known for highlighted lines, so they go by the plain background.
      backgrounds: { code: [['#ffffff'], ['#1a1b26']], highlighted: [[], []] },
      minContrast: 4.5,
      sandbox: false,
    }
    const held = new MarkdownCompiler({ ...options, fingerprint: 'held' })
    const source = page('```ts {1}\nfunction greet(name) {}\nconst a = 1\n```\n')
    const result = await held.compile(source)
    const html = await renderCompiled(result.code)
    const colourOf = (text: string, css = result.codeCss, markup = html) => {
      const token = new RegExp(`<span class="(sbk-[a-z0-9]+)">${text}</span>`).exec(markup)?.[1]
      return new RegExp(`^(?:\\.sbk-[a-z0-9]+\\{[^}]*\\})*?\\.${token}\\{--sb-tok:(#[0-9a-f]{6})\\}`).exec(css)?.[1]
    }
    // GitHub Light's orange is 3.3:1 on white. Its red is 4.6:1 and stays as it is.
    expect(colourOf('name')).toMatch(/^#[0-9a-f]{6}$/)
    expect(colourOf('name')).not.toBe('#e36209')
    expect(colourOf('const')).toBe('#d73a49')

    // The colours behind code change, as when a palette is edited while the dev server runs.
    held.recolour({ code: [['#d0d0d0'], ['#1a1b26']], highlighted: [[], []] }, 'held-again')
    const again = await held.compile(source)
    const after = await renderCompiled(again.code)
    expect(colourOf('const', again.codeCss, after)).not.toBe('#d73a49')
    expect(again.cached).toBe(false)
  })

  it('highlights code at compile time for both colour modes', async () => {
    const result = await compiler.compile(
      page('```ts title="src/app.ts" {2} showLineNumbers\nconst a = 1\nconst b = 2\n```\n\n```nonsense\nplain\n```\n'),
    )
    const html = await renderCompiled(result.code)
    expect(html).toMatch(/<pre class="shiki sbk-[a-z0-9]+"/)
    expect(html).toContain('data-lang="ts"')
    expect(html).toContain('data-title="src/app.ts"')
    expect(html).toContain('data-line-numbers=""')
    expect(html.match(/class="line/g)).toHaveLength(3)

    // A token carries a class, not its colours. The page's stylesheet has the colours, for both modes.
    expect(html).not.toContain('--shiki-')
    expect(html).not.toContain('style=')
    const keyword = /<span class="(sbk-[a-z0-9]+)">const<\/span>/.exec(html)?.[1]
    expect(keyword).toBeDefined()
    expect(result.codeCss).toContain(`.${keyword}{--sb-tok:#d73a49}`)
    expect(result.codeCss).toMatch(new RegExp(`\\[data-theme=dark\\]\\{[^}]*(\\}[^}]*)*\\.${keyword}\\{--sb-tok:#9d7cd8\\}`))
    expect(result.codeCss).toContain('@media screen and (prefers-color-scheme:dark){:root:not([data-theme]){')
    // The dark colours are for screens: a printed page is white.
    expect(result.codeCss).toContain('@media screen{[data-theme=dark]{')
    // No theme menu, so no rules for other themes.
    expect(result.codeCss).not.toContain('data-code')

    // Tokens neither theme coloured are marked, so a site's theme can colour them (`colors.codeText`).
    expect(html).toContain('<span class="sb-plain">plain</span>')
    expect(html).not.toMatch(/<span class="sb-plain"[^>]*>const<\/span>/)
    expect(html.match(/sb-line-highlight/g)).toHaveLength(1)
    // An unknown language falls back to plain text rather than failing the build.
    expect(html).toContain('data-lang="nonsense"')
  })

  it('takes a word for a language only when it is one, whatever else the word names', async () => {
    // Its own compiler: a fence like these, taken for a language, would leave a compiler unable to load any language after it.
    const fresh = new MarkdownCompiler({ themes: { light: 'github-light', dark: 'tokyo-night' }, sandbox: false, fingerprint: 'odd-languages' })
    const odd = await fresh.compile(page('```constructor\nplain\n```\n\n```__proto__\nplain\n```\n\n```toString\nplain\n```\n'))
    expect((await renderCompiled(odd.code)).match(/<span class="sb-plain">plain<\/span>/g)).toHaveLength(3)

    const after = await fresh.compile(page('```ts\nconst a = 1\n```\n'))
    expect(await renderCompiled(after.code)).toMatch(/<span class="sbk-[a-z0-9]+">const<\/span>/)
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

describe('HTML in a Markdown page', () => {
  it('is rendered, where it used to be left out without a word', async () => {
    const result = await compiler.compile(
      page(
        [
          'Press <kbd>Ctrl</kbd> and <kbd>S</kbd>.',
          '',
          '<details>',
          '<summary>More about saving</summary>',
          '',
          'The file is **written** at once.',
          '',
          '</details>',
          '',
          'H<sub>2</sub>O, and a line<br>break.',
        ].join('\n'),
      ),
    )
    const html = await renderCompiled(result.code)
    expect(html).toContain('Press <kbd>Ctrl</kbd> and <kbd>S</kbd>.')
    expect(html).toContain('<summary>More about saving</summary>')
    // Markdown inside the block is still Markdown.
    expect(html).toContain('<p>The file is <strong>written</strong> at once.</p>')
    expect(html).toContain('H<sub>2</sub>O, and a line<br/>break.')
    // What was in the tags is searched like the rest of the page.
    expect(result.sections[0]?.text).toContain('More about saving')
  })

  it('is treated like the Markdown it stands in for: a heading gets its id, and a link is rewritten', async () => {
    const result = await compiler.compile(
      page('<h2>Written as a tag</h2>\n\n<a href="./other.md#part">Elsewhere</a> and <img src="/logo.svg" alt="The logo">\n'),
    )
    const html = await renderCompiled(result.code)
    expect(html).toContain('<h2 id="written-as-a-tag">Written as a tag</h2>')
    expect(html).toContain('<a href="/guide/other#part">Elsewhere</a>')
    expect(result.toc).toEqual([{ depth: 2, id: 'written-as-a-tag', text: 'Written as a tag' }])
    expect(result.links).toEqual(['/guide/other#part'])
    // A picture written as a tag that has its alternative text is not one to report.
    expect(result.unlabelled).toEqual([])
  })

  it('leaves a page\'s callouts, code options and sandboxes as they were, though the page is read again as HTML', async () => {
    const result = await compiler.compile(
      page(
        [
          'Press <kbd>Ctrl</kbd>.',
          '',
          '> [!WARNING] Back up first',
          '> It rewrites files.',
          '',
          '```ts title="src/app.ts" {2} ins={1}',
          'const a = 1',
          'const b = 2',
          '```',
          '',
          '```tsx live group="demo"',
          '<button>Hi</button>',
          '```',
        ].join('\n'),
      ),
    )
    const html = await renderCompiled(result.code)
    expect(html).toContain('<kbd>Ctrl</kbd>')
    // An HTML parser would put the component's name in lower case, where nothing answers to it.
    expect(html).toContain('<aside data-callout="warning" data-title="Back up first">')
    // What follows a fence's language is kept beside the tree, where an HTML parser would lose it.
    expect(html).toContain('data-title="src/app.ts"')
    expect(html).toContain('class="line sb-line-ins"')
    expect(html).toContain('class="line sb-line-highlight"')
    expect(html).toContain('<div data-sandbox="tsx" data-group="demo">')
    // Nothing of the round trip is left on the page.
    expect(html).not.toMatch(/sb-component|data-sb-/)
  })

  it('notes a tag written like a component, which a .md page cannot have', async () => {
    const source = 'Text.\n\n<Tabs>\n<Tab label="npm">Use npm.</Tab>\n</Tabs>\n\nAnd `<Card>` in code is only code.\n'
    const result = await compiler.compile(page(source))
    expect(result.strays).toEqual([
      { name: 'Tabs', line: 3 },
      { name: 'Tab', line: 4 },
    ])
    // The same text in an .mdx page is components, and nothing is noted.
    const mdx = await compiler.compile(page(source, { format: 'mdx', file: '/site/content/guide/page.mdx', id: 'guide/page.mdx' }))
    expect(mdx.strays).toEqual([])
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

  it('reads the lines that were added and removed, apart from the lines that are marked', () => {
    const meta = parseCodeMeta('{1} ins={3, 5-6} del=2 title="a.ts" wrap')
    expect(meta.highlight).toEqual([1])
    expect(meta.inserted).toEqual([3, 5, 6])
    expect(meta.deleted).toEqual([2])
    expect(meta.title).toBe('a.ts')
    expect([...meta.flags]).toEqual(['wrap'])
    expect(meta.attrs).toEqual({})
  })

  it('marks added and removed lines with a class and nothing else', async () => {
    const result = await compiler.compile(page('```ts ins={2} del={1}\nconst a = 1\nconst a = 2\nconst b = 3\n```\n'))
    const html = await renderCompiled(result.code)
    const classes = [...html.matchAll(/<span class="(line[^"]*)"/g)].map((match) => match[1])
    expect(classes).toEqual(['line sb-line-del', 'line sb-line-ins', 'line'])
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
