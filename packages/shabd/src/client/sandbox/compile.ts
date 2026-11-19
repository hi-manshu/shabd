/**
 * Turns the text of a live snippet into a React component, in the browser.
 *
 * The text is made into a script by src/shared/snippet.ts, which `shabd check`
 * uses too. Here the script is given what it imports, and run.
 */
import * as React from 'react'
import type { ComponentType } from 'react'
import { transformSnippet } from '../../shared/snippet.js'

export type Scope = Record<string, unknown>

/** Modules every snippet may `import` from, already here. */
export type Modules = Record<string, unknown>

/**
 * Modules a site lets its snippets import (`features.sandbox.modules`). Each
 * is fetched when a snippet first names it, and not before.
 */
export type Loaders = Record<string, () => Promise<Record<string, unknown>>>

const HOOKS = ['useState', 'useEffect', 'useMemo', 'useRef', 'useReducer', 'useCallback', 'useId'] as const

export async function compileSnippet(source: string, scope: Scope, modules: Modules, loaders: Loaders = {}): Promise<ComponentType> {
  const { code, needs } = await transformSnippet(source)

  const available: Modules = { react: React, ...modules }
  await Promise.all(
    needs
      .filter((name) => !Object.hasOwn(available, name) && Object.hasOwn(loaders, name))
      .map(async (name) => {
        try {
          // The mark is how the script knows to take `default` from among the exports, and not to
          // take the whole module for it.
          available[name] = { ...(await loaders[name]!()), __esModule: true }
        } catch (error) {
          throw new Error(`"${name}" could not be loaded: ${error instanceof Error ? error.message : String(error)}`)
        }
      }),
  )

  const offered = [...new Set([...Object.keys(available), ...Object.keys(loaders)])]
  const require = (name: string) => {
    if (Object.hasOwn(available, name)) return available[name]
    if (Object.hasOwn(loaders, name)) {
      // It was not fetched, because no `import` named it: the snippet called `require` itself.
      throw new Error(`Import "${name}" with an \`import\` at the top of the snippet, so that it can be fetched before the snippet runs.`)
    }
    throw new Error(`Live snippets cannot import "${name}". Available: ${offered.join(', ')}.`)
  }

  const names: Scope = { ...scope }
  for (const hook of HOOKS) names[hook] = React[hook]

  const exports: { default?: unknown } = {}
  // The snippet runs with the page's own privileges, like any other script on it.
  // It is the author's code, or the reader's own edits to it in their own browser.
  const run = new Function('React', 'require', 'exports', ...Object.keys(names), code)
  run(React, require, exports, ...Object.values(names))

  if (typeof exports.default !== 'function') {
    throw new Error('`export default` must be a component (a function or a class).')
  }
  return exports.default as ComponentType
}
