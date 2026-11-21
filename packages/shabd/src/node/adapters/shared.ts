/**
 * What the host adapters share: the function they deploy, the site's
 * redirects in a form a host can be told, and the shape of an adapter.
 *
 * An adapter runs at the end of `shabd build`, when `dist/` is complete. It
 * writes what one host needs to answer the MCP route, which a static file
 * cannot, and to answer an address that has moved with a redirect of its
 * own in place of the page that sends the reader on.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build as viteBuild, type Plugin } from 'vite'
import type { AdapterName } from '../../shared/adapters.js'
import { isExternal, pageUrl, type UrlStyle } from '../../shared/paths.js'
import { VERSION } from '../../shared/version.js'
import type { ResolvedConfig } from '../config/load.js'
import { DOCS_FILE, SEARCH_INDEX_FILE } from '../mcp/source.js'
import type { EndpointSite } from './function/endpoint.js'

/** An address that has moved, and where it leads. */
export interface MovedAddress {
  /** The route that moved, without the site's base: `/old-page`. */
  from: string
  /** An address a browser can follow: a path with the site's base, in the site's style, or a full address. */
  to: string
}

export interface AdapterInput {
  config: ResolvedConfig
  /** The folder the build wrote: `dist/` in the site folder. */
  outDir: string
  /** The redirects the build wrote pages for. One that a page stands on is not among them. */
  moved: MovedAddress[]
}

export interface AdapterOutput {
  /** What was written, as paths from the site folder, for the build's report. */
  files: string[]
  /** What the person deploying should know. Printed under the report. */
  notes: string[]
}

export interface Adapter {
  name: AdapterName
  write(input: AdapterInput): Promise<AdapterOutput>
}

/* ───────────────────────────── addresses ────────────────────────────── */

/** A path of the site with the base in front. Unlike `withBase`, a slash at the end is kept. */
export function sitePath(base: string, pathname: string): string {
  return `${base.replace(/\/$/, '')}${pathname}`
}

/** Where the MCP route is on the deployed site, or undefined when the site has none. */
export function mcpAddress(config: ResolvedConfig): string | undefined {
  const { site, features } = config.config
  return features.mcp.enabled ? sitePath(site.base, features.mcp.route) : undefined
}

/** What the function is told about the site. `filesBase` is the path the host serves `dist/` from. */
export function endpointSite(routes: string[], filesBase: string): EndpointSite {
  return {
    routes: [...new Set(routes)],
    docs: sitePath(filesBase, `/${DOCS_FILE}`),
    index: sitePath(filesBase, `/${SEARCH_INDEX_FILE}`),
  }
}

/**
 * An address as it is sent: non-ASCII letters as percent escapes, which is
 * what a host compares a request with and what a `Location` header may
 * hold. Escapes that are already there are kept.
 */
export function wireAddress(address: string): string {
  try {
    if (isExternal(address)) return new URL(address).href
    const url = new URL(address, 'http://shabd.invalid')
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return address
  }
}

/**
 * The addresses a reader may ask for a page that has moved at, with the
 * site's base. A route has three (see `site.urls`): `/old`, `/old/` and
 * `/old.html`. Old links carry the one the site wrote at the time, which
 * need not be today's, so a host is told all three. Today's style is first.
 */
export function addressesOf(route: string, site: { base: string; urls: UrlStyle }): string[] {
  if (route === '/') return [...new Set([site.base, site.base.replace(/(.)\/$/, '$1')])]
  const own = pageUrl(route, site.urls)
  const all = [own, pageUrl(route, 'clean'), pageUrl(route, 'slash'), pageUrl(route, 'html')]
  return [...new Set(all)].map((address) => wireAddress(sitePath(site.base, address)))
}

/**
 * `*` and `:name` are patterns in the redirect rules of Cloudflare and
 * Netlify. An address that holds one cannot be written as a rule of its
 * own; the page the build wrote for it still sends the reader on.
 */
