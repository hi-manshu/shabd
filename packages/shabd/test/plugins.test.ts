/** The site's own remark and rehype plugins, and maths. */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isShabdError, type ShabdError } from '../src/node/config/errors.js'
import { compilePage, createContext } from '../src/node/context.js'
import { KEYWORD_SEARCH, temporaryBuilds } from './helpers/build.js'
import { renderCompiled } from './helpers/render.js'
import { temporarySites } from './helpers/site.js'

const site = temporarySites()
const build = temporaryBuilds()

async function rejection(run: () => Promise<unknown>): Promise<ShabdError> {
  try {
    await run()
  } catch (error) {
    if (isShabdError(error)) return error
    throw error
  }
  throw new Error('expected a ShabdError')
}

/** Compile one page of a site and render it. */
async function page(files: Record<string, string>, route = '/') {
  const context = await createContext(await site(files), { dev: false })
  const compiled = await compilePage(context, context.store.byPath(route)!)
  return { compiled, html: await renderCompiled(compiled.code) }
}

/** A remark plugin that sets prose in capitals, or in whatever its options say. */
const SHOUT = `
export default function shout(options = {}) {
  const change = options.lower ? (text) => text.toLowerCase() : (text) => text.toUpperCase()
  const walk = (node) => {
    if (node.type === 'text') node.value = change(node.value)
    for (const child of node.children ?? []) walk(child)
  }
  return (tree) => walk(tree)
}
`

/** A rehype plugin that marks every paragraph. */
const MARK = `
export default function mark() {
  const walk = (node) => {
    if (node.tagName === 'p') node.properties = { ...node.properties, 'data-marked': '' }
    for (const child of node.children ?? []) walk(child)
  }
  return (tree) => walk(tree)
}
`

describe('the site\'s own plugins', () => {
  it('are named in the config, with options, and run after Shabd\'s own', async () => {
    const { html, compiled } = await page({
      'shabd.config.yaml': `site:
  title: Docs
markdown:
  remarkPlugins:
    - ./plugins/shout.mjs
    - remark-gfm
  rehypePlugins:
    - ./plugins/mark.mjs
`,
      'plugins/shout.mjs': SHOUT,
      'plugins/mark.mjs': MARK,
      'content/index.md': '# Home\n\nQuiet words.\n\n> [!NOTE]\n> A note.\n',
    })
    expect(html).toContain('<p data-marked="">QUIET WORDS.</p>')
    // The callout was already made when the plugin ran: its marker is not there to be shouted.
    expect(html).toContain('data-callout="note"')
    // What is searched is the page as its author wrote it.
    expect(compiled.sections.map((section) => section.text).join(' ')).toContain('QUIET WORDS.')
  })

  it('take the options written beside their name', async () => {
    const { html } = await page({
      'shabd.config.yaml': 'site:\n  title: Docs\nmarkdown:\n  remarkPlugins:\n    - [./plugins/shout.mjs, { lower: true }]\n',
      'plugins/shout.mjs': SHOUT,
      'content/index.md': '# Home\n\nLOUD Words.\n',
    })
    expect(html).toContain('<p>loud words.</p>')
  })

  it('are refused on their line when they cannot be found or are not plugins', async () => {
    const config = (plugin: string) => `site:\n  title: Docs\nmarkdown:\n  remarkPlugins:\n    - remark-gfm\n    - ${plugin}\n`
    const files = (plugin: string) => ({
      'shabd.config.yaml': config(plugin),
      'plugins/not-a-plugin.mjs': 'export const name = "nothing"\n',
      'content/index.md': '# Home\n',
    })
    const load = async (plugin: string) => createContext(await site(files(plugin)), { dev: false })

    const missing = await rejection(() => load('remark-does-not-exist'))
    expect(missing.issues[0]).toMatchObject({ path: ['markdown', 'remarkPlugins', 1], line: 6 })
    expect(missing.issues[0]?.message).toBe('The plugin "remark-does-not-exist" is not installed. Install it in the site: npm install remark-does-not-exist')

    const noFile = await rejection(() => load('./plugins/gone.mjs'))
    expect(noFile.issues[0]?.message).toContain('File not found: ./plugins/gone.mjs')

    const notOne = await rejection(() => load('./plugins/not-a-plugin.mjs'))
    expect(notOne.issues[0]?.message).toContain('does not export a plugin')
  })
})

