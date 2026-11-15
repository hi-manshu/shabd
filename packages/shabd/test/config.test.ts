import { describe, expect, it } from 'vitest'
import { isShabdError, type ShabdError } from '../src/node/config/errors.js'
import { parseSidebar, resolveConfig } from '../src/node/config/load.js'
import { themeToCss } from '../src/node/config/theme-css.js'

const load = (yaml: string) => resolveConfig('/site', '/site/shabd.config.yaml', yaml)

function failure(run: () => unknown): ShabdError {
  try {
    run()
  } catch (error) {
    if (isShabdError(error)) return error
    throw error
  }
  throw new Error('expected a ShabdError')
}

describe('shabd.config.yaml', () => {
  it('fills in defaults from a minimal config', () => {
    const { config, layouts } = load('site:\n  title: Docs\n')
    expect(config.site.base).toBe('/')
    expect(config.content.dir).toBe('content')
    expect(config.defaults.layout).toBe('doc')
    expect(config.defaults.toc).toEqual({ minDepth: 2, maxDepth: 3 })
    expect(config.theme.colorMode).toEqual({ default: 'system', toggle: true })
    expect(config.features.search).toMatchObject({ enabled: true, semantic: true })
    expect(Object.keys(layouts).sort()).toEqual(['api', 'base', 'doc', 'splash'])
  })

  it('normalizes shorthands to one canonical shape', () => {
    const { config } = load(`
site:
  title: Docs
  base: docs
  logo: /logo.svg
  repo: https://github.com/acme/docs
  social:
    github: https://github.com/acme
  nav:
    - { label: Guide, link: /guide, badge: New }
theme:
  colors:
    accent: "#ff0000"
features:
  search: false
  mcp: { route: /agents }
`)
    expect(config.site.base).toBe('/docs/')
    expect(config.site.logo).toEqual({ light: '/logo.svg', dark: '/logo.svg', alt: '' })
    expect(config.site.repo).toEqual({ url: 'https://github.com/acme/docs', branch: 'main', dir: '' })
    expect(config.site.social).toEqual([{ icon: 'github', href: 'https://github.com/acme', label: 'github' }])
    expect(config.site.nav[0]?.badge).toEqual({ text: 'New', variant: 'success' })
    expect(config.theme.colors.accent).toEqual({ light: '#ff0000', dark: '#ff0000' })
    expect(config.features.search.enabled).toBe(false)
    expect(config.features.search.model).toBe('Xenova/all-MiniLM-L6-v2')
    expect(config.features.mcp).toEqual({ enabled: true, route: '/agents' })
  })

  it('points at the line and column of a typo and suggests the fix', () => {
    const error = failure(() => load('site:\n  title: Docs\n  descripton: Hello\n'))
    expect(error.issues).toHaveLength(1)
    expect(error.issues[0]).toMatchObject({
      path: ['site', 'descripton'],
      message: 'Unknown key "descripton". Did you mean "description"?',
      line: 3,
      column: 3,
    })
    expect(error.frame).toContain('descripton: Hello')
    expect(error.loc).toEqual({ file: '/site/shabd.config.yaml', line: 3, column: 3 })
  })

  it('reports a missing required key against its parent', () => {
    const error = failure(() => load('site:\n  description: Hello\n'))
    expect(error.issues[0]).toMatchObject({ path: ['site', 'title'], line: 1, column: 1 })
  })

  it('reports every problem at once, in file order', () => {
    const error = failure(() =>
      load('site:\n  title: Docs\ntheme:\n  colorMode:\n    default: night\n  colors:\n    accent: "red; }"\n'),
    )
    expect(error.issues.map((issue) => [issue.line, issue.path.join('.')])).toEqual([
      [5, 'theme.colorMode.default'],
      [7, 'theme.colors.accent'],
    ])
    expect(error.issues[1]?.message).toMatch(/single CSS value/)
  })

  it('reports YAML syntax errors with a position', () => {
    const error = failure(() => load('site:\n  title: "Docs\n'))
    expect(error.issues[0]?.line).toBeGreaterThan(0)
  })

  it('rejects unknown blocks and names the ones that exist', () => {
    const error = failure(() =>
      load('site:\n  title: Docs\nlayouts:\n  doc:\n    regions:\n      aside:\n        - toc\n        - tco\n'),
    )
    expect(error.issues[0]).toMatchObject({ path: ['layouts', 'doc', 'regions', 'aside', 1], line: 8 })
    expect(error.issues[0]?.message).toMatch(/Unknown block "tco"/)
  })

  it('rejects layouts that extend each other in a loop', () => {
    const error = failure(() =>
      load('site:\n  title: Docs\nlayouts:\n  a:\n    extends: b\n  b:\n    extends: a\n'),
    )
    expect(error.issues[0]?.message).toMatch(/loop/)
  })

  it('lets a user layout edit a built-in region by region', () => {
    const { layouts } = load('site:\n  title: Docs\nlayouts:\n  doc:\n    regions:\n      aside: []\n')
    expect(layouts.doc?.regions.aside).toEqual([])
    expect(layouts.doc?.regions.sidebar).toEqual([{ block: 'sidebar-nav', props: {} }])
    expect(layouts.doc?.regions.header?.[0]).toEqual({ block: 'menu-toggle', props: {} })
  })

  it('flattens `extends` for custom layouts', () => {
    const { layouts } = load(`
site: { title: Docs }
layouts:
  changelog:
    extends: doc
    width: wide
    regions:
      aside: []
      main: [page-header, content]
`)
    expect(layouts.changelog).toMatchObject({ name: 'changelog', width: 'wide' })
    expect(layouts.changelog?.regions.main?.map((b) => b.block)).toEqual(['page-header', 'content'])
    expect(layouts.changelog?.regions.sidebar?.map((b) => b.block)).toEqual(['sidebar-nav'])
  })
})

