import { describe, expect, it } from 'vitest'
import { resolveSidebar, type SidebarPageInfo } from '../src/node/content/sidebar.js'
import { fileToSlug, slugToPath } from '../src/shared/paths.js'
import { FrontmatterSchema, type FrontmatterInput, type SidebarInput } from '../src/shared/schema.js'
import type { SidebarNode } from '../src/shared/types.js'

/** Build page infos from `file: frontmatter` pairs. */
function pages(files: Record<string, FrontmatterInput>): SidebarPageInfo[] {
  return Object.entries(files).map(([file, frontmatter]) => {
    const slug = fileToSlug(file)
    const parsed = FrontmatterSchema.parse(frontmatter)
    return {
      slug,
      path: slugToPath(slug),
      title: parsed.title ?? slug,
      isIndex: /(^|\/)index\.mdx?$/.test(file),
      sidebar: parsed.sidebar,
    }
  })
}

/** Compact rendering of a tree, for readable assertions. */
function outline(nodes: SidebarNode[], depth = 0): string[] {
  return nodes.flatMap((node) => {
    const pad = '  '.repeat(depth)
    if (node.type === 'group') {
      const flags = [node.kind, node.auto ? 'auto' : '', node.collapsed ? 'collapsed' : ''].filter(Boolean).join(' ')
      return [`${pad}${node.label} (${flags})`, ...outline(node.items, depth + 1)]
    }
    const badge = node.badge ? ` [${node.badge.text}:${node.badge.variant}]` : ''
    return [`${pad}${node.label} → ${node.type === 'page' ? node.path : node.href}${badge}`]
  })
}

const content = pages({
  'index.mdx': { title: 'Home' },
  'guide/introduction.md': { title: 'Introduction' },
  'guide/installation.md': { title: 'Installation' },
  'guide/writing/markdown.md': { title: 'Markdown' },
  'guide/writing/components.mdx': { title: 'Components' },
  'reference/cli.md': { title: 'CLI' },
  'reference/config.md': { title: 'Configuration' },
  'recipes/deploy.md': { title: 'Deploy' },
})

describe('resolveSidebar', () => {
  it('uses explicit entries exactly as written', () => {
    const input: SidebarInput = [
      {
        category: 'Guide',
        items: [
          'guide/introduction',
          { file: 'guide/installation.md', label: 'Install', badge: 'New' },
          {
            folder: 'Writing',
            collapsed: true,
            items: ['guide/writing/markdown', { file: '/guide/writing/components', badge: { text: 'Beta' } }],
          },
          { link: 'https://example.com', label: 'Example' },
        ],
      },
      { category: 'Reference', autogenerate: 'reference' },
      { category: 'Recipes', autogenerate: 'recipes' },
    ]
    const { sidebar, warnings, unlisted } = resolveSidebar(input, content)
    expect(outline(sidebar)).toEqual([
      'Guide (category)',
      '  Introduction → /guide/introduction',
      '  Install → /guide/installation [New:success]',
      '  Writing (folder collapsed)',
      '    Markdown → /guide/writing/markdown',
      '    Components → /guide/writing/components [Beta:caution]',
      '  Example → https://example.com',
      'Reference (category)',
      '  CLI → /reference/cli',
      '  Configuration → /reference/config',
      'Recipes (category)',
      '  Deploy → /recipes/deploy',
    ])
    expect(warnings).toEqual([])
    expect(unlisted).toEqual([])
  })

  it('appends folders that sidebar.yaml never mentions, alphabetically', () => {
    const input: SidebarInput = [{ category: 'Guide', items: ['guide/introduction', 'guide/installation'] }]
    const { sidebar } = resolveSidebar(input, content)
    expect(outline(sidebar)).toEqual([
      'Guide (category)',
      '  Introduction → /guide/introduction',
      '  Installation → /guide/installation',
      // `guide/writing` has no entry of its own, though its parent does
      'Guide / Writing (category auto)',
      '  Components → /guide/writing/components',
      '  Markdown → /guide/writing/markdown',
      'Recipes (category auto)',
      '  Deploy → /recipes/deploy',
      'Reference (category auto)',
      '  CLI → /reference/cli',
      '  Configuration → /reference/config',
    ])
  })

  it('does not append a folder that an entry points into', () => {
    const { sidebar, unlisted } = resolveSidebar(
      [{ category: 'Ref', items: ['reference/cli'] }, { category: 'Rest', autogenerate: 'guide' }, 'recipes/deploy'],
      content,
    )
    expect(outline(sidebar)).toEqual([
      'Ref (category)',
      '  CLI → /reference/cli',
      'Rest (category)',
      '  Installation → /guide/installation',
      '  Introduction → /guide/introduction',
      '  Writing (folder auto)',
      '    Components → /guide/writing/components',
      '    Markdown → /guide/writing/markdown',
      'Deploy → /recipes/deploy',
    ])
    // Listed folders are curated by hand, so a page left out of one is reported, not added.
    expect(unlisted).toEqual(['reference/config'])
  })

  it('generates the whole tree when there is no sidebar.yaml', () => {
    const { sidebar } = resolveSidebar([], content)
    expect(outline(sidebar)).toEqual([
      'Guide (category auto)',
      '  Installation → /guide/installation',
      '  Introduction → /guide/introduction',
      '  Writing (folder auto)',
      '    Components → /guide/writing/components',
      '    Markdown → /guide/writing/markdown',
      'Recipes (category auto)',
      '  Deploy → /recipes/deploy',
      'Reference (category auto)',
      '  CLI → /reference/cli',
      '  Configuration → /reference/config',
    ])
  })

  it('orders generated groups by index page, then `order`, then label', () => {
    const { sidebar } = resolveSidebar(
      [],
      pages({
        'api/zebra.md': { title: 'Zebra' },
        'api/alpha.md': { title: 'Alpha' },
        'api/index.md': { title: 'Overview' },
        'api/pinned.md': { title: 'Pinned', sidebar: { order: 1 } },
        'api/item-10.md': { title: 'Item 10' },
        'api/item-2.md': { title: 'Item 2' },
        'api/hidden.md': { title: 'Hidden', sidebar: { exclude: true } },
        'api/renamed.md': { title: 'Long title', sidebar: { label: 'Beta', badge: 'Beta' } },
      }),
    )
    expect(outline(sidebar)).toEqual([
      'API (category auto)',
      '  Overview → /api',
      '  Pinned → /api/pinned',
      '  Alpha → /api/alpha',
      '  Beta → /api/renamed [Beta:caution]',
      '  Item 2 → /api/item-2',
      '  Item 10 → /api/item-10',
      '  Zebra → /api/zebra',
    ])
  })

  it('warns about entries that match no page instead of failing', () => {
    const { sidebar, warnings } = resolveSidebar(
      [{ category: 'Guide', items: ['guide/introduction', 'guide/missing'] }, { category: 'Gone', autogenerate: 'nope' }],
      content,
    )
    expect(outline(sidebar).slice(0, 2)).toEqual(['Guide (category)', '  Introduction → /guide/introduction'])
    expect(warnings.map((w) => [w.path?.join('.'), w.message])).toEqual([
      ['0.items.1', '"guide/missing" does not match any page in the content directory'],
      ['1.autogenerate', 'autogenerate: "nope" is not a folder with pages in the content directory'],
      ['1', '"Gone" has no pages and was left out'],
    ])
  })
})
