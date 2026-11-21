/**
 * Versions of the docs and languages of the site: each is the pages under one
 * path, and the first of its kind is the site itself (src/shared/editions.ts).
 */
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { languageAt, textAt } from '../src/node/build/editions.js'
import { resolveConfig } from '../src/node/config/load.js'
import { createContext } from '../src/node/context.js'
import { renderLlmsTxt } from '../src/node/llms/llms-txt.js'
import { editionRoots, elsewhere, isCurrent, pathAt, placeOf, samePlace, type Editions } from '../src/shared/editions.js'
import { resolvePageLayout } from '../src/shared/layout.js'
import type { SidebarNode } from '../src/shared/types.js'
import { fill, UI_TEXT } from '../src/shared/ui-text.js'
import { KEYWORD_SEARCH, temporaryBuilds } from './helpers/build.js'
import { failure, temporarySites } from './helpers/site.js'

const site = temporarySites()

const EDITIONS: Editions = {
  languages: [
    { label: 'English', prefix: '', lang: 'en' },
    { label: 'Deutsch', prefix: '/de', lang: 'de' },
    { label: 'العربية', prefix: '/ar', lang: 'ar', dir: 'rtl' },
  ],
  versions: [
    { label: '2.x', prefix: '' },
    { label: '1.x', prefix: '/v1', noindex: true },
  ],
}

describe('where a page is', () => {
  it('is a language, a version and a path inside those, and each is told from the page\'s own path', () => {
    const at = (path: string) => {
      const { language, version, rest } = placeOf(path, EDITIONS)
      return [language?.lang, version?.label, rest]
    }
    expect(at('/guide/install')).toEqual(['en', '2.x', '/guide/install'])
    expect(at('/v1/guide/install')).toEqual(['en', '1.x', '/guide/install'])
    expect(at('/de/guide/install')).toEqual(['de', '2.x', '/guide/install'])
    expect(at('/de/v1/guide/install')).toEqual(['de', '1.x', '/guide/install'])
    // The first page of each.
    expect(at('/')).toEqual(['en', '2.x', '/'])
    expect(at('/v1')).toEqual(['en', '1.x', '/'])
    expect(at('/de/v1')).toEqual(['de', '1.x', '/'])
    // A folder that only starts like one of them is not one.
    expect(at('/v10/notes')).toEqual(['en', '2.x', '/v10/notes'])
    expect(at('/design')).toEqual(['en', '2.x', '/design'])
    // A site with neither has pages, and nothing else to say of them.
    expect(placeOf('/guide', {})).toEqual({ language: undefined, version: undefined, rest: '/guide' })
  })

  it('is put together again from its parts', () => {
    for (const path of ['/', '/guide/install', '/v1', '/v1/guide/install', '/de', '/de/guide', '/de/v1', '/de/v1/guide/install', '/ar/v1/x']) {
      expect(pathAt(placeOf(path, EDITIONS))).toBe(path)
    }
  })

  it('leads to the same page elsewhere, or to the first page there when it has no such page', () => {
    const pages = new Set(['/', '/guide/install', '/guide/new', '/v1', '/v1/guide/install', '/de', '/de/guide/install'])
    const isPage = (path: string) => pages.has(path)
    const [english, german] = EDITIONS.languages!
    const [current, older] = EDITIONS.versions!

    expect(elsewhere(placeOf('/guide/install', EDITIONS), { version: older }, isPage)).toBe('/v1/guide/install')
    expect(elsewhere(placeOf('/v1/guide/install', EDITIONS), { version: current }, isPage)).toBe('/guide/install')
    // The older version has no such page: its first page.
    expect(elsewhere(placeOf('/guide/new', EDITIONS), { version: older }, isPage)).toBe('/v1')
    expect(elsewhere(placeOf('/guide/install', EDITIONS), { language: german }, isPage)).toBe('/de/guide/install')
    expect(elsewhere(placeOf('/guide/new', EDITIONS), { language: german }, isPage)).toBe('/de')
    // A language keeps the version, and a version the language.
    expect(elsewhere(placeOf('/v1/guide/install', EDITIONS), { language: german }, isPage)).toBe('/de/v1')
    expect(elsewhere(placeOf('/de/guide/install', EDITIONS), { language: english }, isPage)).toBe('/guide/install')
  })

  it('says which pages are in one, and which are the site\'s own', () => {
    expect(editionRoots(EDITIONS)).toEqual(['/de/v1', '/ar/v1', '/v1', '/de', '/ar'])
    expect(editionRoots({})).toEqual([])
    expect(isCurrent('/guide', EDITIONS)).toBe(true)
    expect(isCurrent('/v1/guide', EDITIONS)).toBe(false)
    expect(isCurrent('/de/guide', EDITIONS)).toBe(false)
    expect(samePlace(placeOf('/de/a', EDITIONS), placeOf('/de/b/c', EDITIONS))).toBe(true)
    expect(samePlace(placeOf('/de/a', EDITIONS), placeOf('/de/v1/a', EDITIONS))).toBe(false)
    expect(samePlace(placeOf('/a', {}), placeOf('/b', {}))).toBe(true)
  })

  it('shows the menus on a site with more than one, and the notice on a page of an older version', () => {
    const layouts = { doc: { name: 'doc', width: 'content' as const, split: false, regions: { header: [{ block: 'version-menu', props: {} }, { block: 'language-menu', props: {} }], main: [{ block: 'version-notice', props: {} }, { block: 'content', props: {} }] } } }
    const defaults = { layout: 'doc', pagination: true, toc: { minDepth: 2, maxDepth: 3 } } as never
    const frontmatter = { sidebar: {}, toc: undefined, pagination: undefined, layout: undefined }
    const blocks = (editions: Editions | undefined, path: string) => {
      const { regions } = resolvePageLayout({ layouts, defaults, ...(editions ? { editions } : {}) }, frontmatter, [], path)
      return [...(regions.header ?? []), ...(regions.main ?? [])].map((block) => block.block)
    }
    expect(blocks(undefined, '/guide')).toEqual(['content'])
    expect(blocks({ versions: [EDITIONS.versions![0]!] }, '/guide')).toEqual(['content'])
    expect(blocks({ versions: EDITIONS.versions! }, '/guide')).toEqual(['version-menu', 'content'])
    expect(blocks({ versions: EDITIONS.versions! }, '/v1/guide')).toEqual(['version-menu', 'version-notice', 'content'])
    expect(blocks({ languages: EDITIONS.languages! }, '/de/guide')).toEqual(['language-menu', 'content'])
    expect(blocks(EDITIONS, '/de/v1/guide')).toEqual(['version-menu', 'language-menu', 'version-notice', 'content'])
  })
})

