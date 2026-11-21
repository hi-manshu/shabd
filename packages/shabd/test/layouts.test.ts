/** Blocks that are shown on some pages only, and layouts that set code beside prose. */
import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/node/config/load.js'
import { compilePage, createContext } from '../src/node/context.js'
import { MarkdownCompiler } from '../src/node/markdown/compile.js'
import { matchesPath, resolvePageLayout } from '../src/shared/layout.js'
import { FrontmatterSchema, type FrontmatterInput } from '../src/shared/schema.js'
import { renderCompiled } from './helpers/render.js'
import { temporarySites } from './helpers/site.js'

const site = temporarySites()
const load = (yaml: string) => resolveConfig('/site', '/site/shabd.config.yaml', yaml)

describe('a block with a condition', () => {
  it('matches paths by pattern, a folder\'s own page included', () => {
    expect(matchesPath('/guide/**', '/guide/install')).toBe(true)
    expect(matchesPath('/guide/**', '/guide/a/b/c')).toBe(true)
    // The page that stands for a folder belongs with what is in the folder.
    expect(matchesPath('/guide/**', '/guide')).toBe(true)
    expect(matchesPath('/guide/**', '/guidebook')).toBe(false)
    expect(matchesPath('/guide/*', '/guide/install')).toBe(true)
    expect(matchesPath('/guide/*', '/guide/a/b')).toBe(false)
    expect(matchesPath('/**', '/')).toBe(true)
    expect(matchesPath('/', '/')).toBe(true)
    expect(matchesPath('/api/v*/users', '/api/v2/users')).toBe(true)
    // A dot in a pattern is a dot.
    expect(matchesPath('/v1.2/**', '/v1x2/a')).toBe(false)
  })

  const { config, layouts } = load(`
site:
  title: Docs
layouts:
  base:
    regions:
      banner:
        - block: footer
          when: { path: [/guide/**, "!/guide/internal/**"] }
  doc:
    regions:
      aside:
        - toc
        - block: search
          when: { frontmatter: { beta: true, tags: [a, b] } }
`)
  const blocks = (path: string, frontmatter: FrontmatterInput = {}) => {
    const active = resolvePageLayout(
      { layouts, defaults: config.defaults },
      FrontmatterSchema.parse(frontmatter),
      [{ depth: 2, id: 'a', text: 'A' }],
      path,
    )
    return { banner: active.regions.banner?.map((ref) => ref.block), aside: active.regions.aside?.map((ref) => ref.block) }
  }

  it('is shown on the paths it names, less the ones it takes away', () => {
    expect(blocks('/guide/install').banner).toEqual(['footer'])
    expect(blocks('/guide').banner).toEqual(['footer'])
    // A region whose only block is not shown is not drawn at all.
    expect(blocks('/reference/cli').banner).toBeUndefined()
    expect(blocks('/guide/internal/notes').banner).toBeUndefined()
  })

  it('is shown on pages whose frontmatter has every value it asks for', () => {
    expect(blocks('/x').aside).toEqual(['toc'])
    expect(blocks('/x', { beta: true }).aside).toEqual(['toc'])
    expect(blocks('/x', { beta: true, tags: ['a', 'b'] }).aside).toEqual(['toc', 'search'])
    expect(blocks('/x', { beta: true, tags: ['b', 'a'] }).aside).toEqual(['toc'])
  })
})

describe('prose beside code', () => {
  const compiler = new MarkdownCompiler({ themes: { light: 'github-light', dark: 'tokyo-night' }, sandbox: true, fingerprint: 'test' })
  const render = async (source: string, split: boolean, format: 'md' | 'mdx' = 'md') => {
    const result = await compiler.compile({ file: `/site/content/page.${format}`, id: `page.${format}`, routePath: '/page', format, source, split })
    return { html: await renderCompiled(result.code), result }
  }

  const PAGE = [
    'Opening words.',
    '',
    '## Request',
    '',
    'Send it like this.',
    '',
    '```sh',
    'curl https://api.example.com/ping',
    '```',
    '',
    'And mind the limit.',
    '',
    '## Response',
    '',
    'It answers at once.',
    '',
  ].join('\n')

  it('is the built-in api layout, and any layout that asks', () => {
    const { layouts } = load('site:\n  title: Docs\nlayouts:\n  reference:\n    extends: doc\n    split: true\n  plain-api:\n    extends: api\n    split: false\n')
    expect(Object.fromEntries(Object.values(layouts).map((layout) => [layout.name, layout.split]))).toEqual({
      base: false,
      doc: false,
      splash: false,
      api: true,
      reference: true,
      'plain-api': false,
    })
    // Editing a built-in layout keeps what it does not mention.
    expect(load('site:\n  title: Docs\nlayouts:\n  api:\n    width: wide\n').layouts.api?.split).toBe(true)
  })

  it('cuts the page into rows at its headings, with the text in one cell and the code in the other', async () => {
    const { html, result } = await render(PAGE, true)
    const rows = html.split('<div class="sb-split">').slice(1)
    expect(rows).toHaveLength(3)
    // Text before the first heading is a row of its own, with no code cell.
    expect(rows[0]).toContain('<div class="sb-split-prose"><p>Opening words.</p>')
    expect(rows[0]).not.toContain('sb-split-code')
    // In a row, the text stays together and the code goes beside it, whatever order they were written in.
    expect(rows[1]).toMatch(/<div class="sb-split-prose"><h2 id="request">Request<\/h2>\s*<p>Send it like this\.<\/p>\s*<p>And mind the limit\.<\/p>\s*<\/div><div class="sb-split-code"><pre/)
    expect(rows[2]).toContain('<h2 id="response">Response</h2>')
    // The outline and what is searched are read before the rows are made, and are what they were.
    expect(result.toc.map((entry) => entry.id)).toEqual(['request', 'response'])
    expect(result.sections.map((section) => section.heading)).toEqual(['', 'Request', 'Response'])
  })

  it('leaves alone a page of another layout, and a page with no code at all', async () => {
    expect((await render(PAGE, false)).html).not.toContain('sb-split')
    expect((await render('Words.\n\n## More\n\nMore words.\n', true)).html).not.toContain('sb-split')
  })

  it('keeps the imports and exports of an MDX page where MDX needs them', async () => {
    const { html } = await render('export const name = "ping"\n\n## Request\n\nCall {name}.\n\n```sh\ncurl x\n```\n', true, 'mdx')
    expect(html).toContain('<p>Call ping.</p>')
    expect(html).toContain('<div class="sb-split-code">')
  })

  it('is decided by the layout a page names, or by the default one', async () => {
    const dir = await site({
      'shabd.config.yaml': 'site:\n  title: Docs\n',
      'content/index.md': '# Home\n\n```sh\nls\n```\n',
      'content/ping.md': '---\ntitle: Ping\nlayout: api\napi: { method: GET, path: /ping }\n---\n\nCall it.\n\n```sh\ncurl x\n```\n',
    })
    const context = await createContext(dir, { dev: false })
    const compiled = async (route: string) => renderCompiled((await compilePage(context, context.store.byPath(route)!)).code)
    expect(await compiled('/ping')).toContain('sb-split-code')
    expect(await compiled('/')).not.toContain('sb-split')
  })
})