const RULE_PATTERN = /\*|:[A-Za-z]/

export function isLiteralSource(address: string): boolean {
  return !RULE_PATTERN.test(address)
}

export function isLiteralTarget(address: string): boolean {
  // The colon after a scheme and before a port is not a placeholder.
  const local = isExternal(address) ? address.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, '') : address
  return !RULE_PATTERN.test(local)
}

/** "1 redirect", "3 redirects". */
export const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

/** What becomes of a redirect a host was not told about. Ends each note that reports one. */
export const LEFT_TO_ITS_PAGE = 'Such an address is still answered by its page, which sends the reader on.'

/* ───────────────────────────── the function ─────────────────────────── */

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** `.ts` when this runs from the source (tests), `.js` from the published build. */
const EXTENSION = path.extname(fileURLToPath(import.meta.url))

/** The name each host's module in ./function exports its factory under. */
const FACTORY: Record<AdapterName, string> = {
  cloudflare: 'cloudflareWorker',
  vercel: 'vercelFunction',
  netlify: 'netlifyFunction',
}

/** The name the bundle gives the function. The lines an adapter adds after the bundle export it. */
export const FUNCTION = '__shabd_function'

const ENTRY = 'virtual:shabd/function'

/**
 * Bundle a host's function into one piece of JavaScript: Shabd's handler,
 * the MCP SDK and what they import, with nothing left to resolve where it
 * runs. Vite does it, as it does the rest of the build.
 *
 * The result is a script that defines one name, `FUNCTION`, and no other:
 * the bundle is wrapped in a function of its own. An adapter makes a module
 * of it by adding its `export` lines, and can add any it likes (Netlify
 * needs one called `config`) without meeting a name from inside the bundle.
 */
export async function bundleFunction(host: AdapterName, site: EndpointSite, config: ResolvedConfig): Promise<string> {
  const source = path.join(HERE, 'function', `${host}${EXTENSION}`)
  const entry: Plugin = {
    name: 'shabd:function',
    resolveId: (id) => (id === ENTRY ? `\0${ENTRY}` : undefined),
    load: (id) =>
      id === `\0${ENTRY}`
        ? `import { ${FACTORY[host]} } from ${JSON.stringify(source.split(path.sep).join('/'))}\n` +
          `export default ${FACTORY[host]}(${JSON.stringify(site)})\n`
        : undefined,
  }

  const result = await viteBuild({
    configFile: false,
    // The function reads nothing from the environment; the site's .env files are not its business.
    envDir: false,
    root: config.root,
    logLevel: 'warn',
    publicDir: false,
    cacheDir: path.join(config.cacheDir, 'vite'),
    plugins: [entry],
    // "webworker": every dependency is bundled, and none is resolved to a build of itself that needs Node.
    ssr: { noExternal: true, target: 'webworker' },
    build: {
      ssr: true,
      write: false,
      minify: true,
      target: 'es2022',
      copyPublicDir: false,
      rolldownOptions: {
        input: { function: ENTRY },
        output: { format: 'iife', name: FUNCTION, codeSplitting: false },
      },
    },
  })

  const outputs = (Array.isArray(result) ? result : [result]).flatMap((built) => ('output' in built ? built.output : []))
  const chunks = outputs.filter((file) => file.type === 'chunk')
  const [chunk] = chunks
  if (!chunk || chunks.length !== 1 || chunk.imports.length > 0 || chunk.dynamicImports.length > 0) {
    const loose = chunks.flatMap((file) => [...file.imports, ...file.dynamicImports])
    throw new Error(
      `shabd: the ${host} function did not bundle into one self-contained module` +
        (loose.length ? ` (it still imports ${loose.join(', ')})` : ''),
    )
  }
  return chunk.code.trimEnd()
}

/** The comment at the top of a generated file. */
export function banner(host: AdapterName, what: string): string {
  return `// ${what}\n// Written by shabd ${VERSION} (shabd build --adapter ${host}). The next build replaces it.\n`
}
