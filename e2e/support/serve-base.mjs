/**
 * Starts `shabd dev` on a copy of the fixture site that is not at the root of
 * its host: `site.base` is `/docs/`, as a project page on GitHub Pages has it.
 *
 *     node e2e/support/serve-base.mjs
 *
 * It takes whichever port is free and says which on its last line. The test
 * that starts it (e2e/base.spec.ts) reads the port from there and stops the
 * server when it is done.
 */
import { cp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dev } from '../../packages/shabd/dist/node/index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..', '.work', 'base')
await rm(root, { recursive: true, force: true })
await cp(path.join(here, '..', 'site'), root, { recursive: true })

const configFile = path.join(root, 'shabd.config.yaml')
const config = await readFile(configFile, 'utf8')
if (!config.includes('  title: Fixture\n')) throw new Error('The fixture has no "title: Fixture" line to put the base after.')
await writeFile(configFile, config.replace('  title: Fixture\n', '  title: Fixture\n  base: /docs/\n'))

const server = await dev(root, { port: 0 })
console.log(`shabd e2e base server ready on :${server.httpServer.address().port}`)
