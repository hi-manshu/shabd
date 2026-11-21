/** rss.xml: which pages are in it, in what order, and what is written. */
import { describe, expect, it } from 'vitest'
import { feedEntries, renderFeed } from '../src/node/build/feed.js'
import { resolveConfig } from '../src/node/config/load.js'
import { createContext } from '../src/node/context.js'
import { KEYWORD_SEARCH, temporaryBuilds } from './helpers/build.js'
import { failure, temporarySites } from './helpers/site.js'

const site = temporarySites()
const build = temporaryBuilds()

const config = (feed: string) => `site:\n  title: Acme & Co\n  description: Notes from Acme.\n  url: https://docs.example\nfeatures:\n  feed: ${feed}\n`

const PAGES = {
  'content/index.md': '# Home\n',
  'content/changelog/one.md': '---\ntitle: Version 1\ndescription: The first release.\ndate: 2026-01-10\n---\n\nOut now.\n',
  'content/changelog/two.md': '---\ntitle: Version 2 <beta>\ndate: 2026-03-20\n---\n\nOut now.\n',
  'content/changelog/hidden.md': '---\ntitle: Not for search engines\ndate: 2026-04-01\nnoindex: true\n---\n\nQuiet.\n',
  'content/guide/dated.md': '---\ntitle: A guide\nlastUpdated: 2026-02-15\n---\n\nText.\n',
  'content/guide/both.md': '---\ntitle: Published then changed\ndate: 2026-01-05\nlastUpdated: 2026-05-05\n---\n\nText.\n',
  'content/guide/undated.md': '# No day at all\n',
}

describe('the feed', () => {
  it('needs the address the site is deployed at', () => {
    const load = (yaml: string) => resolveConfig('/site', '/site/shabd.config.yaml', yaml)
    const error = failure(() => load('site:\n  title: Docs\nfeatures:\n  feed: true\n'))
    expect(error.issues[0]).toMatchObject({ path: ['features', 'feed'], line: 4 })
    expect(error.issues[0]?.message).toContain('The feed needs `site.url`')
    expect(load('site:\n  title: Docs\n').config.features.feed).toEqual({ enabled: false, limit: 20 })
  })

  it('lists the pages that have a day, newest first, under the day they were published', async () => {
    const context = await createContext(await site({ 'shabd.config.yaml': config('true'), ...PAGES }), { dev: false })
    expect(feedEntries(context).map((entry) => `${entry.day} ${entry.title}`)).toEqual([
      '2026-03-20 Version 2 <beta>',
      // No `date`, so the day it was last changed stands in.
      '2026-02-15 A guide',
      '2026-01-10 Version 1',
      // A page that was published and later changed stays where it was published.
      '2026-01-05 Published then changed',
    ])
  })

  it('can be kept to one folder, and to a number of pages', async () => {
    const dir = await site({ 'shabd.config.yaml': config('{ directory: changelog, limit: 1, title: Releases }'), ...PAGES })
    const context = await createContext(dir, { dev: false })
    expect(feedEntries(context).map((entry) => entry.title)).toEqual(['Version 2 <beta>'])
    expect(renderFeed(context)).toContain('<title>Releases</title>')
  })

  it('is written as RSS that says where it lives and how new it is', async () => {
    const context = await createContext(await site({ 'shabd.config.yaml': config('true'), ...PAGES }), { dev: false })
    const xml = renderFeed(context)
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"')).toBe(true)
    expect(xml).toContain('<title>Acme &amp; Co</title>')
    expect(xml).toContain('<link>https://docs.example/</link>')
    expect(xml).toContain('<atom:link href="https://docs.example/rss.xml" rel="self" type="application/rss+xml"/>')
    // As new as its newest page, not as new as the build: the file is the same until a page changes.
    expect(xml).toContain('<lastBuildDate>Fri, 20 Mar 2026 00:00:00 GMT</lastBuildDate>')
    expect(xml).toContain(
      [
        '    <item>',
        '      <title>Version 1</title>',
        '      <link>https://docs.example/changelog/one</link>',
        '      <guid isPermaLink="true">https://docs.example/changelog/one</guid>',
        '      <pubDate>Sat, 10 Jan 2026 00:00:00 GMT</pubDate>',
        '      <description>The first release.</description>',
        '    </item>',
      ].join('\n'),
    )
    expect(xml).toContain('<title>Version 2 &lt;beta&gt;</title>')
    expect(xml).not.toContain('Not for search engines')
  })

  it('is written by a build, announced in every page, and said to be empty when it is', async () => {
    const built = await build({ 'shabd.config.yaml': config('true') + KEYWORD_SEARCH.replace('features:\n', ''), ...PAGES })
    expect(await built.read('rss.xml')).toContain('<guid isPermaLink="true">https://docs.example/changelog/two</guid>')
    expect(await built.read('index.html')).toContain(
      '<link rel="alternate" type="application/rss+xml" title="Acme &amp; Co" href="/rss.xml">',
    )
    expect(built.output).toContain('rss.xml: 4 pages')

    const empty = await build({
      'shabd.config.yaml': config('true') + KEYWORD_SEARCH.replace('features:\n', ''),
      'content/index.md': '# Home\n',
    })
    expect(await empty.read('rss.xml')).not.toContain('<item>')
    expect(empty.output).toContain('The feed is empty')
  })
})
