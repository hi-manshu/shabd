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
