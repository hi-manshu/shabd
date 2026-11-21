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
import { readdirSync, readFileSync } from 'node:fs'
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
