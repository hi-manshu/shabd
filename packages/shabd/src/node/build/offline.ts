/**
 * Reading a site without a connection (`features.offline`).
 *
 * A build writes a service worker beside the site. A reader's browser
 * installs it on a first visit, and it then fetches what any page needs to
 * be read and keeps it: every page, the scripts and styles the pages load,
 * the fonts, the pictures and the search index. From then on the site opens
 * with no connection, any page of it, and search works by keyword.
 *
 * It does not fetch ahead what only some pages load, and only when a reader
 * gets to it: the library that draws diagrams, the compiler of a live
 * sandbox, the model for search by meaning. Those are megabytes that most
 * readers never ask for. Each is kept from the first time a page uses it.
 *
 * With a connection nothing changes for the reader. A page is asked of the
 * network first, so that what is read is what is published, and comes from
 * the browser's copy only when the network does not answer. Files whose
 * names carry a hash of their contents never change, and come from the copy
 * straight away.
 *
 * The copy belongs to one build. The worker's own text names every file and
 * a version made from all of them, so a new build is a new worker: the
 * browser sees that the script changed, the new one fetches its files, and
 * the old copy is deleted when the new one is complete.
 *
 * What it costs is every page of the site, downloaded in the background by
 * every reader who visits once. The build says how much that is.
 */
import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { SEARCH_FILES } from '../../shared/search-core.js'

/** The worker's file, at the root of the site. A worker can only answer for the folder it is in. */
export const SERVICE_WORKER_FILE = 'shabd-sw.js'
/** What a reader is shown, without a connection, for an address the browser has no copy of. */
export const OFFLINE_PAGE = '_shabd/offline.html'

/**
 * What a reader's browser has no use for: the copies of pages for AI agents
 * and crawlers, the pictures other sites show, what a host reads, and the
 * embedding model, which is tens of megabytes and which the browser keeps a
 * copy of in a store of its own once it has run.
 */
const NOT_FOR_READERS: RegExp[] = [
  /\.md$/,
  /^llms(?:-full)?\.txt$/,
  /^_shabd\/docs\.json$/,
  /^_shabd\/social\//,
  new RegExp(`^${SEARCH_FILES.models}`),
  new RegExp(`^${SEARCH_FILES.runtime}`),
  /^(?:sitemap\.xml|robots\.txt|rss\.xml)$/,
  // Written for a host by an adapter, or by the site for one.
  /^(?:_worker\.js|_routes\.json|_redirects|_headers|\.assetsignore|CNAME|\.nojekyll)$/,
  /^\.vite\//,
  new RegExp(`^${SERVICE_WORKER_FILE}$`),
]

export interface OfflineFiles {
  /** Paths inside the build folder, with forward slashes, in a fixed order. */
  files: string[]
  bytes: number
  /** Changes when any of the files does. */
  version: string
}

/** `KaTeX_Main-Regular-B22Nviop.woff2` is the font `KaTeX_Main-Regular`, in the form every browser that runs a worker takes. */
const FONT = /^(.*)-[\w-]{8}\.(woff2|woff|ttf|otf)$/

/**
 * The files of a finished build that a reader's browser fetches ahead.
 *
 * `ahead` names the bundled files (`assets/`) that pages load when they are
 * shown, or one step later: the rest of that folder is left to be kept when
 * it is first used. A font that is also there as `.woff2` is fetched in that
 * form alone, which is the one a browser picks.
 */
