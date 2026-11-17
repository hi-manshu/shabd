/** What other sites show when a page is shared: the tags, and the pictures a build can draw. */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderDocument } from '../src/node/build/html.js'
import { resolveConfig } from '../src/node/config/load.js'
import { cardSvg, wrapText, type CardInput, type Measure } from '../src/node/social/card.js'
import { cardColors } from '../src/node/social/index.js'
import { loadRenderer, systemFonts } from '../src/node/social/render.js'
import { KEYWORD_SEARCH, temporaryBuilds } from './helpers/build.js'
import { failure } from './helpers/site.js'

const build = temporaryBuilds()
const load = (yaml: string) => resolveConfig('/site', '/site/shabd.config.yaml', yaml)

// Drawing a picture for real needs resvg and a font this machine has. Where either is missing there is nothing to
// draw with, and the test that does is skipped.
const canDraw = systemFonts().length > 0 && (await loadRenderer(process.cwd(), [])).renderer !== undefined

describe('a shared page', () => {
  const head = (yaml: string, image?: string) =>
    renderDocument({ config: load(yaml).config, title: 'Guide', description: 'How to.', path: '/guide', image })

  it('names the site, and is a line of text when it has no picture', () => {
    const html = head('site:\n  title: Docs\n  url: https://docs.example\n')
    expect(html).toContain('<meta property="og:site_name" content="Docs">')
    expect(html).toContain('<meta name="twitter:card" content="summary">')
    expect(html).not.toContain('og:image')
  })

  it('shows the site\'s picture, or the page\'s own, by its full address', () => {
    const site = 'site:\n  title: Docs\n  url: https://docs.example\n  base: /docs/\n  image: /social.png\n'
    expect(head(site)).toContain('<meta property="og:image" content="https://docs.example/docs/social.png">')
    expect(head(site)).toContain('<meta name="twitter:card" content="summary_large_image">')
    expect(head(site, '/covers/guide.png')).toContain('<meta property="og:image" content="https://docs.example/docs/covers/guide.png">')
    expect(head(site, 'https://cdn.example/guide.png')).toContain('<meta property="og:image" content="https://cdn.example/guide.png">')
  })

  it('leaves a picture out when it cannot say where the site lives', () => {
    // The sites that show a picture fetch it from outside: a bare path is no use to them.
    expect(head('site:\n  title: Docs\n  image: /social.png\n')).not.toContain('og:image')
    expect(head('site:\n  title: Docs\n', 'https://cdn.example/guide.png')).toContain('content="https://cdn.example/guide.png"')
  })
})

