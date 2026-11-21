/**
 * Isolated snippets: the word in a fence, the script that is built for their
 * frames, and which sites carry it. What happens in a frame is tried in real
 * browsers, in e2e/sandbox-frame.spec.ts.
 */
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { frameDocument, FROM_FRAME, FROM_PAGE } from '../src/client/sandbox/frame/protocol.js'
import { resolveConfig } from '../src/node/config/load.js'
import { MarkdownCompiler } from '../src/node/markdown/compile.js'
import { buildFrameRuntime, FRAME_BANNER } from '../src/node/sandbox/frame.js'
import { KEYWORD_SEARCH, temporaryBuilds } from './helpers/build.js'

describe('a live fence that says isolated', () => {
  const compiler = new MarkdownCompiler({ themes: { light: 'github-light', dark: 'tokyo-night' }, sandbox: true, fingerprint: 'frame' })
  const compile = (source: string) => compiler.compile({ file: '/site/content/page.md', id: 'page.md', routePath: '/page', format: 'md', source })

  it('is a sandbox that is told so, and the page keeps a note of it', async () => {
    const { code, snippets } = await compile('```tsx live isolated title="Apart"\n<b>Hi</b>\n```\n\n```tsx live\n<i>Hi</i>\n```\n')
    expect(snippets).toEqual([
      { code: '<b>Hi</b>', line: 1, isolated: true },
      { code: '<i>Hi</i>', line: 5 },
    ])
    // The first sandbox has the word, and the second does not.
    expect(code.match(/isolated: true/g)).toHaveLength(1)
    expect(code.indexOf('isolated: true')).toBeLessThan(code.indexOf('<i>Hi</i>'))
  })

  it('is only a word on a fence that is not live', async () => {
    const { code, snippets } = await compile('```tsx isolated\n<b>Hi</b>\n```\n')
    expect(snippets).toEqual([])
    expect(code).not.toContain('isolated')
  })
})

describe('the document of a frame', () => {
  it('asks the page for its script, and runs only what the page it is in sends', () => {
    const html = frameDocument('https://docs.example.com/guide/"quoted"/?a=1&b=<2>', 'en')
    // Where addresses are read from, written so that it cannot end the attribute or start a tag.
    expect(html).toContain('<base href="https://docs.example.com/guide/&quot;quoted&quot;/?a=1&amp;b=&lt;2>">')
    expect(html).toContain('<div id="root"></div>')
    expect(html).toContain(`e.source!==parent`)
    expect(html).toContain(JSON.stringify(FROM_PAGE))
    expect(html).toContain(`parent.postMessage({shabd:${JSON.stringify(FROM_FRAME)},type:"boot"},"*")`)
    // Nothing of the site is in it: no script of the site's, no stylesheet, no address but the base.
    expect(html.match(/<script/g)).toHaveLength(1)
    expect(html).not.toContain('src=')
    expect(html).not.toContain('<link')
  })
})

