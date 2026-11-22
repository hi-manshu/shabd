/** sitemap.xml and robots.txt: what a search engine reads before it reads a page. */
import { withBase } from '../../shared/paths.js'
import type { ShabdConfig } from '../../shared/schema.js'
import { escapeHtml } from './html.js'

export interface SitemapEntry {
  /** The page's full address. */
  loc: string
  /** When the page last changed, as a date (`2026-11-17`) or a full timestamp. */
  lastmod?: string | undefined
}

export function renderSitemap(entries: SitemapEntry[]): string {
  const urls = entries.map((entry) => {
    const lastmod = entry.lastmod ? `<lastmod>${escapeHtml(entry.lastmod)}</lastmod>` : ''
    return `  <url><loc>${escapeHtml(entry.loc)}</loc>${lastmod}</url>`
  })
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
}

/**
 * Should the build write robots.txt? Crawlers read the file at the root of a
 * host and nowhere else, so a site served from a sub-path gets one only when
 * its config asks.
 */
export function wantsRobots(site: ShabdConfig['site']): boolean {
  return site.robots === undefined ? site.base === '/' : site.robots !== false
}

/**
 * robots.txt. Every crawler may read everything but the paths in
 * `site.robots.disallow`, and is told where the sitemap is when there is one.
 *
 * A site that is `noindex` is not closed off here. A crawler that may not
 * fetch a page never sees the tag that asks it not to list the page, and may
 * list the address anyway.
 */
export function renderRobots(site: ShabdConfig['site'], sitemap: string | undefined): string {
  const disallow = typeof site.robots === 'object' ? site.robots.disallow : []
  const rules = disallow.length ? disallow.map((path) => `Disallow: ${withBase(site.base, path)}`) : ['Allow: /']
  return `${['User-agent: *', ...rules, ...(sitemap ? ['', `Sitemap: ${sitemap}`] : [])].join('\n')}\n`
}