describe('social pictures', () => {
  /** A font in which every character is half as wide as it is tall. */
  const measure: Measure = (text, size) => text.length * size * 0.5
  const card = (input: Partial<CardInput>) =>
    cardSvg(
      {
        title: 'Installation',
        description: 'Create a site and run it.',
        site: 'Acme docs',
        host: 'docs.example',
        colors: { background: '#ffffff', text: '#111111', muted: '#555555', bar: '#111111', highlight: '#f6b40e' },
        bars: true,
        ...input,
      },
      measure,
    )

  it('breaks text into lines that fit, and ends with an ellipsis what does not', () => {
    const widthOf = (text: string) => text.length * 10
    expect(wrapText('one two three four', 80, 3, widthOf)).toMatchObject({ lines: ['one two', 'three', 'four'], cut: false, overflows: false })
    expect(wrapText('one two three four five six', 80, 2, widthOf)).toMatchObject({ lines: ['one two', 'three…'], cut: true })
    expect(wrapText('incomprehensibilities', 80, 3, widthOf).overflows).toBe(true)
    expect(wrapText('', 80, 3, widthOf)).toEqual({ lines: [], width: 0, cut: false, overflows: false })
    // A word wider than a line can be cut into pieces that fit: a long identifier, or text written without spaces.
    expect(wrapText('an incomprehensibilities', 80, 4, widthOf, true)).toMatchObject({
      lines: ['an', 'incompre', 'hensibil', 'ities'],
      overflows: false,
    })
    expect(wrapText('文档站点的安装与配置指南', 80, 3, widthOf, true).lines).toEqual(['文档站点的安装与', '配置指南'])
  })

  it('hangs the title from a bar as wide as its words, and sets a long title smaller', () => {
    const short = card({})
    // "Installation" is 12 characters at 76: 456 wide.
    expect(short).toContain('<rect x="80" y="80" width="456" height="14" fill="#111111"/>')
    expect(short).toContain('font-size="76" font-weight="700" fill="#111111" text-anchor="start">Installation</text>')
    expect(short).toContain('text-anchor="end">docs.example</text>')

    const long = card({ title: 'A much longer title that goes on about several things at once and then some more' })
    // At 76 it would take four lines. At 64 it takes three, and that is the largest size at which it fits.
    expect(long).not.toContain('font-size="76"')
    expect(long.match(/font-size="64"/g)).toHaveLength(3)

    const plain = card({ bars: false })
    expect(plain).not.toContain('height="14"')
  })

  it('escapes what a title may hold, and draws no line for a description that is not there', () => {
    const svg = card({ title: 'Tabs & <Cards>', description: '' })
    expect(svg).toContain('>Tabs &amp; &lt;Cards&gt;</text>')
    expect(svg).not.toContain('font-size="34"')
  })

  it('takes the site\'s light colours, and a plain one for a colour it cannot read', () => {
    const theme = (yaml: string) => load(`site:\n  title: Docs\ntheme:\n${yaml}`).config.theme
    expect(cardColors(theme('  colors:\n    background: "#fdf6e3"\n    text: { light: "rgb(10 20 30)", dark: "#fff" }\n    bar: "#cb4b16"\n'))).toMatchObject({
      background: '#fdf6e3',
      text: '#0a141e',
      bar: '#cb4b16',
    })
    expect(cardColors(theme('  colors:\n    text: "oklch(20% 0.02 260)"\n')).text).toBe('#111111')
  })

  it('needs the address of the site, and a font file it can read', () => {
    const noUrl = failure(() => load('site:\n  title: Docs\nfeatures:\n  socialImages: true\n'))
    expect(noUrl.issues[0]).toMatchObject({ path: ['features', 'socialImages'], line: 4 })

    const webFont = failure(() =>
      load('site:\n  title: Docs\n  url: https://docs.example\nfeatures:\n  socialImages:\n    font: ./fonts/body.woff2\n'),
    )
    expect(webFont.issues[0]).toMatchObject({ path: ['features', 'socialImages', 'font', 0], line: 6 })
    expect(webFont.issues[0]?.message).toContain('web fonts (.woff2) cannot be read')

    const missing = failure(() =>
      load('site:\n  title: Docs\n  url: https://docs.example\nfeatures:\n  socialImages:\n    font: [./a.ttf, ./b.ttf]\n'),
    )
    expect(missing.issues.map((issue) => issue.message)).toEqual([
      'File not found: ./a.ttf (looked in /site/a.ttf)',
      'File not found: ./b.ttf (looked in /site/b.ttf)',
    ])
  })

  it.skipIf(!canDraw)('are drawn by a build, one for each page that has none of its own, and kept for the next build', async () => {
    const built = await build({
      'shabd.config.yaml': `site:\n  title: Acme docs\n  url: https://docs.example\nfeatures:\n  socialImages: true\n${KEYWORD_SEARCH.replace('features:\n', '')}`,
      'content/index.md': '# Home\n',
      'content/guide/install.md': '---\ntitle: Installation\ndescription: Create a site and run it.\n---\n\nText.\n',
      'content/guide/own.md': '---\ntitle: With a picture\nimage: /covers/own.png\n---\n\nText.\n',
    })
    expect(built.output).toContain('2 social pictures, 2 newly drawn')

    const png = await readFile(path.join(built.dir, 'dist', '_shabd/social/guide/install.png'))
    // A PNG says so in its first bytes, and its width and height follow as two big-endian numbers.
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630])
    expect(png.length).toBeGreaterThan(2000)

    expect(await built.read('guide/install/index.html')).toContain(
      '<meta property="og:image" content="https://docs.example/_shabd/social/guide/install.png">',
    )
    expect(await built.read('index.html')).toContain('content="https://docs.example/_shabd/social/index.png"')
    // A page that names a picture keeps it, and none is drawn for it.
    expect(await built.read('guide/own/index.html')).toContain('<meta property="og:image" content="https://docs.example/covers/own.png">')
    expect(built.has('_shabd/social/guide/own.png')).toBe(false)

    expect(await built.rebuild()).toContain('2 social pictures, 0 newly drawn')
  })
})