describe('the script for frames', () => {
  const buildSite = temporaryBuilds()

  const SITE = {
    'shabd.config.yaml': `site:\n  title: Docs\n${KEYWORD_SEARCH}  sandbox:\n    modules:\n      - github-slugger\n      - { name: site/gauge, file: ./components/gauge.tsx }\n`,
    // A file of the site's that uses the shared state, as a component of a page would.
    'components/gauge.tsx':
      "import { useShared } from '@himanshoe/shabd/client'\nimport './gauge.css'\n\nexport default function Gauge() {\n  const [level] = useShared('level', 3)\n  return <output data-gauge=\"the-gauge-of-this-site\">{level}</output>\n}\n",
    'components/gauge.css': '[data-gauge] { --the-gauge-mark: 1; }\n',
    'content/index.mdx': "# Home\n\n```tsx live\n<b>In the page</b>\n```\n",
  }
  /** How the script begins. The page's own code speaks to a frame, and never says this. */
  const SCRIPT = FRAME_BANNER.slice(3, -3)
  const ISOLATED = "# Apart\n\n```tsx live isolated\nimport Gauge from 'site/gauge'\nexport default () => <Gauge />\n```\n"

  const scriptsHolding = async (built: Awaited<ReturnType<typeof buildSite>>, text: string) => {
    const dist = path.join(built.dir, 'dist')
    const scripts = (await readdir(dist, { recursive: true })).filter((file) => file.endsWith('.js')).map((file) => file.split(path.sep).join('/'))
    const found: string[] = []
    for (const file of scripts) if ((await built.read(file)).includes(text)) found.push(file)
    return found
  }

  it('is one piece of text with React, the modules the site names and their styles in it', async () => {
    const built = await buildSite(SITE)
    const config = resolveConfig(built.dir, path.join(built.dir, 'shabd.config.yaml'), SITE['shabd.config.yaml'])
    const { code, files } = await buildFrameRuntime(config, false)

    // Nothing is left to fetch: no import, and no address of a file of the build.
    expect(code).not.toMatch(/\bimport\s*\(/)
    expect(code).not.toMatch(/\bfrom\s*["']/)
    expect(code).not.toContain('/assets/')
    // The file of the site's, the package, and the stylesheet the file imports.
    expect(code).toContain('the-gauge-of-this-site')
    expect(code).toContain('occurrences')
    expect(code).toContain('--the-gauge-mark')
    // What the frame says to the page, and what it listens for.
    expect(code).toContain(SCRIPT)
    expect(code).toContain(FROM_FRAME)
    expect(code).toContain(FROM_PAGE)
    // Not the app: no router, no site data, no compiler for snippets.
    expect(code).not.toContain('sb-sandbox-editor')
    expect(code).not.toContain('virtual:shabd')
    expect(code).not.toContain('sucrase')
    // A build's script is the small one. React's development build says so of itself.
    expect(code).not.toContain('react-dom-client.development')

    // The files of the site that are in it: a change to one makes the dev server build it again.
    expect(files.map((file) => path.relative(built.dir, file)).filter((file) => !file.startsWith('..'))).toEqual(
      expect.arrayContaining([path.join('components', 'gauge.tsx')]),
    )
    expect(files.some((file) => file.includes('node_modules'))).toBe(false)
    // Nor the file the build starts from, which is written here. The dev server took its writing for
    // a change to the site and started the page again, which asked for the script again.
    expect(files.some((file) => file.includes('sandbox-frame-entry'))).toBe(false)
    expect((await buildFrameRuntime(config, false)).code).toBe(code)
  })

  it('is in the build of a site that has an isolated snippet, apart from every page, and in no other', async () => {
    const without = await buildSite(SITE)
    // The page's own copy of the gauge is there, for the snippet that runs in the page. The frame's script is not.
    expect(await scriptsHolding(without, SCRIPT)).toEqual([])

    const withOne = await buildSite({ ...SITE, 'content/apart.mdx': ISOLATED })
    const holding = await scriptsHolding(withOne, SCRIPT)
    expect(holding).toHaveLength(1)
    // It is text in a file of its own, which no page names: a page asks for it when it shows such a snippet.
    const name = path.posix.basename(holding[0]!)
    expect(await withOne.read('index.html')).not.toContain(name)
    expect(await withOne.read('apart/index.html')).not.toContain(name)
    // The snippet is written in the page as it is, for the frame to be sent.
    expect(await withOne.read('apart/index.html')).not.toContain('<iframe')
  })

  it('is not built for a site that has sandboxes off', async () => {
    const off = await buildSite({ ...SITE, 'shabd.config.yaml': `site:\n  title: Docs\n${KEYWORD_SEARCH}  sandbox: false\n`, 'content/apart.mdx': ISOLATED })
    expect(await scriptsHolding(off, SCRIPT)).toEqual([])
    expect(await off.read('apart/index.html')).toContain('site/gauge')
  })
})