describe('versions and languages in the config', () => {
  const load = (yaml: string) => resolveConfig('/site', '/site/shabd.config.yaml', `site:\n  title: Docs\n${yaml}`)
  const problems = (yaml: string) => failure(() => load(yaml)).issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)

  it('are the parts of the site they name, the first of each at its root', () => {
    const { editions, config } = load(
      'versions:\n  - label: 2.x\n  - { label: 1.x, path: /v1 }\n  - { label: "0.9", path: /v0.9, index: true }\nlanguages:\n  - { code: de, label: Deutsch }\n  - { code: en, label: English }\n  - { code: ar, label: العربية, dir: rtl }\n  - { code: pt-BR, label: Português, path: /br }\n',
    )
    expect(editions.versions).toEqual([
      { label: '2.x', prefix: '' },
      // Search engines are asked not to list an older version, unless the site says to.
      { label: '1.x', prefix: '/v1', noindex: true },
      { label: '0.9', prefix: '/v0.9' },
    ])
    expect(editions.languages).toEqual([
      { label: 'Deutsch', prefix: '', lang: 'de' },
      { label: 'English', prefix: '/en', lang: 'en' },
      { label: 'العربية', prefix: '/ar', lang: 'ar', dir: 'rtl' },
      { label: 'Português', prefix: '/br', lang: 'pt-BR' },
    ])
    // The first language is the one the site is written in.
    expect(config.site.lang).toBe('de')
    expect(load('').editions).toEqual({})
  })

  it('say what is wrong where it is written', () => {
    expect(problems('versions:\n  - { label: 2.x, path: /v2 }\n  - { label: 1.x }\n')).toEqual([
      "versions.0.path: The first version is the current one, and its pages are the site's own: it has no path. List the older versions after it, each with the folder its pages are in.",
      'versions.1: Say where the pages of "1.x" are: `path: /v1` for the pages in content/v1.',
    ])
    expect(problems('versions:\n  - label: 2.x\n  - { label: 2.x, path: /old }\n  - { label: 1.x, path: /old }\n')).toEqual([
      'versions.1.label: Two versions are called "2.x". A reader picks one by its name.',
      'versions.2.path: /old is where the version "2.x" has its pages. Give the version "1.x" a path of its own.',
    ])
    // A language and a version cannot share a folder either.
    expect(problems('versions:\n  - label: 2.x\n  - { label: 1.x, path: /de }\nlanguages:\n  - { code: en, label: English }\n  - { code: de, label: Deutsch }\n')).toEqual([
      'languages.1: /de is where the version "1.x" has its pages. Give the language de a path of its own.',
    ])
    expect(problems('  lang: fr\nlanguages:\n  - { code: en, label: English }\n  - { code: EN, label: English again }\n')).toEqual([
      "site.lang: site.lang is fr, and the first of `languages` is en. The first language is the site's own: leave site.lang out, or make the two agree.",
      'languages.1.code: The language EN is listed twice.',
    ])
    expect(problems('languages:\n  - { code: en, label: English }\n  - { code: de, label: Deutsch, ui: { serch: Suche, toc: Auf dieser Seite } }\n')).toEqual([
      'languages.1.ui.serch: "serch" is not one of the site\'s own words. Did you mean "search"?',
    ])
    expect(problems('versions:\n  - label: 2.x\n  - { label: 1.x, path: v1/old }\n')[0]).toContain('A path such as /v1: a slash, then the name of one folder')
    // What the site says of itself in its first language is under `site`, and nowhere else.
    expect(problems('languages:\n  - { code: en, label: English, footer: Made here., nav: [] }\n  - { code: de, label: Deutsch, footer: Hier gemacht. }\n')).toEqual([
      "languages.0.nav: The first language is the site's own: write this under site.nav.",
      "languages.0.footer: The first language is the site's own: write this under site.footer.",
    ])
  })
})

