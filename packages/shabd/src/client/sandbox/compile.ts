/**
 * Turns the text of a live snippet into a React component, in the browser.
 *
 * Sucrase strips TypeScript and JSX (it is a fast syntax transform, not a
 * type checker) and is loaded on first use, so pages without a sandbox never
 * download it.
 *
 * A snippet is either a module that `export default`s a component, or a bare
 * JSX element, which is wrapped into one.
 */
import * as React from 'react'
import type { ComponentType } from 'react'

export type Scope = Record<string, unknown>

/** Modules a snippet may `import` from. Everything else is refused with a clear message. */
export type Modules = Record<string, unknown>

const HOOKS = ['useState', 'useEffect', 'useMemo', 'useRef', 'useReducer', 'useCallback', 'useId'] as const

let sucrase: Promise<typeof import('sucrase')> | undefined

export async function compileSnippet(source: string, scope: Scope, modules: Modules): Promise<ComponentType> {
  const code = source.trim()
  if (!code) throw new Error('The snippet is empty.')

  const isModule = /^\s*export\s+default\b/m.test(code)
  if (!isModule && !code.startsWith('<')) {
    throw new Error('A live snippet is either a single JSX element, or a module with `export default` for its component.')
  }
  const module = isModule ? code : `export default function Example() {\n  return (<>${code}</>)\n}`

  sucrase ??= import('sucrase')
  const { transform } = await sucrase
  const compiled = transform(module, {
    transforms: ['typescript', 'jsx', 'imports'],
    jsxRuntime: 'classic',
    production: true,
  }).code

  const available: Modules = { react: React, ...modules }
  const require = (name: string) => {
    if (name in available) return available[name]
    throw new Error(`Live snippets cannot import "${name}". Available: ${Object.keys(available).join(', ')}.`)
  }

  const names: Scope = { ...scope }
  for (const hook of HOOKS) names[hook] = React[hook]

  const exports: { default?: unknown } = {}
  // The snippet runs with the page's own privileges, like any other script on it.
  // It is the author's code, or the reader's own edits to it in their own browser.
  const run = new Function('React', 'require', 'exports', ...Object.keys(names), compiled)
  run(React, require, exports, ...Object.values(names))

  if (typeof exports.default !== 'function') {
    throw new Error('`export default` must be a component (a function or a class).')
  }
  return exports.default as ComponentType
}
