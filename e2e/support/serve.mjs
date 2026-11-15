/**
 * Starts a Shabd server for the browser tests on a fresh copy of the fixture
 * site, so tests can edit files without touching the fixture itself.
 *
 *     node e2e/support/serve.mjs dev      dev server on :4411
 *     node e2e/support/serve.mjs preview  static build, then preview on :4412
 *
 * The copies live inside the repository (e2e/.work) so that `react` and
 * `shabd/client` resolve from the repository's node_modules.
 */
import { cp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, dev, preview } from '../../packages/shabd/dist/node/index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const mode = process.argv[2]
const ports = { dev: 4411, preview: 4412 }
if (!(mode in ports)) throw new Error(`usage: serve.mjs <${Object.keys(ports).join('|')}>`)

const root = path.join(here, '..', '.work', mode)
await rm(root, { recursive: true, force: true })
await cp(path.join(here, '..', 'site'), root, { recursive: true })

// Options the tests switch on from the environment.
const configFile = path.join(root, 'shabd.config.yaml')
let config = await readFile(configFile, 'utf8')
if (process.env.SHABD_E2E_SEMANTIC) config = config.replace('semantic: false', 'semantic: true')
if (process.env.SHABD_E2E_STORE) config = config.replace('search: {', `search: { store: ${process.env.SHABD_E2E_STORE},`)
await writeFile(configFile, config)

if (mode === 'dev') {
  await dev(root, { port: ports.dev })
} else {
  await build(root)
  await preview(root, { port: ports.preview })
}
console.log(`shabd e2e ${mode} server ready on :${ports[mode]}`)