describe('the words of the site', () => {
  it('are each in the documentation, by their key and as English says them', async () => {
    const page = await readFile(new URL('../../../docs/content/features/versions.md', import.meta.url), 'utf8')
    // A row of the tables: | `key` | `What English says` | Where a reader meets it |
    const listed = new Map([...page.matchAll(/^\| `([\w.]+)` \| `(.+?)` \| .+ \|$/gm)].map((row) => [row[1]!, row[2]!]))
    expect([...listed.keys()].sort()).toEqual(Object.keys(UI_TEXT).sort())
    for (const [key, text] of Object.entries(UI_TEXT)) expect(listed.get(key), key).toBe(text)
  })

  it('are a language\'s own where it gives them, and English where it does not', () => {
    const resolved = resolveConfig(
      '/site',
      '/site/shabd.config.yaml',
      'site:\n  title: Docs\nlanguages:\n  - { code: en, label: English }\n  - { code: de, label: Deutsch, ui: { search: Suche, "search.count.many": "{count} Treffer" } }\n',
    )
    expect(textAt(resolved, '/de/guide/install')('search')).toBe('Suche')
    expect(textAt(resolved, '/de/guide/install')('search.count.many', { count: 3 })).toBe('3 Treffer')
    expect(textAt(resolved, '/de/guide/install')('toc')).toBe('On this page')
    expect(textAt(resolved, '/guide/install')('search')).toBe('Search')
    expect(languageAt(resolved, '/de')).toBe('de')
    expect(languageAt(resolved, '/guide')).toBe('en')
  })

  it('are filled in where a sentence has a blank', () => {
    expect(fill(UI_TEXT['version.old'], { version: '1.x' })).toBe('You are reading the documentation for 1.x.')
    expect(fill('{count} Treffer für {query}', { count: 3, query: 'x' })).toBe('3 Treffer für x')
    // A blank nobody fills is left as it is written, where it can be seen.
    expect(fill('Version {version}')).toBe('Version {version}')
    expect(fill('Version {version}', {})).toBe('Version {version}')
  })
})

