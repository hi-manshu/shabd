/**
 * The HTML document around the app. Used by the dev server (empty body,
 * client renders) and by the static build (prerendered body, client hydrates).
 */
import type { HeadTag, ShabdConfig } from '../../shared/schema.js'
import { withBase } from '../../shared/paths.js'
import { colorModeScript, themeBaseCss, themeToCss } from '../config/theme-css.js'

export interface DocumentOptions {
  config: ShabdConfig
  title: string
  description: string
  /** Route path of the page, for the canonical URL. */
  path: string
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
  const canonical = site.url ? new URL(withBase(site.base, options.path), site.url).href : undefined

  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    description && `<meta name="description" content="${escapeHtml(description)}">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    description && `<meta property="og:description" content="${escapeHtml(description)}">`,
    '<meta property="og:type" content="article">',
    canonical && `<link rel="canonical" href="${escapeHtml(canonical)}">`,
    canonical && `<meta property="og:url" content="${escapeHtml(canonical)}">`,
    site.favicon && `<link rel="icon" href="${escapeHtml(withBase(site.base, site.favicon))}">`,
    config.features.llms.enabled &&
      `<link rel="alternate" type="text/plain" title="llms.txt" href="${escapeHtml(withBase(site.base, '/llms.txt'))}">`,
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
