/**
 * `shabd build --adapter <host>`: the MCP endpoint on a host that runs code.
 *
 * A build is static files, and `/mcp` answers POST, which static hosting
 * cannot do. Each adapter writes one self-contained function in the place
 * its host looks for one, so that deploying the site deploys the endpoint.
 * The function is src/node/mcp/hosted.ts and the host's few lines from
 * src/node/mcp/hosts/, bundled with their dependencies into a single file.
 *
 *   cloudflare   dist/_worker.js and dist/_routes.json (Pages, advanced mode)
 *   vercel       .vercel/output/ (Build Output API): the site under static/,
 *                the function under functions/
 *   netlify      .netlify/v1/edge-functions/shabd-mcp.js (Frameworks API)
 */
import { existsSync } from 'node:fs'
import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build as viteBuild } from 'vite'

export const ADAPTERS = ['cloudflare', 'vercel', 'netlify'] as const
export type AdapterName = (typeof ADAPTERS)[number]

export function isAdapter(name: string): name is AdapterName {
  return (ADAPTERS as readonly string[]).includes(name)
}

export interface AdapterInput {
  /** The site's folder. */
  root: string
  /** Where the static site was written. */
  outDir: string
  /** The sub-path the site is served from, with a slash at both ends. */
  base: string
}

/** The host's entry: compiled JavaScript in a published package, TypeScript when run from source. */
function entryOf(name: AdapterName): string {
  const compiled = fileURLToPath(new URL(`../mcp/hosts/${name}.js`, import.meta.url))
  return existsSync(compiled) ? compiled : compiled.replace(/\.js$/, '.ts')
}

/** One module with everything in it: the handler, the MCP SDK, and no imports left. */
async function bundle(name: AdapterName, base: string): Promise<string> {
  const result = await viteBuild({
    configFile: false,
    logLevel: 'error',
    define: { __SHABD_BASE__: JSON.stringify(base) },
    build: {
      ssr: entryOf(name),
      write: false,
      minify: true,
      target: 'es2022',
      rolldownOptions: { output: { format: 'es' } },
    },
    // A worker, not Node: nothing is left to be resolved where the function runs.
    ssr: { target: 'webworker', noExternal: true },
  })
  const outputs = Array.isArray(result) ? result : [result]
  for (const output of outputs) {
    if (!('output' in output)) continue
    const chunks = output.output.filter((item) => item.type === 'chunk')
    if (chunks.length === 1) return chunks[0]!.code
    throw new Error(`Expected the ${name} function to bundle into one file, got ${chunks.length}.`)
  }
  throw new Error(`The ${name} function could not be bundled.`)
}

/** Write the function for a host. Returns what was written, relative to the site's folder. */
export async function writeAdapter(name: AdapterName, { root, outDir, base }: AdapterInput): Promise<string[]> {
  const code = await bundle(name, base)
  const written: string[] = []
  const put = async (file: string, contents: string) => {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, contents)
    written.push(path.relative(root, file))
  }
  const route = `${base}mcp`

  if (name === 'cloudflare') {
    await put(path.join(outDir, '_worker.js'), code)
    // Only the MCP route needs the Worker. Everything else is a static file, served without running it.
    await put(path.join(outDir, '_routes.json'), `${JSON.stringify({ version: 1, include: [route], exclude: [] }, null, 2)}\n`)
  }

  if (name === 'vercel') {
    // Vercel serves what is under .vercel/output and nothing else, so the site goes there too.
    const output = path.join(root, '.vercel', 'output')
    await rm(output, { recursive: true, force: true })
    const under = base.replace(/^\/|\/$/g, '')
    await cp(outDir, path.join(output, 'static', under), { recursive: true })
    written.push(path.relative(root, path.join(output, 'static')))
    await put(path.join(output, 'config.json'), `${JSON.stringify({ version: 3 }, null, 2)}\n`)
    const func = path.join(output, 'functions', under, 'mcp.func')
    await put(path.join(func, 'index.js'), code)
    await put(path.join(func, '.vc-config.json'), `${JSON.stringify({ runtime: 'edge', entrypoint: 'index.js' }, null, 2)}\n`)
  }

  if (name === 'netlify') {
    // Netlify reads `config` from the text of the file, and takes literal values only.
    const config = `\nexport const config = { path: ${JSON.stringify(route)} };\n`
    await put(path.join(root, '.netlify', 'v1', 'edge-functions', 'shabd-mcp.js'), code + config)
  }

  return written
}