const PAGE = (title: string, text: string) => `---\ntitle: ${title}\ndescription: ${text}\n---\n\n${text}\n`
const SITE = {
  'shabd.config.yaml': [
    'site:',
    '  title: Docs',
    '  url: https://docs.example.com',
    '  logo: /logo.svg',
    '  nav:',
    '    - { label: Guide, link: /guide/install }',
    '    - { label: News, link: /guide/new }',
    '  footer: Made with care.',
    KEYWORD_SEARCH.trimEnd(),
    '  feed: true',
    'defaults:',
    '  lastUpdated: false',
    'versions:',
    '  - label: 2.x',
    '  - { label: 1.x, path: /v1 }',
    'languages:',
    '  - { code: en, label: English }',
    '  - code: de',
    '    label: Deutsch',
    '    ui:',
    '      version.old: Sie lesen die Dokumentation für {version}.',
    '      version.thisPage: Diese Seite in {version} lesen, der aktuellen Version.',
    '      page.updated: Zuletzt geändert am',
    '      notFound.title: Seite nicht gefunden',
    '    nav:',
    '      - { label: Anleitung, link: /de/guide/install }',
    '    footer: Mit Sorgfalt gemacht.',
    '  - { code: ar, label: العربية, dir: rtl }',
    '',
  ].join('\n'),
  'content/index.md': PAGE('Home', 'Where it starts.'),
  'content/guide/install.md': PAGE('Install', 'How it is installed now.').replace('---\n\n', 'lastUpdated: 2026-11-17\n---\n\n'),
  'content/guide/new.md': PAGE('New in two', 'Only the current version has this.'),
  'content/v1/index.md': PAGE('Version one', 'Where version one starts.'),
  'content/v1/guide/install.md': PAGE('Install', 'How it was installed then.'),
  'content/v1/guide/gone.md': PAGE('Gone since', 'Only version one has this.'),
  'content/de/index.md': PAGE('Start', 'Wo es anfängt.'),
  'content/de/guide/install.md': PAGE('Installieren', 'Wie es jetzt installiert wird.').replace('---\n\n', 'lastUpdated: 2026-11-17\n---\n\n'),
  'content/de/v1/guide/install.md': PAGE('Installieren', 'Wie es damals installiert wurde.'),
  'content/ar/index.md': PAGE('البداية', 'من هنا.'),
}

describe('a site with versions and languages', () => {
  const links = (nodes: SidebarNode[]): string[] => nodes.flatMap((node) => (node.type === 'page' ? [node.path] : node.type === 'group' ? links(node.items) : []))

  it('gives each a sidebar of its own, made from its own folder', async () => {
    const dir = await site(SITE)
    const { store } = await createContext(dir, { dev: false })
    const { sidebar, sections } = store.sidebar
    // The site's own: the current version, in the language the site is written in.
    // Its first page is not in the sidebar: the site's title leads there.
    expect(links(sidebar).sort()).toEqual(['/guide/install', '/guide/new'])
    const of = (prefix: string) => links(sections.find((section) => section.prefix === prefix)?.sidebar ?? []).sort()
    expect(of('/v1')).toEqual(['/v1', '/v1/guide/install', '/v1/guide/gone'].sort())
    expect(of('/de')).toEqual(['/de', '/de/guide/install'])
    expect(of('/de/v1')).toEqual(['/de/v1/guide/install'])
    expect(of('/ar')).toEqual(['/ar'])
    // The folder a version starts at is the top of its sidebar, and not a group in it.
    const one = sections.find((section) => section.prefix === '/v1')!.sidebar
    expect(one.map((node) => (node.type === 'group' ? `group ${node.label}` : node.type === 'page' ? `page ${node.path}` : node.type))).toEqual(['page /v1', 'group Guide'])
    expect(store.sidebarWarnings()).toEqual([])
  })

  it('tells agents about the current docs in the site\'s own language, and where the rest is', async () => {
    const dir = await site(SITE)
    const context = await createContext(dir, { dev: false })
    const text = renderLlmsTxt(context)
    expect(text).toContain('[Install](https://docs.example.com/guide/install.md): How it is installed now.')
    expect(text).not.toContain('installed then')
    expect(text).not.toContain('installiert')
    expect(text).toContain('## Other versions\n\n- [1.x](https://docs.example.com/v1)')
    expect(text).toContain('## Other languages\n\n- [Deutsch](https://docs.example.com/de)\n- [العربية](https://docs.example.com/ar)')
  })
})

