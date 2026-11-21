/** A site with more than one sidebar: each part of the site has its own. */
import { describe, expect, it } from 'vitest'
import { parseSidebar } from '../src/node/config/load.js'
import { resolveSidebars, type SidebarPageInfo } from '../src/node/content/sidebar.js'
import { createContext } from '../src/node/context.js'
import { renderLlmsTxt } from '../src/node/llms/llms-txt.js'
import { fileToSlug, slugToPath } from '../src/shared/paths.js'
import { FrontmatterSchema, type FrontmatterInput } from '../src/shared/schema.js'
import { flattenSidebar, sidebarFor } from '../src/shared/sidebar.js'
import type { SidebarNode } from '../src/shared/types.js'
import { KEYWORD_SEARCH, temporaryBuilds } from './helpers/build.js'
import { failure, temporarySites } from './helpers/site.js'

const site = temporarySites()
const build = temporaryBuilds()

function pages(files: Record<string, FrontmatterInput>): SidebarPageInfo[] {
  return Object.entries(files).map(([file, frontmatter]) => {
    const slug = fileToSlug(file)
    const parsed = FrontmatterSchema.parse(frontmatter)
    return { slug, path: slugToPath(slug), title: parsed.title ?? slug, isIndex: /(^|\/)index\.mdx?$/.test(file), sidebar: parsed.sidebar }
  })
}

const labels = (nodes: SidebarNode[]): string[] =>
  nodes.flatMap((node) => (node.type === 'group' ? [`${node.label}:`, ...labels(node.items).map((label) => `  ${label}`)] : [node.label]))

const content = pages({
  'index.md': { title: 'Home' },
  'about.md': { title: 'About' },
  'guide/intro.md': { title: 'Intro' },
  'guide/install.md': { title: 'Install' },
  'guide/advanced/tuning.md': { title: 'Tuning' },
  'reference/cli.md': { title: 'CLI' },
  'reference/config.md': { title: 'Config' },
  'blog/hello.md': { title: 'Hello' },
})

describe('several sidebars', () => {
  it('are one sidebar when the file is a list, as before', () => {
    const one = resolveSidebars(['guide/intro'], content)
    expect(one.sections).toEqual([])
    expect(one.all).toBe(one.sidebar)
    expect(labels(one.sidebar)[0]).toBe('Intro')
  })

  const several = resolveSidebars(
    {
      '/guide/': ['guide/intro', { folder: 'More', items: ['guide/install'] }],
      '/reference': [{ category: 'Reference', autogenerate: 'reference' }],
    },
    content,
  )

  it('give each part of the site its own, and the rest of the site one made from its folders', () => {
    expect(several.sections.map((section) => section.prefix)).toEqual(['/reference', '/guide'])
    const guide = sidebarFor({ sidebar: several.sidebar, sidebars: several.sections }, '/guide/install')
    // A folder under /guide that the list does not mention is added to the guide's sidebar, and to no other.
    expect(labels(guide)).toEqual(['Intro', 'More:', '  Install', 'Guide / Advanced:', '  Tuning'])
    expect(labels(sidebarFor({ sidebar: several.sidebar, sidebars: several.sections }, '/reference/cli'))).toEqual(['Reference:', '  CLI', '  Config'])
    // A page under neither has the sidebar of the rest of the site.
    expect(labels(sidebarFor({ sidebar: several.sidebar, sidebars: several.sections }, '/about'))).toEqual(['About', 'Blog:', '  Hello'])
    expect(sidebarFor({ sidebar: several.sidebar, sidebars: several.sections }, '/guidebook')).toBe(several.sidebar)
  })

  it('keep previous and next inside the part of the site a page is in', () => {
    const guide = flattenSidebar(sidebarFor({ sidebar: several.sidebar, sidebars: several.sections }, '/guide/intro'))
    expect(guide.map((page) => page.path)).toEqual(['/guide/intro', '/guide/install', '/guide/advanced/tuning'])
  })

  it('hold every page once between them, in the order of the file', () => {
    expect(flattenSidebar(several.all).map((page) => page.path)).toEqual([
      '/guide/intro',
      '/guide/install',
      '/guide/advanced/tuning',
      '/reference/cli',
      '/reference/config',
      '/about',
      '/blog/hello',
    ])
    expect(several.unlisted).toEqual([])
  })

  it('take `/` as the sidebar of everything that is under no other', () => {
    const { sidebar, sections, unlisted } = resolveSidebars({ '/': ['about'], '/guide': ['guide/intro'] }, content)
    expect(sections.map((section) => section.prefix)).toEqual(['/guide'])
    // The folders that belong to no part are added to it; the guide's are not.
    expect(labels(sidebar)).toEqual(['About', 'Blog:', '  Hello', 'Reference:', '  CLI', '  Config'])
    // A page of the guide that the guide's sidebar leaves out is reported once, by the sidebar it belongs to.
    expect(unlisted).toEqual(['guide/install'])
  })

  it('say where in the file a problem is, and warn about a sidebar for a part with no pages', () => {
    const { warnings } = resolveSidebars({ '/guide/': ['guide/intro', 'guide/nope'], '/api/': ['about'] }, content)
    expect(warnings).toEqual([
      { message: '"guide/nope" does not match any page in the content directory', path: ['/guide/', 1] },
      { message: 'No page is under /api, so this sidebar is never shown', path: ['/api/'] },
    ])
  })

  it('are refused when a key is not a part of the site', () => {
    const error = failure(() => parseSidebar('/site/sidebar.yaml', 'guide:\n  - guide/intro\n'))
    expect(error.issues[0]).toMatchObject({ path: ['guide'], line: 1 })
    expect(error.issues[0]?.message).toContain('A sidebar is named by the part of the site it belongs to')
  })

  it('reach llms.txt as one list of every part, and the built pages as the sidebar of their part', async () => {
    const files = {
      'shabd.config.yaml': `site:\n  title: Docs\n${KEYWORD_SEARCH}`,
      'sidebar.yaml': '/guide/:\n  - category: Guide\n    items: [guide/intro, guide/install]\n/reference/:\n  - category: Reference\n    items: [reference/cli]\n',
      'content/index.md': '# Home\n',
      'content/guide/intro.md': '# Intro\n',
      'content/guide/install.md': '# Install\n',
      'content/reference/cli.md': '# CLI\n',
    }
    const context = await createContext(await site(files), { dev: false })
    const llms = renderLlmsTxt(context)
    expect(llms.indexOf('## Guide')).toBeGreaterThan(0)
    expect(llms.indexOf('## Reference')).toBeGreaterThan(llms.indexOf('## Guide'))

    const built = await build(files)
    const navigation = (html: string) => [...html.matchAll(/class="sb-nav-link" href="([^"]+)"/g)].map((match) => match[1])
    expect(navigation(await built.read('guide/intro/index.html'))).toEqual(['/guide/intro', '/guide/install'])
    expect(navigation(await built.read('reference/cli/index.html'))).toEqual(['/reference/cli'])
    // Next from the last page of the guide is not the first page of the reference.
    expect(await built.read('guide/install/index.html')).not.toContain('rel="next"')
    expect(await built.read('guide/intro/index.html')).toContain('rel="next" href="/guide/install"')
  })
})
