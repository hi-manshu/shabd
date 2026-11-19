/**
 * The text of a live snippet, made into a script that can be run.
 *
 * The browser does this to run the snippet (src/client/sandbox), and
 * `shabd check` does it to find a snippet that cannot run before a reader
 * does. Sucrase strips TypeScript and JSX: it is a fast syntax transform, not
 * a type checker. It is loaded on first use, so a page with no sandbox on it
 * never downloads it.
 *
 * A snippet is either a module that `export default`s a component, or a bare
 * JSX element, which is wrapped into one.
 */

/** What every live snippet may import without a site saying so. More is named in `features.sandbox.modules`. */
export const SNIPPET_MODULES: readonly string[] = ['react', 'shabd/client', '@himanshoe/shabd/client']

/** A snippet as a script: it reads what it imports with `require`, and leaves its component on `exports`. */
export interface Transformed {
  code: string
  /** The modules it imports, in the order it names them. */
  needs: string[]
}

/** Why a snippet cannot be made into a script, and the line of the snippet the reason is on where that is known. */
export class SnippetError extends Error {
  readonly line: number | undefined

  constructor(message: string, line?: number) {
    super(message)
    this.name = 'SnippetError'
    this.line = line
  }
}

/**
 * Before a bare element, and on its first line: what closes it is on its last.
 * A line of the script is then the same line of the snippet.
 */
const WRAPPER = 'export default function Example() { return (<>'

let sucrase: Promise<typeof import('sucrase')> | undefined

export async function transformSnippet(source: string): Promise<Transformed> {
  // The empty lines before the first line with something on it go, and are counted: a line of the
  // script is then that many lines further down in the snippet as it was written.
  const lead = /^(?:[ \t]*\n)*/.exec(source)?.[0] ?? ''
  const skipped = lead.split('\n').length - 1
  const code = source.slice(lead.length).trimEnd()
  if (!code.trim()) throw new SnippetError('The snippet is empty.')

  const isModule = /^\s*export\s+default\b/m.test(code)
  if (!isModule && !code.trimStart().startsWith('<')) {
    throw new SnippetError('A live snippet is either a single JSX element, or a module with `export default` for its component.')
  }
  const module = isModule ? code : `${WRAPPER}${code}</>) }`

  sucrase ??= import('sucrase')
  const { transform } = await sucrase
  let compiled: string
  try {
    compiled = transform(module, {
      transforms: ['typescript', 'jsx', 'imports'],
      jsxRuntime: 'classic',
      production: true,
    }).code
  } catch (error) {
    const line = (error as { loc?: { line?: number } }).loc?.line
    throw new SnippetError(error instanceof Error ? error.message : String(error), line === undefined ? undefined : line + skipped)
  }

  // An `import` has become a `require` of the same name. Both are looked for: an import of types alone
  // is gone from the script and needs nothing, and the word `require` in a string of the snippet's is
  // not an import.
  const needs = new Set<string>()
  for (const [, , name] of module.matchAll(/^[ \t]*import\b[^'"]*?(['"])([^'"\n]+)\1/gm)) {
    if (compiled.includes(`require('${name}')`) || compiled.includes(`require("${name}")`)) needs.add(name!)
  }
  return { code: compiled, needs: [...needs] }
}
