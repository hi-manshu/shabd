/** What `shabd build` writes, checked on real builds of small sites. */
import { describe, expect, it } from 'vitest'
import { preview } from '../src/node/build/preview.js'
import { pageFile, pageUrl, siteHref } from '../src/shared/paths.js'
import { KEYWORD_SEARCH, temporaryBuilds } from './helpers/build.js'

const build = temporaryBuilds()

describe('site.urls', () => {
  it('writes a page\'s address as a path, with a slash at the end, or as a file', () => {
    expect(['clean', 'slash', 'html'].map((style) => pageUrl('/guide/install', style as 'clean'))).toEqual([
      '/guide/install',
      '/guide/install/',
      '/guide/install.html',
    ])
    expect(['clean', 'slash', 'html'].map((style) => pageFile('/guide/install', style as 'clean'))).toEqual([
      'guide/install/index.html',
      'guide/install/index.html',
      'guide/install.html',
    ])
    // The home page is the folder itself in every style.
    for (const style of ['clean', 'slash', 'html'] as const) {
      expect(pageUrl('/', style)).toBe('/')
      expect(pageFile('/', style)).toBe('index.html')
    }
  })

  it('gives a link to a page the site\'s style, and leaves every other link as it was written', () => {
    const pages = new Set(['/', '/guide/install'])
    const href = (link: string, urls: 'clean' | 'slash' | 'html', base = '/docs/') =>
      siteHref(link, { base, urls }, (route) => pages.has(route))

    expect(href('/guide/install#steps', 'clean')).toBe('/docs/guide/install#steps')
    expect(href('/guide/install#steps', 'slash')).toBe('/docs/guide/install/#steps')
    expect(href('/guide/install?tab=2#steps', 'html')).toBe('/docs/guide/install.html?tab=2#steps')
    // However the link was written, it is the same page.
    expect(href('/guide/install/', 'html')).toBe('/docs/guide/install.html')
    expect(href('/guide/install.html', 'slash')).toBe('/docs/guide/install/')
    // The home page is the folder the site is served from, in every style.
    for (const style of ['clean', 'slash', 'html'] as const) {
      expect(href('/', style)).toBe('/docs/')
      expect(href('/#top', style, '/')).toBe('/#top')
    }
    // Not pages: a file, an address that has moved, another site, a heading on this page.
    expect(href('/logo.svg', 'slash')).toBe('/docs/logo.svg')
    expect(href('/guide/old', 'html')).toBe('/docs/guide/old')
    expect(href('https://example.com/guide/install', 'html')).toBe('https://example.com/guide/install')
    expect(href('#steps', 'slash')).toBe('#steps')
  })

  const site = (urls: string) => ({
    'shabd.config.yaml': `site:\n  title: Docs\n  url: https://docs.example\n  base: /docs/\n  urls: ${urls}\nredirects:\n  /old: /guide/install#steps\n${KEYWORD_SEARCH}`,
    'content/index.md': '# Home\n\nRead [how to install](./guide/install.md#steps).\n',
    'content/guide/install.md': '# Install\n\n## Steps\n\nBack to [the start](../index.md).\n',
  })

  it.each([
    {
      urls: 'clean',
      files: ['index.html', 'guide/install/index.html', 'old/index.html'],
      link: '/docs/guide/install#steps',
      address: 'https://docs.example/docs/guide/install',
    },
    {
      urls: 'slash',
      files: ['index.html', 'guide/install/index.html', 'old/index.html'],
      link: '/docs/guide/install/#steps',
      address: 'https://docs.example/docs/guide/install/',
    },
    {
      urls: 'html',
      files: ['index.html', 'guide/install.html', 'old.html'],
      link: '/docs/guide/install.html#steps',
      address: 'https://docs.example/docs/guide/install.html',
    },
  ])('builds files, links, the sitemap and canonical addresses that agree ($urls)', async ({ urls, files, link, address }) => {
    const built = await build(site(urls))
    for (const file of files) expect(built.has(file), file).toBe(true)

    const [homeFile, pageFileName, movedFile] = files as [string, string, string]
    expect(await built.read(homeFile)).toContain(`href="${link}"`)
    expect(await built.read(homeFile)).toContain('<link rel="canonical" href="https://docs.example/docs/">')

    const page = await built.read(pageFileName)
    expect(page).toContain(`<link rel="canonical" href="${address}">`)
    expect(page).toContain(`<meta property="og:url" content="${address}">`)
    // The sidebar links to the page in the same style as the prose does, and the way home is the folder.
    expect(page).toContain(`class="sb-nav-link" href="${link.replace('#steps', '')}"`)
    expect(page).toContain('<a href="/docs/">the start</a>')

    expect(await built.read(movedFile)).toContain(`content="0; url=${link}"`)
    expect(await built.read('sitemap.xml')).toContain(`<loc>${address}</loc>`)
    expect(await built.read('llms-full.txt')).toContain(`Source: ${address}\n`)
    // The Markdown copy of a page has one address, whatever the style.
    expect(built.has('guide/install.md')).toBe(true)
  })

  it('is served by `shabd preview` at the addresses a host would answer', async () => {
    const answered = {
      // A folder with an index file answers with and without the slash.
      clean: ['/docs/guide/install', '/docs/guide/install/'],
      // A file answers to its name, and on many hosts to its name without the extension.
      html: ['/docs/guide/install.html', '/docs/guide/install'],
    }
    for (const [urls, paths] of Object.entries(answered)) {
      const built = await build(site(urls))
      const server = await preview(built.dir, { port: 0 })
      try {
        const origin = server.resolvedUrls?.local[0]?.replace(/\/docs\/$/, '')
        const get = (path: string) => fetch(`${origin}${path}`)
        for (const path of paths) {
          const response = await get(path)
          expect(response.status, `${urls} ${path}`).toBe(200)
          expect(await response.text(), `${urls} ${path}`).toContain('<h1 class="sb-page-title">Install</h1>')
        }
        // A file is served under its own name, and what is not there is the 404 page.
        expect((await get('/docs/guide/install.md')).headers.get('content-type')).toContain('text/markdown')
        const missing = await get('/docs/guide/nothing')
        expect(missing.status).toBe(404)
        expect(await missing.text()).toContain('Page not found')
      } finally {
        await server.close()
      }
    }
  })
})
