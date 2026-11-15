import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/node/config/load.js'
import { BUILTIN_BLOCKS, BUILTIN_LAYOUTS } from '../src/shared/blocks.js'
import { BUILTIN_LAYOUT_DEFINITIONS, resolveLayouts, resolvePageLayout } from '../src/shared/layout.js'
import { FrontmatterSchema, type FrontmatterInput } from '../src/shared/schema.js'
import { VERSION } from '../src/shared/version.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file: string) => readFileSync(path.join(root, file), 'utf8')

describe('package', () => {
  it('reports the version from package.json', () => {
    expect(VERSION).toBe((JSON.parse(read('package.json')) as { version: string }).version)
  })

  it('keeps the public MCP entry free of Node built-ins, so it can run in an edge function', () => {
    const seen = new Set<string>()
    const builtins: string[] = []
    const visit = (file: string) => {
      if (seen.has(file)) return
      seen.add(file)
      const source = read(file)
      for (const [, specifier] of source.matchAll(/from\s+'([^']+)'/g)) {
        if (specifier!.startsWith('node:')) builtins.push(`${file} imports ${specifier}`)
        else if (specifier!.startsWith('.')) {
          visit(path.join(path.dirname(file), specifier!.replace(/\.js$/, '.ts')))
        }
      }
    }
    visit('src/node/mcp/index.ts')
    expect(builtins).toEqual([])
    expect(seen.size).toBeGreaterThan(4)
  })
})

describe('layouts', () => {
  const { layouts } = resolveLayouts({})
  const site = {
    layouts,
    defaults: { layout: 'doc', toc: { minDepth: 2, maxDepth: 3 }, editLink: true, pagination: true },
  }
  const page = (frontmatter: FrontmatterInput) => FrontmatterSchema.parse(frontmatter)
  const toc = [
    { depth: 2, id: 'a', text: 'A' },
    { depth: 3, id: 'b', text: 'B' },
    { depth: 4, id: 'c', text: 'C' },
  ]
  const blocksOf = (region: { block: string }[] | undefined) => region?.map((ref) => ref.block)

  it('ships every built-in layout, using only blocks that exist', () => {
    expect(Object.keys(BUILTIN_LAYOUT_DEFINITIONS).sort()).toEqual([...BUILTIN_LAYOUTS].sort())
    for (const layout of Object.values(layouts)) {
      for (const region of Object.values(layout.regions)) {
        for (const ref of region) expect(BUILTIN_BLOCKS).toContain(ref.block)
      }
    }
  })

  it('uses the default layout when frontmatter names none', () => {
    const active = resolvePageLayout(site, page({}), toc)
    expect(active.name).toBe('doc')
    expect(Object.keys(active.regions)).toEqual(['header', 'sidebar', 'main', 'aside', 'footer'])
    expect(active.toc.map((entry) => entry.id)).toEqual(['a', 'b'])
  })

  it('switches structure with `layout:`', () => {
    const splash = resolvePageLayout(site, page({ layout: 'splash' }), toc)
    expect(splash.width).toBe('wide')
    expect(Object.keys(splash.regions)).toEqual(['header', 'main', 'footer'])
    expect(blocksOf(splash.regions.main)).toEqual(['hero', 'content'])

    const api = resolvePageLayout(site, page({ layout: 'api', api: { method: 'GET', path: '/ping' } }), toc)
    expect(api.width).toBe('full')
    expect(blocksOf(api.regions.main)).toContain('api-endpoint')
    expect(api.regions.aside).toBeUndefined()
  })

  it('leaves out blocks that have nothing to show, and regions left empty by that', () => {
    // An api page without `api:` frontmatter has no request line to draw.
    expect(blocksOf(resolvePageLayout(site, page({ layout: 'api' }), toc).regions.main)).not.toContain('api-endpoint')

    const { config } = resolveConfig('/site', '/site/shabd.config.yaml', 'site:\n  title: Docs\nfeatures:\n  search: false\n')
    const bare = resolvePageLayout({ ...site, site: config.site, features: config.features }, page({}), toc)
    // No footer text: the footer block goes, and the footer region with it.
    expect(bare.regions.footer).toBeUndefined()
    expect(blocksOf(bare.regions.header)).toEqual(['menu-toggle', 'site-title', 'spacer', 'studio-toggle', 'theme-toggle'])

    const full = resolveConfig(
      '/site',
      '/site/shabd.config.yaml',
      'site:\n  title: Docs\n  footer: MIT\n  nav: [{ label: Guide, link: /guide }]\n  social: { github: https://github.com/a/b }\n',
    ).config
    const rich = resolvePageLayout({ ...site, site: full.site, features: full.features }, page({}), toc)
    expect(blocksOf(rich.regions.footer)).toEqual(['footer'])
    expect(blocksOf(rich.regions.header)).toEqual([
      'menu-toggle',
      'site-title',
      'nav',
      'spacer',
      'search',
      'studio-toggle',
      'social',
      'theme-toggle',
    ])
  })

  it('applies page switches on top of the layout', () => {
    expect(resolvePageLayout(site, page({ sidebar: false }), toc).regions.sidebar).toBeUndefined()
    expect(resolvePageLayout(site, page({ sidebar: { visible: false } }), toc).regions.sidebar).toBeUndefined()
    // Hiding the outline empties the aside, so the region goes with it.
    expect(resolvePageLayout(site, page({ toc: false }), toc).regions.aside).toBeUndefined()
    expect(blocksOf(resolvePageLayout(site, page({ pagination: false }), toc).regions.main)).not.toContain('pagination')
  })

  it('reads the outline depth from frontmatter', () => {
    expect(resolvePageLayout(site, page({ toc: 4 }), toc).toc).toHaveLength(3)
    expect(resolvePageLayout(site, page({ toc: { minDepth: 3 } }), toc).toc.map((e) => e.id)).toEqual(['b'])
    expect(resolvePageLayout(site, page({ toc: { maxDepth: 2 } }), toc).toc.map((e) => e.id)).toEqual(['a'])
    // No headings in range: the outline block is dropped rather than rendered empty.
    expect(resolvePageLayout(site, page({}), []).regions.aside).toBeUndefined()
  })

  it('falls back to the default layout for a name it does not know', () => {
    expect(resolvePageLayout(site, page({ layout: 'missing' }), toc).name).toBe('doc')
  })
})
