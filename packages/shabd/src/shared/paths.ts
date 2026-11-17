/** Path and slug helpers shared by the content scanner, the router and the sidebar. */

const PAGE_EXTENSION = /\.mdx?$/i

export function isPageFile(file: string): boolean {
  return PAGE_EXTENSION.test(file)
}

/**
 * `guide/Getting Started.md` → `guide/getting-started`
 * `guide/index.mdx`          → `guide`
 * `index.md`                 → `` (the site root)
 */
export function fileToSlug(relativePath: string): string {
  const segments = relativePath
    .replace(/\\/g, '/')
    .replace(PAGE_EXTENSION, '')
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.trim().toLowerCase().replace(/\s+/g, '-'))
  if (segments.at(-1) === 'index') segments.pop()
  return segments.join('/')
}

export function slugToPath(slug: string): string {
  return slug ? `/${slug}` : '/'
}

/** Accepts what authors naturally write: `/guide/install`, `guide/install.md`, `guide/`. */
export function refToSlug(ref: string): string {
  const [withoutHash = ''] = ref.split('#')
  return fileToSlug(withoutHash.replace(/^\.?\/+/, '').replace(/\/+$/, ''))
}

export function parentDir(slugOrDir: string): string {
  const index = slugOrDir.lastIndexOf('/')
  return index === -1 ? '' : slugOrDir.slice(0, index)
}

/** Canonical form of a route: no trailing slash, no `index.html`, never empty. */
export function normalizePath(pathname: string): string {
  let path = pathname
  try {
    path = decodeURI(pathname)
  } catch {
    // Malformed escapes: match the raw path rather than throw during navigation.
  }
  path = path.replace(/\/index\.html$/, '/').replace(/\.html$/, '')
  if (path.length > 1) path = path.replace(/\/+$/, '')
  return path || '/'
}

const SCHEME = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i

export function isExternal(href: string): boolean {
  return SCHEME.test(href)
}

/** Prefix an internal path with the site base: (`/docs/`, `/guide`) → `/docs/guide`. */
export function withBase(base: string, path: string): string {
  if (isExternal(path) || path.startsWith('#')) return path
  return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`.replace(/(.)\/$/, '$1') || '/'
}

/**
 * How a page's address is written, and so which file a build writes it to:
 *
 *   clean  /guide/install       guide/install/index.html
 *   slash  /guide/install/      guide/install/index.html
 *   html   /guide/install.html  guide/install.html
 *
 * A route is the same in all three (`/guide/install`), and `normalizePath`
 * turns any of the addresses back into it.
 */
export const URL_STYLES = ['clean', 'slash', 'html'] as const
export type UrlStyle = (typeof URL_STYLES)[number]

/** A page's address as links write it, before the site's base. The home page is `/` in every style. */
export function pageUrl(routePath: string, style: UrlStyle): string {
  if (routePath === '/' || style === 'clean') return routePath
  return style === 'slash' ? `${routePath}/` : `${routePath}.html`
}

/** The file a build writes a page to, relative to the output folder. */
export function pageFile(routePath: string, style: UrlStyle): string {
  if (routePath === '/') return 'index.html'
  return style === 'html' ? `${routePath.slice(1)}.html` : `${routePath.slice(1)}/index.html`
}

/**
 * The href for a link inside the site: the base in front and, when the link
 * leads to a page, the page's address in the site's style. What comes after
 * a `?` or a `#` is kept. `isPage` says whether a route has a page; a path
 * that has none (an image, `/llms.txt`) only gets the base.
 */
export function siteHref(
  href: string,
  site: { base: string; urls: UrlStyle },
  isPage: (routePath: string) => boolean,
): string {
  if (isExternal(href) || href.startsWith('#')) return href
  const cut = href.search(/[?#]/)
  const path = cut === -1 ? href : href.slice(0, cut)
  const rest = cut === -1 ? '' : href.slice(cut)
  const route = normalizePath(path.startsWith('/') ? path : `/${path}`)
  if (!isPage(route)) return withBase(site.base, path) + rest
  // The home page is the folder the site is served from, and a folder's address ends in a slash.
  if (route === '/') return site.base + rest
  const address = withBase(site.base, pageUrl(route, site.urls))
  // `withBase` drops a slash at the end, which is the one thing the `slash` style is there to keep.
  return (site.urls === 'slash' ? `${address}/` : address) + rest
}

/** Where a page's Markdown copy is served: `/guide/install` → `/guide/install.md`, `/` → `/index.md`. */
export function markdownPath(routePath: string): string {
  return routePath === '/' ? '/index.md' : `${routePath}.md`
}

/** Inverse of `withBase` for a location pathname. */
export function stripBase(base: string, pathname: string): string {
  const prefix = base.replace(/\/$/, '')
  if (prefix && (pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return pathname.slice(prefix.length) || '/'
  }
  return pathname
}

/** Short words that read wrong in title case. Kept deliberately small. */
const ACRONYMS = new Set(['api', 'cli', 'faq', 'sdk', 'mcp', 'ui'])

/** `getting-started` → `Getting Started`, `api` → `API`. */
export function titleize(segment: string): string {
  return segment
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => (ACRONYMS.has(word.toLowerCase()) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ')
}
