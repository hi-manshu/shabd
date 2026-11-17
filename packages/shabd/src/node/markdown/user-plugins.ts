/**
 * The site's own remark and rehype plugins, and the ones Shabd loads for an
 * option that needs a package (`markdown.math`).
 *
 * A plugin is named in YAML, so it has to be found and imported before the
 * first page compiles:
 *
 *   markdown:
 *     remarkPlugins:
 *       - remark-emoji                        a package the site has installed
 *       - [remark-toc, { heading: contents }]  with options
 *       - ./plugins/shout.mjs                  a file of the site's own
 *
 * A package is looked for where the site would find it, then where Shabd
 * would. A name that leads nowhere, or to something that is not a plugin,
 * is an error on its line of the config, like any other mistake in it.
 */
import { stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ShabdError } from '../config/errors.js'
import type { ResolvedConfig } from '../config/load.js'
import { resolveFromPackage } from '../paths.js'

/** A plugin with its options, in the form unified takes. */
export type Plugin = [plugin: (...args: never[]) => unknown, options?: unknown]

export interface UserPlugins {
  remark: Plugin[]
  rehype: Plugin[]
  /** Runs on the HTML tree before code is highlighted: for plugins that turn a kind of code into something else. */
  rehypeBeforeCode: Plugin[]
  /** Changes when a plugin's file changes, so that pages compiled with the one before it are not reused. */
  fingerprint: string
}

type PluginPath = (string | number)[]

const isFile = (name: string) => name.startsWith('.') || path.isAbsolute(name)

/**
 * The stylesheet typeset maths needs, or undefined when the packages are not
 * there. KaTeX comes with `rehype-katex` and is looked for from where that
 * package is, since a strict package manager keeps it nowhere else.
 */
export function mathStylesheet(root: string): string | undefined {
  const katex = resolvePlugin(root, 'rehype-katex')
  if (!katex) return undefined
  try {
    return createRequire(katex).resolve('katex/dist/katex.min.css')
  } catch {
    return undefined
  }
}

/** The file a plugin name stands for, or undefined when there is none. */
function resolvePlugin(root: string, name: string): string | undefined {
  if (isFile(name)) return path.resolve(root, name)
  try {
    return createRequire(path.join(root, 'package.json')).resolve(name)
  } catch {
    return resolveFromPackage(name)
  }
}

async function load(config: ResolvedConfig, name: string, at: PluginPath, what: string): Promise<{ plugin: Plugin[0]; stamp: string }> {
  const fail = (message: string): never => {
    throw new ShabdError(config.configFile, [{ path: at, message, ...config.locate(at) }])
  }
  const file = resolvePlugin(config.root, name)
  if (!file) return fail(`${what} "${name}" is not installed. Install it in the site: npm install ${name}`)

  let module: { default?: unknown }
  try {
    module = (await import(pathToFileURL(file).href)) as { default?: unknown }
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND'
    return fail(
      missing && isFile(name)
        ? `File not found: ${name} (looked in ${file})`
        : `${what} "${name}" could not be loaded: ${(error as Error).message}`,
    )
  }
  const plugin = module.default
  if (typeof plugin !== 'function') return fail(`"${name}" does not export a plugin. A plugin is the default export of its module`)
  // When the file was written stands for what is in it: a plugin of the site's own that was edited, or a
  // package that was upgraded, compiles pages differently from the one before it.
  return { plugin: plugin as Plugin[0], stamp: `${file}:${(await stat(file)).mtimeMs}` }
}

export async function loadUserPlugins(config: ResolvedConfig): Promise<UserPlugins> {
  const { markdown } = config.config
  const stamps: string[] = []

  const list = async (key: 'remarkPlugins' | 'rehypePlugins'): Promise<Plugin[]> => {
    const plugins: Plugin[] = []
    for (const [index, ref] of markdown[key].entries()) {
      const { plugin, stamp } = await load(config, ref.name, ['markdown', key, index], 'The plugin')
      plugins.push(ref.options === undefined ? [plugin] : [plugin, ref.options])
      stamps.push(stamp)
    }
    return plugins
  }

  const remark = await list('remarkPlugins')
  const rehype = await list('rehypePlugins')
  const rehypeBeforeCode: Plugin[] = []

  if (markdown.math) {
    const at = ['markdown', 'math']
    const math = await load(config, 'remark-math', at, 'Maths needs two packages, remark-math and rehype-katex. The package')
    const katex = await load(config, 'rehype-katex', at, 'Maths needs two packages, remark-math and rehype-katex. The package')
    // Before the site's own plugins, so that they see maths as maths and not as dollar signs.
    remark.unshift([math.plugin])
    // remark-math hands display maths on as a code block. It has to become maths before code is highlighted.
    rehypeBeforeCode.push([katex.plugin])
    stamps.push(math.stamp, katex.stamp)
  }

  return { remark, rehype, rehypeBeforeCode, fingerprint: stamps.join('|') }
}