export async function offlineFiles(outDir: string, ahead: ReadonlySet<string>): Promise<OfflineFiles> {
  const entries = await readdir(outDir, { recursive: true, withFileTypes: true })
  const all = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(outDir, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
  const compact = new Set(all.flatMap((file) => (FONT.exec(file)?.[2] === 'woff2' ? [FONT.exec(file)![1]!] : [])))
  const files = all
    .filter((file) => !NOT_FOR_READERS.some((pattern) => pattern.test(file)))
    .filter((file) => !file.startsWith('assets/') || ahead.has(file))
    .filter((file) => {
      const font = FONT.exec(file)
      return !font || font[2] === 'woff2' || !compact.has(font[1]!)
    })
    .sort()

  const version = createHash('sha1')
  let bytes = 0
  for (const file of files) {
    const absolute = path.join(outDir, file)
    bytes += (await stat(absolute)).size
    // A file named after its contents says in its name whether it changed. Any other is read.
    version.update(file)
    if (!isHashed(file)) version.update(await readFile(absolute))
  }
  return { files, bytes, version: version.digest('hex').slice(0, 12) }
}

/** `assets/app-B3xq9K2a.js`, `_shabd/palettes.0b24503b.css`: the name carries a hash of the contents. */
export function isHashed(file: string): boolean {
  return /^assets\//.test(file) || /\.[0-9a-f]{8}\.[a-z0-9]+$/.test(file)
}

/**
 * The worker, as the text of its file. It imports nothing and is not
 * bundled: a worker that fails to parse cannot be replaced by a better one
 * until the reader's browser asks for it again, so there is as little in it
 * as will do.
 */
export function serviceWorker(base: string, offline: OfflineFiles): string {
  return `// Written by shabd build (features.offline). It keeps this site in the reader's browser, so that
// it can be read without a connection. The next build replaces this file, and the browser's copy with it.
const BASE = ${JSON.stringify(base)}
const VERSION = ${JSON.stringify(offline.version)}
// One site's copies are told from another's on the same host by the folder the site is served from.
const PREFIX = 'shabd:' + BASE + ':'
const CACHE = PREFIX + VERSION
const OFFLINE = ${JSON.stringify(OFFLINE_PAGE)}
const FILES = ${JSON.stringify(offline.files)}

const hashed = (file) => /^assets\\//.test(file) || /\\.[0-9a-f]{8}\\.[a-z0-9]+$/.test(file)

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      // A few at a time: a site is thousands of files, and a browser asked for all at once drops some.
      for (let at = 0; at < FILES.length; at += 20) {
        // Past the browser's own cache, which may hold a page as it was before this build.
        await cache.addAll(FILES.slice(at, at + 20).map((file) => new Request(BASE + file, { cache: 'reload' })))
      }
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // The copies of earlier builds of this site. Another site's are left alone.
      for (const name of await caches.keys()) if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name)
      await self.clients.claim()
    })(),
  )
})

/** The file an address is answered with: a page's address is a folder, or a name without its ending. */
async function kept(cache, pathname) {
  const path = pathname.slice(BASE.length)
  const names = [path, path.replace(/\\/$/, '') + '/index.html', path.replace(/\\/$/, '') + '.html'].map((name) => name.replace(/^\\//, ''))
  for (const name of names) {
    // Whatever the host says the answer varies by (the encoding, the origin): a copy is kept by its address
    // alone, and a request for that address is not always made with the headers the first one had.
    const response = await cache.match(BASE + name, { ignoreVary: true })
    if (response) return { response, hashed: hashed(name) }
  }
  return undefined
}

async function answer(request) {
  const cache = await caches.open(CACHE)
  const pathname = new URL(request.url).pathname
  const copy = await kept(cache, pathname)
  // A file named after its contents is the same file wherever it comes from.
  if (copy && copy.hashed) return copy.response
  try {
    const response = await fetch(request)
    // What was not fetched ahead, because only some pages load it, is kept from the first time one does.
    if (!copy && response.status === 200 && hashed(pathname.slice(BASE.length))) await cache.put(pathname, response.clone())
    return response
  } catch (error) {
    if (copy) return copy.response
    if (request.mode === 'navigate') {
      const page = await cache.match(BASE + OFFLINE, { ignoreVary: true })
      if (page) return new Response(page.body, { status: 503, headers: page.headers })
    }
    // What the page would have got without a worker: a request that failed.
    return Response.error()
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  // Only this site's own files, and only reading them.
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return
  event.respondWith(answer(request))
})
`
}

/** The body of the page a reader gets, without a connection, for an address the browser has no copy of. */
export function offlineBody(home: string): string {
  return (
    '<main style="max-inline-size:36rem;margin:18vh auto;padding:0 1.5rem;font-family:var(--sb-font-sans);color:var(--sb-text)">' +
    '<h1 style="font-family:var(--sb-font-heading);font-size:var(--sb-step-4);line-height:1.15;margin:0 0 1rem">There is no connection</h1>' +
    '<p style="color:var(--sb-muted);margin:0 0 1.5rem">This address has no page that was kept for reading offline. The rest of the site is here.</p>' +
    `<p><a href="${home}" style="color:var(--sb-link);text-decoration:underline">Go to the home page</a></p>` +
    '</main>'
  )
}