describe('diagrams', () => {
  const DIAGRAM = '# Home\n\n```mermaid\nflowchart LR\n  a --> b\n```\n'

  it('hand a mermaid fence to the component that draws it, with the source of the diagram', async () => {
    const { html, compiled } = await page({ 'shabd.config.yaml': 'site:\n  title: Docs\nmarkdown:\n  mermaid: true\n', 'content/index.md': DIAGRAM })
    expect(html).toContain('<div data-mermaid="">flowchart LR\n  a --&gt; b</div>')
    expect(html).not.toContain('data-lang="mermaid"')
    // The source is what search and agents get: there is no drawing until a browser makes one.
    expect(compiled.sections.map((section) => section.text).join(' ')).toContain('flowchart LR')
  })

  it('are ordinary code on a site that has not asked for them', async () => {
    const { html } = await page({ 'shabd.config.yaml': 'site:\n  title: Docs\n', 'content/index.md': DIAGRAM })
    expect(html).toContain('data-lang="mermaid"')
    expect(html).not.toContain('data-mermaid')
  })
})

describe('maths', () => {
  const CONFIG = 'site:\n  title: Docs\nmarkdown:\n  math: true\n'

  it('is typeset between dollar signs, in a line and on a line of its own', async () => {
    const { html, compiled } = await page({
      'shabd.config.yaml': CONFIG,
      'content/index.md': '# Home\n\nPythagoras: $a^2 + b^2 = c^2$.\n\n$$\n\\int_0^1 x\\,dx\n$$\n\n```math\nE = mc^2\n```\n',
    })
    expect(html).toContain('<span class="katex">')
    expect(html.match(/class="katex-display"/g)).toHaveLength(2)
    // Screen readers are given MathML, beside the HTML that sighted readers see.
    expect(html).toContain('<math xmlns="http://www.w3.org/1998/Math/MathML"')
    // Maths is not code: no code block is drawn around it.
    expect(html).not.toContain('data-lang="math"')
    // What is searched is what the author typed, once, not the markup it became.
    const text = compiled.sections.map((section) => section.text).join(' ')
    expect(text).toContain('a^2 + b^2 = c^2')
    expect(text.match(/a\^2/g)).toHaveLength(1)
  })

  it('reports maths it cannot read, with its line, where KaTeX would leave it on the page in red', async () => {
    const dir = await site({ 'shabd.config.yaml': CONFIG, 'content/index.md': '# Home\n\nBroken: $\\frac{1$ here.\n' })
    const context = await createContext(dir, { dev: false })
    const error = await rejection(() => compilePage(context, context.store.byPath('/')!))
    expect(error.issues[0]).toMatchObject({ line: 3, column: 9 })
    expect(error.issues[0]?.message).toMatch(/^This maths could not be typeset\. Unexpected end of input/)
  })

  it('leaves dollar signs alone on a site that has not asked for it', async () => {
    const { html } = await page({ 'shabd.config.yaml': 'site:\n  title: Docs\n', 'content/index.md': '# Home\n\nFrom $5 to $10.\n' })
    expect(html).toContain('<p>From $5 to $10.</p>')
  })

  it('brings its stylesheet and fonts into a build, and only into a build that typesets maths', async () => {
    const stylesOf = async (dir: string) => {
      const assets = path.join(dir, 'dist', 'assets')
      const files = await readdir(assets)
      const css = await Promise.all(files.filter((file) => file.endsWith('.css')).map((file) => readFile(path.join(assets, file), 'utf8')))
      return { css: css.join('\n'), fonts: files.filter((file) => /^KaTeX_.*\.woff2$/.test(file)).length }
    }
    const pages = { 'content/index.md': '# Home\n\nPythagoras: $a^2 + b^2 = c^2$.\n' }

    const withMaths = await build({ 'shabd.config.yaml': CONFIG + KEYWORD_SEARCH, ...pages })
    expect(await withMaths.read('index.html')).toContain('<span class="katex">')
    const styled = await stylesOf(withMaths.dir)
    // KaTeX's own rules name its fonts. Shabd's stylesheet has one rule about maths, and names none.
    expect(styled.css).toContain('KaTeX_Main')
    expect(styled.fonts).toBeGreaterThan(0)

    const without = await build({ 'shabd.config.yaml': `site:\n  title: Docs\n${KEYWORD_SEARCH}`, ...pages })
    const plain = await stylesOf(without.dir)
    expect(plain.css).not.toContain('KaTeX_Main')
    expect(plain.fonts).toBe(0)
  })
})
