/**
 * Runs a source site's config file to read what it exports.
 *
 * Docusaurus, VitePress and Starlight keep their navigation in JavaScript
 * or TypeScript, so the only way to read it is to run it. A plain
 * `import()` of the file does not get far:
 *
 *   - The file imports the tool it configures (`vitepress`, `astro/config`),
 *     which is installed in the source site, if at all, and not where
 *     `shabd import` runs.
 *   - Starlight's options are an argument to a function call. What the
 *     config exports is what that function returns, which no longer shows
 *     them. Only something standing in for the package can see them.
 *   - A TypeScript file has to have its types removed first, and the result
 *     would have to be written next to the original for its own imports to
 *     resolve. The source folder is never written to.
 *
 * So the file is compiled in memory (Sucrase removes the types and turns
 * `import` into `require`) and run with a `require` of our own. That
 * `require` follows relative imports the same way, hands out stand-ins for
 * the packages a caller names, loads any other package from the source's
 * node_modules if it is there, and otherwise stands in for it: an object
 * that can be called or read from and always answers with itself.
 *
 * This runs code from the source folder, as the source tool does on every
 * build. It can still fail: top-level `await`, a config that needs its tool
 * for real. Callers treat a failure as "no navigation to read".
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createRequire, isBuiltin } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { transform } from 'sucrase'

const STAND_IN = Symbol('shabd.import.stand-in')

/** Something to put in the place of a package that is not there. */
export function standIn(name: string): unknown {
  const proxy: unknown = new Proxy(function () {}, {
    get(_target, key) {
      if (key === STAND_IN) return name
      // Not a promise, and not something to wait for.
      if (key === 'then') return undefined
      if (key === Symbol.iterator) return function* () {}
      if (key === Symbol.toPrimitive) return () => `[${name}]`
      return proxy
    },
    apply: () => proxy,
    construct: () => proxy as object,
  })
  return proxy
}

/**
 * What importing a package gives, when a caller stands in for it: the
 * exports it names, and a stand-in for any other.
 */
export function provide(name: string, exports: Record<string, unknown>): unknown {
  return new Proxy({ __esModule: true, ...exports } as Record<string | symbol, unknown>, {
    get: (known, key) => (key in known ? known[key] : standIn(`${name}.${String(key)}`)),
  })
}

/** True for a stand-in, and so for any value that was read from one or returned by one. */
export function isStandIn(value: unknown): boolean {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false
  return (value as Record<symbol, unknown>)[STAND_IN] !== undefined
}

const isFile = (file: string) => existsSync(file) && statSync(file).isFile()
const SCRIPT = /\.[cm]?[jt]s$/
const EXTENSIONS = ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json']

/** The file a relative import names. TypeScript sources import `./nav.js` and mean `./nav.ts`. */
function resolveLocal(target: string): string | undefined {
  const candidates = [
    target,
    ...EXTENSIONS.map((extension) => target + extension),
    target.replace(/\.([cm]?)js$/, '.$1ts'),
    ...EXTENSIONS.map((extension) => path.join(target, `index${extension}`)),
  ]
  return candidates.find(isFile)
}

/** `@scope/name/sub/path` → `@scope/name`. */
const packageOf = (specifier: string) => specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/')

export interface Evaluated {
  /** The default export, or `module.exports`. A function is called, and a promise waited for. */
  config: unknown
  /** Packages the file imports that are not installed in the source and were stood in for. */
  missing: string[]
}

/**
 * Run `file` and return what it exports. `provided` maps a package name to
 * what importing it gives, for the packages a caller wants to stand in for
 * itself. Throws when the file cannot be compiled or run.
 */
export async function evaluateConfig(file: string, provided: Record<string, unknown> = {}): Promise<Evaluated> {
  const missing = new Set<string>()
  const loaded = new Map<string, { exports: unknown }>()

  const load = (target: string): unknown => {
    const known = loaded.get(target)
    if (known) return known.exports
    const module = { exports: {} as unknown }
    // Before it runs, so that two files that import each other both finish.
    loaded.set(target, module)

    if (target.endsWith('.json')) {
      module.exports = JSON.parse(readFileSync(target, 'utf8'))
      return module.exports
    }
    // A stylesheet, a Vue component: nothing a config's navigation is made of.
    if (!SCRIPT.test(target)) {
      module.exports = standIn(path.basename(target))
      return module.exports
    }

    const { code } = transform(readFileSync(target, 'utf8'), {
      transforms: /\.[cm]?ts$/.test(target) ? ['typescript', 'imports'] : ['imports'],
      filePath: target,
      preserveDynamicImport: true,
    })
    const fromSource = createRequire(target)
    const isLocal = (specifier: string) => specifier.startsWith('.') || path.isAbsolute(specifier)
    const local = (specifier: string) => resolveLocal(path.resolve(path.dirname(target), specifier))
    const require = (specifier: string): unknown => {
      if (Object.hasOwn(provided, specifier)) return provided[specifier]
      if (isBuiltin(specifier)) return fromSource(specifier)
      if (isLocal(specifier)) {
        const found = local(specifier)
        if (!found) throw new Error(`${path.basename(target)} imports ${specifier}, which is not there`)
        return load(found)
      }
      try {
        return fromSource(specifier)
      } catch {
        missing.add(packageOf(specifier))
        return standIn(specifier)
      }
    }
    // Docusaurus configs name their sidebar file with `require.resolve('./sidebars.js')`.
    require.resolve = (specifier: string): string => {
      if (isLocal(specifier)) return local(specifier) ?? path.resolve(path.dirname(target), specifier)
      try {
        return fromSource.resolve(specifier)
      } catch {
        return specifier
      }
    }
    const meta = { url: pathToFileURL(target).href, filename: target, dirname: path.dirname(target), env: {} }
    // `import.meta` only exists in a module, and this runs as a function.
    const body = code.replace(/\bimport\.meta\b/g, '__import_meta')
    const run = new Function('exports', 'require', 'module', '__filename', '__dirname', '__import_meta', body) as (
      ...args: unknown[]
    ) => void
    run(module.exports, require, module, target, path.dirname(target), meta)
    return module.exports
  }

  const exported = load(path.resolve(file))
  let config = exported !== null && typeof exported === 'object' && 'default' in exported ? exported.default : exported
  // Docusaurus and VitePress both accept a function that returns the config.
  if (typeof config === 'function' && !isStandIn(config)) config = (config as () => unknown)()
  return { config: await config, missing: [...missing].sort() }
}

/** A plain object, and not a stand-in: something whose keys can be trusted. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !isStandIn(value)
}

export const asString = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value : undefined)

/** The first line of whatever was thrown, for a report. */
export function reason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.split('\n')[0]!.trim()
}
