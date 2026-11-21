/**
 * The site's feed: `rss.xml`, for readers who follow a site in a feed reader.
 *
 * A page is in the feed when it has a day to be listed under: `date` in its
 * frontmatter (the day it was published, which suits release notes), or
 * failing that the day it was last changed. Pages with neither are left out,
 * because a feed is read in order of time and they have no place in it.
 *
 * The same function writes the file in a build and answers for it in dev.
 */
import { isCurrent } from '../../shared/editions.js'
import { refToSlug } from '../../shared/paths.js'
import type { ShabdContext } from '../context.js'
import { pageAddress, publicUrl } from '../llms/llms-txt.js'
import { escapeHtml } from './html.js'

export const FEED_FILE = 'rss.xml'

export interface FeedEntry {
  title: string
  /** The page's full address. */
  link: string
  /** `2026-11-17`. */
  day: string
  description: string
}

/** The pages in the feed, newest first. */
export function feedEntries(context: ShabdContext): FeedEntry[] {
  const { feed } = context.config.config.features
  const folder = feed.directory === undefined ? undefined : refToSlug(feed.directory)
  const inFolder = (slug: string) => folder === undefined || folder === '' || slug === folder || slug.startsWith(`${folder}/`)

  return context.store
    .pages()
    .flatMap((page) => {
      const day = page.frontmatter.date ?? page.updated?.day
      // The feed is of the current docs, in the language the site is written in.
      if (!day || !inFolder(page.slug) || page.frontmatter.noindex || !isCurrent(page.path, context.config.editions)) return []
      return [{ title: page.title, link: pageAddress(context, page.path), day, description: page.description }]
    })
    .sort((a, b) => (a.day === b.day ? a.title.localeCompare(b.title) : a.day < b.day ? 1 : -1))
    .slice(0, feed.limit)
}

/** A day as RSS writes one: `Tue, 17 Nov 2026 00:00:00 GMT`. */
const rssDate = (day: string) => new Date(`${day}T00:00:00Z`).toUTCString()

export function renderFeed(context: ShabdContext): string {
  const { site, features } = context.config.config
  const entries = feedEntries(context)
  const tag = (name: string, text: string) => `<${name}>${escapeHtml(text)}</${name}>`

  const items = entries.map((entry) =>
    [
      '    <item>',
      `      ${tag('title', entry.title)}`,
      `      ${tag('link', entry.link)}`,
      `      <guid isPermaLink="true">${escapeHtml(entry.link)}</guid>`,
      `      ${tag('pubDate', rssDate(entry.day))}`,
      ...(entry.description ? [`      ${tag('description', entry.description)}`] : []),
      '    </item>',
    ].join('\n'),
  )

  // The channel is as new as its newest entry. Stamping it with the time of the build would change
  // the file on every build, and make every reader fetch it again for nothing.
  const newest = entries[0]?.day
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    ${tag('title', features.feed.title ?? site.title)}`,
    `    ${tag('link', pageAddress(context, '/'))}`,
    `    ${tag('description', site.description || site.title)}`,
    `    ${tag('language', site.lang)}`,
    ...(newest ? [`    ${tag('lastBuildDate', rssDate(newest))}`] : []),
    `    <atom:link href="${escapeHtml(publicUrl(context, `/${FEED_FILE}`))}" rel="self" type="application/rss+xml"/>`,
    ...items,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n')
}