describe('theme tokens', () => {
  it('compiles YAML tokens to CSS custom properties for both colour modes', () => {
    const { config } = load('site: { title: Docs }\ntheme:\n  typography: { scale: 1.25 }\n  colors:\n    accent: { light: "#123456", dark: "#abcdef" }\n')
    const css = themeToCss(config.theme)
    expect(css).toContain('--sb-accent: #123456;')
    expect(css).toMatch(/:root\[data-theme='dark'\] \{[^}]*--sb-accent: #abcdef;/)
    expect(css).toContain('--sb-step-1: 1.250rem;')
    expect(css).toContain('--sb-step-2: 1.563rem;')
  })
})

describe('sidebar.yaml validation', () => {
  it('accepts every entry kind', () => {
    const { input } = parseSidebar(
      '/site/sidebar.yaml',
      `
- guide/intro
- category: Guide
  items:
    - file: guide/install
      badge: New
    - folder: Writing
      collapsed: true
      items: [guide/writing/markdown]
    - link: https://example.com
      label: Example
- category: Reference
  autogenerate: reference
`,
    )
    expect(input).toHaveLength(3)
  })

  it('explains a mistyped key inside a nested entry', () => {
    const error = failure(() =>
      parseSidebar('/site/sidebar.yaml', '- category: Guide\n  items:\n    - file: guide/install\n      bagde: New\n'),
    )
    expect(error.issues).toHaveLength(1)
    expect(error.issues[0]).toMatchObject({
      path: [0, 'items', 0, 'bagde'],
      message: 'Unknown key "bagde". Did you mean "badge"?',
      line: 4,
    })
  })

  it('requires a folder to say where its items come from', () => {
    const error = failure(() => parseSidebar('/site/sidebar.yaml', '- folder: Empty\n'))
    expect(error.issues[0]?.message).toMatch(/either `items` or `autogenerate`/)
  })

  it('only allows categories at the top level', () => {
    const error = failure(() =>
      parseSidebar('/site/sidebar.yaml', '- category: A\n  items:\n    - category: B\n      items: [x]\n'),
    )
    expect(error.issues.length).toBeGreaterThan(0)
  })

  it('treats an empty file as an empty sidebar', () => {
    expect(parseSidebar('/site/sidebar.yaml', '# nothing yet\n').input).toEqual([])
  })
})
