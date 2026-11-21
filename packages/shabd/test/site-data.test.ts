/**
 * What every reader is sent of the site, and what comes with a page.
 *
 * The first script used to hold a table of every page: its file, its address,
 * its title and its description. At 5,000 pages that was about half of 2.5 MB
 * that each reader fetched before anything else, and a reader's page needs
 * none of it but its own line. So a page brings its own, and the table is
 * kept for the dev server, where the Studio finds a page by its file.
 */
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createContext } from '../src/node/context.js'
import { pageMeta } from '../src/node/content/store.js'
import { toPageModule } from '../src/node/markdown/page-module.js'
import { KEYWORD_SEARCH, temporaryBuilds } from './helpers/build.js'
import { temporarySites } from './helpers/site.js'

const site = temporarySites()

/** A page that says something no other page says, in its description and in its text. */
const page = (number: number) => `---\ntitle: Page ${number}\ndescription: What only page ${number} is described as.\n---\n\nThe text of page ${number}.\n`
const PAGES = Object.fromEntries(Array.from({ length: 12 }, (_, number) => [`content/guide/page-${number}.md`, page(number)]))

describe('the data of a site', () => {
  it('has the table of pages while the dev server runs, and not in a build', async () => {
    const dir = await site({ 'shabd.config.yaml': 'site:\n  title: Docs\n', ...PAGES })
    const { store } = await createContext(dir, { dev: false })

    const dev = store.siteData({ dev: true })
    expect(Object.keys(dev.pagesInDev ?? {})).toHaveLength(12)
    expect(dev.pagesInDev?.['/guide/page-7']).toEqual({ id: 'guide/page-7.md', path: '/guide/page-7', title: 'Page 7', description: 'What only page 7 is described as.' })

    const built = store.siteData({ dev: false })
    expect(built).not.toHaveProperty('pagesInDev')
    expect(built).not.toHaveProperty('pages')
    // Nothing of a page but its place in the sidebar, which is its title and its address.
    const text = JSON.stringify(built)
    expect(text).not.toContain('described as')
    expect(text).not.toContain('page-7.md')
    expect(text).toContain('"/guide/page-7"')
    expect(text).toContain('Page 7')
  })

  it('comes with each page, in the module the page is', async () => {
    const dir = await site({ 'shabd.config.yaml': 'site:\n  title: Docs\n', ...PAGES })
    const { store } = await createContext(dir, { dev: false })
    const record = store.byPath('/guide/page-7')!
    expect(pageMeta(record)).toEqual({ id: 'guide/page-7.md', path: '/guide/page-7', title: 'Page 7', description: 'What only page 7 is described as.' })

    const nothing = { toc: [], sections: [], links: [], linkLines: [], external: [], unlabelled: [], strays: [], snippets: [], anchors: [], codeCss: '', codeColours: {} }
    const module = toPageModule({ code: 'export default function Page() {}\n', ...nothing }, pageMeta(record), record.frontmatter)
    expect(module).toContain('export const meta = {"id":"guide/page-7.md","path":"/guide/page-7","title":"Page 7","description":"What only page 7 is described as."};')
  })
})

describe('a built site', () => {
  const buildSite = temporaryBuilds()

  it('sends a reader the page they asked for, and of the others only where they are', async () => {
    const built = await buildSite({ 'shabd.config.yaml': `site:\n  title: Docs\n  description: A site.\n${KEYWORD_SEARCH}`, 'content/index.md': '# Home\n\nWhere it starts.\n', ...PAGES })
    const dist = path.join(built.dir, 'dist')

    // The scripts a page asks for before a reader does anything: the ones its document names.
    const upFront = async (file: string) => {
      const html = await built.read(file)
      const named = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((match) => match[1]!)
      expect(named.length).toBeGreaterThan(0)
      return (await Promise.all(named.map((script) => built.read(script)))).join('\n')
    }
    const home = await upFront('index.html')
    // No page's description or file is in them, and every page's address is: the sidebar and the routes.
    expect(home).not.toContain('described as')
    expect(home).not.toContain('page-7.md')
    expect(home).toContain('/guide/page-7')

    // A page's own are in the page: in its document, and in the script that is the page.
    const seven = await built.read('guide/page-7/index.html')
    expect(seven).toContain('<title>Page 7 | Docs</title>')
    expect(seven).toContain('<meta name="description" content="What only page 7 is described as.">')
    expect(seven).toContain('The text of page 7.')
    const scripts = (await readdir(path.join(dist, 'assets'))).filter((file) => file.endsWith('.js'))
    const holding: string[] = []
    for (const script of scripts) if ((await built.read(`assets/${script}`)).includes('What only page 7 is described as.')) holding.push(script)
    expect(holding).toHaveLength(1)
    const own = await built.read(`assets/${holding[0]}`)
    expect(own).toContain('guide/page-7.md')
    expect(own).not.toContain('What only page 8 is described as.')
  })
})