describe('a build of a site with versions and languages', () => {
  const buildSite = temporaryBuilds()

  it('writes each page with what its version and its language ask for', async () => {
    const built = await buildSite(SITE)
    const head = (html: string) => html.slice(0, html.indexOf('</head>'))

    // The current version, in the site's own language: listed, and nothing said about versions but the menu.
    const now = await built.read('guide/install/index.html')
    expect(now).toContain('<html lang="en">')
    expect(head(now)).not.toContain('noindex')
    expect(now).not.toContain('sb-version-notice')
    // The menu is in the page as it is written, and works with no script: a list of links.
    expect(now).toMatch(/<details class="sb-edition-menu" data-kind="version"><summary><span class="sb-visually-hidden">Version: 2\.x<\/span>/)
    expect(now).toContain('<a href="/guide/install" aria-current="true">2.x</a>')
    expect(now).toContain('<a href="/v1/guide/install">1.x</a>')
    // Each language by its own name, in its own language, where it has the page; its first page where it has not.
    expect(now).toContain('<a href="/de/guide/install" lang="de" hrefLang="de">Deutsch</a>')
    expect(now).toContain('<a href="/ar" lang="ar" hrefLang="ar">العربية</a>')
    // Search engines are told of the page in the other languages that have it, and of itself among them.
    expect(head(now)).toContain('<link rel="alternate" hreflang="en" href="https://docs.example.com/guide/install">')
    expect(head(now)).toContain('<link rel="alternate" hreflang="de" href="https://docs.example.com/de/guide/install">')
    expect(head(now)).toContain('<link rel="alternate" hreflang="x-default" href="https://docs.example.com/guide/install">')
    expect(head(now)).not.toContain('hreflang="ar"')

    // The header's links and the footer are the site's own, and the day is written as English writes one.
    expect(now).toContain('<a href="/guide/install" aria-current="true">Guide</a>')
    expect(now).toContain('<p class="sb-footer">Made with care.</p>')
    expect(now).toMatch(/Last updated <time dateTime="2026-11-17">November 17, 2026<\/time>/)

    // An older version: not for search engines, and it says so of itself to a reader.
    const then = await built.read('v1/guide/install/index.html')
    expect(head(then)).toContain('<meta name="robots" content="noindex">')
    expect(then).toContain('You are reading the documentation for 1.x.')
    expect(then).toMatch(/<a href="\/guide\/install">Read this page in 2\.x, the current version\.<\/a>/)
    expect(then).toContain('How it was installed then.')
    expect(then).toContain('<a href="/v1/guide/install" aria-current="true">1.x</a>')
    // Its sidebar is its own pages.
    expect(then).toContain('href="/v1/guide/gone"')
    // A link of the header leads to its page in this version, where the version has it, and as written where it has not.
    expect(then).toContain('<a href="/v1/guide/install" aria-current="true">Guide</a>')
    expect(then).toContain('<a href="/guide/new">News</a>')
    // A page the current version does not have leads to where the current version starts.
    const gone = await built.read('v1/guide/gone/index.html')
    expect(gone).toMatch(/<a href="\/">Go to 2\.x, the current version\.<\/a>/)

    // Another language: the document says which, and the site's words are that language's where it gives them.
    const german = await built.read('de/v1/guide/install/index.html')
    expect(german).toContain('<html lang="de">')
    expect(german).toContain('Sie lesen die Dokumentation für 1.x.')
    expect(german).toMatch(/<a href="\/de\/guide\/install">Diese Seite in 2\.x lesen, der aktuellen Version\.<\/a>/)
    // A word it does not give is said in English.
    expect(german).toContain('<span class="sb-visually-hidden">Version: 1.x</span>')
    // A language is called by its name and its code, which is what is shown where room is short.
    expect(german).toContain('<span class="sb-visually-hidden">Language: Deutsch (DE)</span>')
    // A language has its own links, which lead to the reader's version where it has the page, and its own footer.
    expect(german).toContain('<a href="/de/v1/guide/install" aria-current="true">Anleitung</a>')
    expect(german).not.toContain('>Guide</a>')
    expect(german).toContain('<p class="sb-footer">Mit Sorgfalt gemacht.</p>')
    // The site's title leads to where the language starts.
    expect(german).toMatch(/<a class="sb-site-title" href="\/de"/)
    // The day a page was last changed is written as its language writes a day.
    const germanNow = await built.read('de/guide/install/index.html')
    expect(germanNow).toMatch(/Zuletzt geändert am <time dateTime="2026-11-17">17\. November 2026<\/time>/)
    // A language that says nothing of its own has the site's links, each to its page in that language if it has one.
    const arabic = await built.read('ar/index.html')
    expect(arabic).toContain('<html lang="ar" dir="rtl">')
    expect(arabic).toContain('<a href="/guide/install">Guide</a>')
    expect(arabic).toContain('<p class="sb-footer">Made with care.</p>')
    expect(arabic).toMatch(/<a class="sb-site-title" href="\/ar"/)

    // What search engines and feed readers are given is the current docs.
    const sitemap = await built.read('sitemap.xml')
    expect(sitemap).toContain('https://docs.example.com/guide/install')
    expect(sitemap).toContain('https://docs.example.com/de/guide/install')
    expect(sitemap).not.toContain('/v1')
    const llms = await built.read('llms.txt')
    expect(llms).not.toContain('/v1/guide')
    expect(llms).not.toContain('/de/guide')
  })
})
