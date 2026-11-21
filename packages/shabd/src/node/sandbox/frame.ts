/**
 * The script that runs inside the frame of an isolated snippet.
 *
 * A snippet marked `isolated` runs in a frame that can reach nothing of the
 * page: not its document, not its storage, not its address. Such a frame has
 * an origin of its own, so it cannot fetch the site's modules either: a host
 * would have to allow every origin to read them, and the dev server does not.
 * So everything the frame runs is one script, which the page hands to it:
 * React, the code that puts a snippet on the screen, and the modules the site
 * lets its snippets import (`features.sandbox.modules`).
 *
 * That script is made here, with a build of its own. A site with no isolated
 * snippet never has it made.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build, normalizePath } from 'vite'
import type { ResolvedConfig } from '../config/load.js'
import { CLIENT_DIR, packageName } from '../paths.js'

export interface FrameRuntime {
  /** The script, as one piece of text with nothing left to fetch. */
  code: string
  /** The files of the site that went into it. A change to one of them makes the script out of date. */
  files: string[]
}

/** The first line of the script, for whoever opens a frame's source to see what it is running. */
export const FRAME_BANNER = '/* Shabd: what runs in the frame of an isolated snippet. */'

/** What `shabd/client` is inside a frame: see src/client/sandbox/frame/client.ts. */
const FRAME_CLIENT = path.join(CLIENT_DIR, 'sandbox', 'frame', 'client.ts')
const FRAME_RUNTIME = path.join(CLIENT_DIR, 'sandbox', 'frame', 'runtime.tsx')

export async function buildFrameRuntime(config: ResolvedConfig, dev: boolean): Promise<FrameRuntime> {
  // The entry is a file, in the cache folder of the site: what it imports by name is then looked for
  // where the site's own packages are.
  const entry = path.join(config.cacheDir, 'sandbox-frame-entry.js')
  const loaders = config.sandboxModules.map(
    ({ name, from }) => `  ${JSON.stringify(name)}: () => import(${JSON.stringify(path.isAbsolute(from) ? normalizePath(from) : from)}),`,
  )
  const source = `import { startFrame } from ${JSON.stringify(normalizePath(FRAME_RUNTIME))}\n\nstartFrame({\n${loaders.join('\n')}\n})\n`
  // Written only when it says something new. The dev server watches the site's folder, and a file
  // that is written again is a file that changed.
  if ((await readFile(entry, 'utf8').catch(() => undefined)) !== source) {
    await mkdir(path.dirname(entry), { recursive: true })
    await writeFile(entry, source)
  }

  const names = [...new Set(['shabd', '@himanshoe/shabd', packageName()])].map((name) => name.replace(/[/@-]/g, '\\$&'))
  const mode = dev ? 'development' : 'production'
  const result = await build({
    configFile: false,
    root: config.root,
    mode,
    logLevel: 'silent',
    publicDir: false,
    // A library build leaves this for whoever bundles the library. Here nobody does.
    define: { 'process.env.NODE_ENV': JSON.stringify(mode) },
    resolve: {
      alias: [{ find: new RegExp(`^(?:${names.join('|')})/client$`), replacement: FRAME_CLIENT }],
      dedupe: ['react', 'react-dom'],
    },
    build: {
      write: false,
      minify: !dev,
      reportCompressedSize: false,
      // One file: a frame cannot fetch a second, and this kind of script is never split into several.
      lib: { entry, formats: ['iife'], name: 'ShabdFrame' },
    },
  })

  const outputs = (Array.isArray(result) ? result : [result]).flatMap((built) => ('output' in built ? built.output : []))
  const chunk = outputs.find((file) => file.type === 'chunk' && file.isEntry)
  if (!chunk || chunk.type !== 'chunk') throw new Error('The script for isolated snippets could not be built.')
  // Stylesheets that a module imports are written apart from the script. They go in with it.
  const css = outputs.flatMap((file) => (file.type === 'asset' && file.fileName.endsWith('.css') ? [String(file.source)] : [])).join('\n')
  const styles = css ? `(function(){var s=document.createElement("style");s.textContent=${JSON.stringify(css)};document.head.appendChild(s)})();\n` : ''

  return {
    code: `${FRAME_BANNER}\n${styles}${chunk.code}`,
    // Not the entry, which is made here: writing it is not a change to the site.
    files: chunk.moduleIds
      .map((id) => id.split('?')[0]!)
      .filter((id) => path.isAbsolute(id) && !id.includes('/node_modules/') && path.resolve(id) !== path.resolve(entry)),
  }
}
