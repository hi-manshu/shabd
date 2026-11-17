/**
 * The HTML document around the app. Used by the dev server (empty body,
 * client renders) and by the static build (prerendered body, client hydrates).
 */
import type { HeadTag, ShabdConfig } from '../../shared/schema.js'
import { siteHref, withBase } from '../../shared/paths.js'
import { colorModeScript, themeBaseCss, themeToCss } from '../config/theme-css.js'

export interface DocumentOptions {
  config: ShabdConfig
  title: string
  description: string
  /** Route path of the page, for the canonical URL. */
  path: string
  /** Ask search engines not to list this page. A site that is `noindex` asks for every page. */
  noindex?: boolean | undefined
  /** The picture to show when this page is shared, in place of the site's: a path inside the site, or a full address. */
  image?: string | undefined
  /** Prerendered app markup. */
  body?: string
  /** Extra tags for <head>: stylesheets, module preloads. */
  head?: string
  /** Script tags placed at the end of <body>. */
  scripts?: string
  /** Extra attributes for inline scripts, e.g. a CSP nonce. */
  scriptAttributes?: string
  /**
   * Address of a stylesheet holding the presets from the theme menu. Given
   * one, the document carries only the site's own tokens and links to it.
   * Without one, everything is written into the document.
   */
  paletteStylesheet?: string
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => ESCAPES[char]!)

/** A path inside the site: it starts with one slash. Such a path gets the site's base. */
const SITE_PATH = /^\/(?!\/)/

/**
 * One of the site's own tags from `site.head`. Attribute values are escaped.
 * The content of a script or a style is written as it is, which is why the
 * schema refuses content that could close its own tag.
 */
export function renderHeadTag(tag: HeadTag, base: string): string {
  const attrs = Object.entries(tag.attrs).flatMap(([name, value]) => {
    if (value === false) return []
    if (value === true) return [name]
    const text = String(value)
    const isAddress = name === 'href' || name === 'src'
    return [`${name}="${escapeHtml(isAddress && SITE_PATH.test(text) ? withBase(base, text) : text)}"`]
  })
  const opening = `<${[tag.tag, ...attrs].join(' ')}>`
  return tag.tag === 'meta' || tag.tag === 'link' ? opening : `${opening}${tag.content ?? ''}</${tag.tag}>`
}

/**
 * The full address of the picture shown when a page is shared. The sites
 * that show it fetch it from outside, so a path inside the site is only of
 * use once it is known where the site is deployed.
 */
export function socialImage(site: ShabdConfig['site'], image: string | undefined): string | undefined {
  if (!image) return undefined
  if (/^https?:\/\//i.test(image)) return image
  return site.url ? new URL(withBase(site.base, image), site.url).href : undefined
}

export function pageTitle(config: ShabdConfig, title: string): string {
  return title && title !== config.site.title ? `${title} | ${config.site.title}` : config.site.title
}

export function renderDocument(options: DocumentOptions): string {
  const { config } = options
  const { site, theme } = config
  const title = pageTitle(config, options.title)
  const description = options.description || site.description

  // `system` is resolved in the browser; a fixed default is set here so the
  // page is correct even before (or without) JavaScript.
  const themeAttribute = theme.colorMode.default === 'system' ? '' : ` data-theme="${theme.colorMode.default}"`
  const canonical = site.url ? new URL(siteHref(options.path, site, () => true), site.url).href : undefined
  const image = socialImage(site, options.image ?? site.image)

  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    description && `<meta name="description" content="${escapeHtml(description)}">`,
    (site.noindex || options.noindex) && '<meta name="robots" content="noindex">',
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    description && `<meta property="og:description" content="${escapeHtml(description)}">`,
    '<meta property="og:type" content="article">',
    `<meta property="og:site_name" content="${escapeHtml(site.title)}">`,
    image && `<meta property="og:image" content="${escapeHtml(image)}">`,
    // With a picture, a link to the page is shown as a large card; without one, as a line of text.
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`,
    canonical && `<link rel="canonical" href="${escapeHtml(canonical)}">`,
    canonical && `<meta property="og:url" content="${escapeHtml(canonical)}">`,
    site.favicon && `<link rel="icon" href="${escapeHtml(withBase(site.base, site.favicon))}">`,
    config.features.llms.enabled &&
      `<link rel="alternate" type="text/plain" title="llms.txt" href="${escapeHtml(withBase(site.base, '/llms.txt'))}">`,
    config.features.feed.enabled &&
      `<link rel="alternate" type="application/rss+xml" title="${escapeHtml(config.features.feed.title ?? site.title)}" href="${escapeHtml(withBase(site.base, '/rss.xml'))}">`,
    '<meta name="generator" content="Shabd">',
    `<script${options.scriptAttributes ?? ''}>${colorModeScript(theme)}</script>`,
    options.paletteStylesheet
      ? `<style id="sb-theme">${themeBaseCss(theme)}</style>\n    <link rel="stylesheet" href="${escapeHtml(options.paletteStylesheet)}">`
      : `<style id="sb-theme">${themeToCss(theme)}</style>`,
    options.head,
    ...site.head.map((tag) => renderHeadTag(tag, site.base)),
  ]
    .filter(Boolean)
    .join('\n    ')

  return `<!doctype html>
<html lang="${escapeHtml(site.lang)}"${themeAttribute}>
  <head>
    ${head}
  </head>
  <body>
    <div id="app">${options.body ?? ''}</div>
    ${options.scripts ?? ''}
  </body>
</html>
`
}

/**
 * The page a static host serves at an address that has moved. A host that
 * serves files cannot answer with a redirect, so the page sends the reader
 * on itself: at once where scripts run, and through the refresh tag where
 * they do not. Search engines are told where the page went and not to list
 * this one.
 *
 * `target` is an address a browser can follow from here: a path with the
 * site's base, or a full address.
 */
export function renderRedirect(config: ShabdConfig, target: string): string {
  const { site } = config
  const href = escapeHtml(target)
  const canonical = /^https?:/i.test(target) ? target : site.url ? new URL(target, site.url).href : undefined
  // A reader who followed a link to a heading keeps it, unless the redirect names one of its own.
  const script = `location.replace(${JSON.stringify(target).replace(/</g, '\\u003c')}${target.includes('#') ? '' : ' + location.hash'})`
  const head = [
    '<meta charset="utf-8">',
    `<title>${escapeHtml(site.title)}</title>`,
    `<meta http-equiv="refresh" content="0; url=${href}">`,
    '<meta name="robots" content="noindex">',
    canonical && `<link rel="canonical" href="${escapeHtml(canonical)}">`,
  ]
    .filter(Boolean)
    .join('\n    ')

  return `<!doctype html>
<html lang="${escapeHtml(site.lang)}">
  <head>
    ${head}
  </head>
  <body>
    <p>This page has moved to <a href="${href}">${href}</a>.</p>
    <script>${script}</script>
  </body>
</html>
`
}
