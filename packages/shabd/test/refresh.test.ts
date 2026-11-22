/**
 * Fast Refresh while the theme's own source is edited.
 *
 * React can take a change to a module in place only when everything the
 * module exports is a component. A module that exports a component beside a
 * hook, a helper or a table is not one of those: a change to it goes to the
 * modules that import it, and for a module as central as the router that was
 * a whole page started again. So a component lives in a file of its own, and
 * this test holds every file of the client to that.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const CLIENT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'client')

/** What a file exports by name, apart from types: components, and everything else. */
function exportsOf(source: string): { components: string[]; others: string[] } {
  const components: string[] = []
  const others: string[] = []
  const note = (name: string, component: boolean) => (component ? components : others).push(name)
  // A function or a class named like a component is one. A hook is named `useSomething`, a helper in lower case.
  for (const [, name] of source.matchAll(/^export\s+(?:default\s+)?(?:async\s+)?(?:function|class)\s+([A-Za-z0-9_$]+)/gm)) note(name!, /^[A-Z]/.test(name!))
  // A constant is a component when it is a function with such a name: not a context, and not a table in capitals.
  for (const [, name, value] of source.matchAll(/^export\s+(?:const|let)\s+([A-Za-z0-9_$]+)[^=\n]*=\s*([^\n]*)/gm)) {
    note(name!, /^[A-Z][a-z]/.test(name!) && /^(?:\(|async\b|function\b|memo\(|forwardRef\(|lazy\()/.test(value!.trim()))
  }
  for (const [, names] of source.matchAll(/^export\s+\{([^}]+)\}/gm)) {
    for (const part of names!.split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()!
      if (name && !part.trim().startsWith('type ')) note(name, /^[A-Z][a-z]/.test(name))
    }
  }
  return { components, others }
}

describe('a file of the client that exports a component', () => {
  const files = (readdirSync(CLIENT, { recursive: true }) as string[]).filter((file) => /\.tsx$/.test(file)).sort()

  it('exports nothing beside components, so that a change to it is taken in place', () => {
    const mixed = files.flatMap((file) => {
      const { components, others } = exportsOf(readFileSync(path.join(CLIENT, file), 'utf8'))
      return components.length > 0 && others.length > 0 ? [`${file}: ${components.join(', ')} beside ${others.join(', ')}`] : []
    })
    expect(mixed).toEqual([])
  })

  it('is told from a hook, a helper, a context and a table', () => {
    expect(exportsOf('export function Link() {}\nexport function useHref() {}\nexport const ICONS = {}\nexport const PageContext = createContext(null)\n')).toEqual({
      components: ['Link'],
      others: ['useHref', 'ICONS', 'PageContext'],
    })
    expect(exportsOf('export const Card = memo(function Card() {})\nexport default function Sandbox() {}\nexport type { IconName }\nexport { Icon, hasIcon }\n')).toEqual({
      components: ['Sandbox', 'Card', 'Icon'],
      others: ['hasIcon'],
    })
  })

  it('is what the router and the links were split for', () => {
    // The files that mixed the two, as they are now.
    const of = (file: string) => exportsOf(readFileSync(path.join(CLIENT, file), 'utf8'))
    expect(of('app/RouterProvider.tsx')).toEqual({ components: ['RouterProvider'], others: [] })
    expect(of('app/router.tsx').components).toEqual([])
    expect(of('ui/Link.tsx')).toEqual({ components: ['Link'], others: [] })
    expect(of('app/icons.tsx')).toEqual({ components: ['Icon'], others: [] })
    expect(of('studio/PageActions.tsx')).toEqual({ components: ['PageActions'], others: [] })
  })
})

/**
 * A hot update gives each module that takes it a fresh copy of the modules
 * between it and the one that changed. A component's file takes an update by
 * itself, so a module that stands above one, and that keeps something for
 * the life of the page, can come to exist twice: the router's contexts did,
 * and the header was then "used outside the Shabd app". A module with
 * nothing but plain modules below it cannot: a change below it reaches the
 * app's entry, and the page starts again.
 */
describe('a module of the client that keeps something for the life of the page', () => {
  /** A file by its path from the client's folder, with `/` between its folders on every system. */
  const named = (file: string) => file.split(path.sep).join('/')
  const files = (readdirSync(CLIENT, { recursive: true }) as string[])
    .map(named)
    .filter((file) => /\.tsx?$/.test(file) && !file.endsWith('.d.ts'))
    .sort()
  const source = new Map(files.map((file) => [file, readFileSync(path.join(CLIENT, file), 'utf8')]))

  /** The file of the client a module imports from, for an import that is not of types alone. */
  const resolve = (from: string, specifier: string): string | undefined => {
    if (!specifier.startsWith('.')) return undefined
    const base = path.join(path.dirname(path.join(CLIENT, from)), specifier.replace(/\.js$/, ''))
    for (const ending of ['.ts', '.tsx', '/index.ts', '/index.tsx']) if (existsSync(base + ending)) return named(path.relative(CLIENT, base + ending))
    return undefined
  }
  const imports = (file: string): string[] =>
    [...source.get(file)!.matchAll(/^import\s+(?!type\b)[^'"]*?from\s+['"]([^'"]+)['"]/gm)].flatMap(([, specifier]) => {
      const found = resolve(file, specifier!)
      return found && source.has(found) ? [found] : []
    })
  const below = (file: string, seen = new Set<string>()): Set<string> => {
    for (const next of imports(file)) {
      if (seen.has(next)) continue
      seen.add(next)
      below(next, seen)
    }
    return seen
  }
  /** A file that takes a hot update by itself: every export of it is a component. */
  const takesUpdates = (file: string) => {
    const { components, others } = exportsOf(source.get(file)!)
    return file.endsWith('.tsx') && components.length > 0 && others.length === 0
  }
  /** What a file makes once and keeps: a context, a store, a table, or a variable it writes to. */
  const keeps = (file: string): string[] => [
    ...[...source.get(file)!.matchAll(/^(?:export\s+)?(?:const|let)\s+([A-Za-z0-9_$]+)[^=\n]*=\s*(?:createContext|createStore|new Map|new Set|new WeakMap)\b/gm)].map(([, name]) => name!),
    ...[...source.get(file)!.matchAll(/^let\s+([A-Za-z0-9_$]+)/gm)].map(([, name]) => name!),
  ]

  it('does not stand above a component, or keeps it through a hot update', () => {
    const exposed = files.flatMap((file) => {
      if (takesUpdates(file) || keeps(file).length === 0) return []
      const components = [...below(file)].filter(takesUpdates)
      // `import.meta.hot.data` is the same for every copy of a module.
      return components.length > 0 && !/import\.meta\.hot\??\.data/.test(source.get(file)!) ? [`${file} keeps ${keeps(file).join(', ')} above ${components[0]}`] : []
    })
    expect(exposed).toEqual([])
  })

  it('finds the stores and the tables there are, so that the check above is of something', () => {
    const keeping = files.filter((file) => !takesUpdates(file) && keeps(file).length > 0)
    expect(keeping).toEqual(expect.arrayContaining(['app/hmr.ts', 'app/store.ts', 'app/ui.ts', 'sandbox/shared-state.ts', 'search/client.ts']))
    // The router stands above the page that says a page was not found, and keeps its contexts through an update.
    expect([...below('app/router.tsx')].filter(takesUpdates)).toContain('app/NotFound.tsx')
    expect(source.get('app/router.tsx')).toContain('import.meta.hot?.data')
  })
})
