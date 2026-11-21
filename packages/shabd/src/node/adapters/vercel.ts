/**
 * Vercel, through its Build Output API (version 3). Vercel deploys the
 * folder `.vercel/output/` as it finds it, so the whole deployment is
 * written there, in the site folder:
 *
 *   config.json                The routes: the site's `redirects:` as 301s,
 *                              then the files, then the 404 page.
 *   static/                    A copy of dist/, under the site's base.
 *   functions/<route>.func/    The function, at the address of the MCP route.
 *     .vc-config.json          How Vercel runs it: on Node.js.
 *     index.mjs                The function.
 *
 * The function is at the route's own address and nowhere else, so no other
 * request runs it: Vercel serves the files in `static/` from its CDN.
 *
 * It runs on Node.js, not on Vercel's Edge runtime. Vercel now recommends
 * Node.js over Edge. Edge allows 1 MB to 4 MB of code, depending on the
 * plan, where a Node.js function may be 250 MB and has 2 GB of memory for
 * the index that the first search of a site builds.
 *
 * Two things here are not in Vercel's documentation of the Build Output
 * API, and are not tested on Vercel. Its example function is CommonJS
 * (`module.exports`); this one is an ES module in a file named `.mjs`,
 * with the function as its default export. And that a page written as
 * `guide/install/index.html` answers at `/guide/install` is something
 * Vercel's own presets for static site generators rely on, not something
 * the documentation states.
 *
 * What this follows, as read on 17 November 2026:
 *
 *   https://vercel.com/docs/build-output-api/configuration
 *     `config.json`: `version`, `routes` (`src`, `status`, `headers`,
 *     `dest`, `handle`), `framework`
 *   https://vercel.com/docs/build-output-api/primitives
 *     `static/`, `functions/<name>.func/`, `.vc-config.json` (`runtime`,
 *     `handler`, `launcherType`, `shouldAddHelpers`)
 *   https://vercel.com/docs/functions/runtimes/edge
 *     the recommendation, and the limit on the size of an Edge function
 *   https://vercel.com/docs/functions/limitations
 *     250 MB and 2 GB for a function on Node.js
 *   https://github.com/vercel/examples/tree/main/build-output-api/serverless-functions
 *     a Node.js function is called with Node's request and response
 *   https://github.com/vercel/vercel/blob/main/packages/frameworks/src/frameworks.ts
 *     the two routes Vercel's own presets for static generators end with:
 *     `{ handle: 'filesystem' }`, then every other address to 404.html
 *   https://vercel.com/docs/functions/runtimes/node-js/node-js-versions
 *     the versions on offer: 26.x, 24.x and 22.x
 *   https://vercel.com/docs/routing/redirects/configuration-redirects#limits
 *     2,048 redirects, of 4,096 characters
 */
import { constants } from 'node:fs'
import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { VERSION } from '../../shared/version.js'
import {
  addressesOf,
  banner,
  bundleFunction,
  count,
  endpointSite,
  FUNCTION,
  LEFT_TO_ITS_PAGE,
  mcpAddress,
  sitePath,
  wireAddress,
  type Adapter,
} from './shared.js'

/** Vercel's limits on redirects. */
const MAX_REDIRECTS = 2048
const MAX_LENGTH = 4096

/**
 * The Node.js the function runs on: the major version the build ran on,
 * which on Vercel is the one the project is set to. Vercel offers the even
 * versions, so an odd one is rounded down, and nothing older than Shabd
 * itself needs is asked for.
 */
export function vercelRuntime(nodeVersion: string = process.versions.node): string {
  const major = Number(nodeVersion.split('.')[0]) || 22
  return `nodejs${Math.max(22, major - (major % 2))}.x`
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const vercel: Adapter = {
  name: 'vercel',

  async write({ config, outDir, moved }) {
    const { site } = config.config
    const output = path.join(config.root, '.vercel', 'output')
    const files: string[] = []
    const notes: string[] = []
    const write = async (file: string, contents: string) => {
      await mkdir(path.dirname(path.join(output, file)), { recursive: true })
      await writeFile(path.join(output, file), contents)
    }

    // Vercel deploys everything in this folder: nothing of an earlier build may be left in it.
    await rm(output, { recursive: true, force: true })

    // Files in static/ are served at their own paths, so the base is a folder. Cloned where the
    // file system can (a copy that takes no space until one side changes), copied where it cannot.
    const staticDir = path.join(output, 'static', ...site.base.split('/').filter(Boolean))
    await mkdir(path.dirname(staticDir), { recursive: true })
    await cp(outDir, staticDir, { recursive: true, mode: constants.COPYFILE_FICLONE })

    const redirects: { src: string; status: number; headers: { Location: string } }[] = []
    let unwritable = 0
    for (const { from, to } of moved) {
      // Vercel puts what a pattern matched where a `$1` stands, so a dollar sign of the address's own is escaped.
      const location = wireAddress(to).replace(/\$/g, '%24')
      const src = `^(?:${addressesOf(from, site).map(escapeRegex).join('|')})$`
      if (src.length <= MAX_LENGTH && location.length <= MAX_LENGTH && redirects.length < MAX_REDIRECTS) {
        redirects.push({ src, status: 301, headers: { Location: location } })
      } else {
        unwritable++
      }
    }
    if (unwritable) {
      notes.push(
        `${count(unwritable, 'redirect')} could not be written as a route for Vercel, which takes ${MAX_REDIRECTS} ` +
          `of up to ${MAX_LENGTH} characters. ${LEFT_TO_ITS_PAGE}`,
      )
    }

    await write(
      'config.json',
      `${JSON.stringify(
        {
          version: 3,
          routes: [
            // Before the files, or the page the build wrote at each of these addresses would answer first.
            ...redirects,
            { handle: 'filesystem' },
            { src: '.*', status: 404, dest: sitePath(site.base, '/404.html') },
          ],
          framework: { slug: 'shabd', version: VERSION },
        },
        null,
        2,
      )}\n`,
    )
    files.push('.vercel/output/config.json', '.vercel/output/static/')

    const route = mcpAddress(config)
    if (route !== undefined) {
      const segments = route.split('/').filter(Boolean)
      const name = `${path.posix.join(...(segments.length ? segments : ['index']))}.func`
      // A folder's address is the same with and without a slash at the end; the function answers to both.
      const code = await bundleFunction('vercel', endpointSite([route, route.replace(/(.)\/$/, '$1')], site.base), config)
      await write(
        `functions/${name}/.vc-config.json`,
        `${JSON.stringify(
          { runtime: vercelRuntime(), handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false },
          null,
          2,
        )}\n`,
      )
      await write(
        `functions/${name}/index.mjs`,
        `${banner('vercel', 'The MCP endpoint of this site, as a Vercel function.')}${code}\nexport default ${FUNCTION};\n`,
      )
      files.push(`.vercel/output/functions/${name}/`)
    }

    return { files, notes }
  },
}
