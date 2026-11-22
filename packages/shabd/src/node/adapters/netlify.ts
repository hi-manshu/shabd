/**
 * Netlify, through its Frameworks API. Netlify publishes `dist/` as it is;
 * what is written here goes beside it, in `.netlify/v1/` in the site folder:
 *
 *   functions/shabd-mcp.mjs   The function, and in its `config` the address
 *                             it is called for: the MCP route, nothing else.
 *   config.json               The site's `redirects:` as 301s.
 *
 * The function is a serverless function, not an edge function. Netlify
 * gives an edge function 50 ms of CPU time per request, and the first
 * search builds the keyword index: 57 ms for 2,000 sections of 120 words,
 * measured in Node 22 on an Apple M2 Pro. A serverless function has 60
 * seconds.
 *
 * The redirects go into `config.json`, not into `dist/_redirects`: a site's
 * own `_redirects` stays its own, and Netlify reads it first. Each rule is
 * forced. A file stands at every one of these addresses, the page the build
 * wrote, and Netlify lets a file win over a rule that is not forced.
 *
 * With `site.base` set, one more rule serves `dist/` from under the base,
 * and the function is called for the route with and without the base in
 * front: Netlify does not say which of the two, rule or function, sees a
 * request first.
 *
 * Netlify's documentation does not say which folder it looks for
 * `.netlify/v1/` in either. It is written in the site folder, which
 * therefore has to be the folder Netlify builds in. None of this is tested
 * on Netlify.
 *
 * What this follows, as read on 17 November 2026:
 *
 *   https://docs.netlify.com/build/frameworks/frameworks-api/
 *     `.netlify/v1/functions`, `.netlify/v1/config.json` and its
 *     `redirects`; a function's `config` is written out in its own file,
 *     in plain values
 *   https://docs.netlify.com/build/functions/configuration/
 *     `path` routes a function, `.mjs` is an ES module, 60 seconds, 1024 MB
 *   https://docs.netlify.com/build/edge-functions/limits/
 *     50 ms of CPU time per request
 *   https://docs.netlify.com/manage/routing/redirects/overview/
 *     `from`, `to`, `status`, `force`; special characters are URL-encoded
 *   https://docs.netlify.com/manage/routing/redirects/redirect-options/
 *     a rule matches with and without a slash at the end; `/news/*` and `:splat`
 *   https://docs.netlify.com/manage/routing/redirects/rewrites-proxies/
 *     status 200 is a rewrite; a file wins over a rule unless it is forced
 */
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { VERSION } from '../../shared/version.js'
import {
  addressesOf,
  banner,
  bundleFunction,
  count,
  endpointSite,
  FUNCTION,
  isLiteralSource,
  isLiteralTarget,
  LEFT_TO_ITS_PAGE,
  mcpAddress,
  sitePath,
  wireAddress,
  type Adapter,
} from './shared.js'

/** Netlify asks a framework to put its own name in the names of its functions. */
const FUNCTION_FILE = 'functions/shabd-mcp.mjs'
const CONFIG_FILE = 'config.json'

interface Rule {
  from: string
  to: string
  status: number
  force: true
}

export const netlify: Adapter = {
  name: 'netlify',

  async write({ config, moved }) {
    const { site, features } = config.config
    const output = path.join(config.root, '.netlify', 'v1')
    const files: string[] = []
    const notes: string[] = []
    const write = async (file: string, contents: string) => {
      await mkdir(path.dirname(path.join(output, file)), { recursive: true })
      await writeFile(path.join(output, file), contents)
      files.push(`.netlify/v1/${file}`)
    }

    // What an earlier build wrote must not outlive the setting that made it.
    for (const file of [FUNCTION_FILE, CONFIG_FILE]) await rm(path.join(output, file), { force: true })

    const route = mcpAddress(config)
    if (route !== undefined) {
      const routes = [...new Set([route, features.mcp.route])]
      // Netlify publishes dist/ at the root whatever the base, so that is where the two files always are.
      const code = await bundleFunction('netlify', endpointSite(routes, '/'), config)
      // Netlify reads `config` from the text of this file without running it. So it is written out here,
      // in plain values, the way Netlify's own examples write it.
      const settings = [
        `  path: ${JSON.stringify(routes.length === 1 ? routes[0] : routes)},`,
        '  name: "Shabd MCP endpoint",',
        `  generator: ${JSON.stringify(`shabd@${VERSION}`)},`,
      ]
      await write(
        FUNCTION_FILE,
        `${banner('netlify', 'The MCP endpoint of this site, as a Netlify function.')}${code}\n` +
          `export default ${FUNCTION};\nexport const config = {\n${settings.join('\n')}\n};\n`,
      )
    }

    const rules: Rule[] = []
    let unwritable = 0
    for (const { from, to } of moved) {
      const target = wireAddress(to)
      // Netlify matches a rule with and without a slash at the end, so those two forms are one rule.
      const sources = [...new Set(addressesOf(from, site).map((address) => address.replace(/(.)\/$/, '$1')))]
      if (isLiteralTarget(target) && sources.every(isLiteralSource)) {
        for (const source of sources) rules.push({ from: source, to: target, status: 301, force: true })
      } else {
        unwritable++
      }
    }
    if (unwritable) {
      notes.push(
        `${count(unwritable, 'redirect')} could not be written as a rule for Netlify (a "*" or ":name" in an ` +
          `address). ${LEFT_TO_ITS_PAGE}`,
      )
    }
    // After the redirects: Netlify takes the first rule that matches.
    if (site.base !== '/') rules.push({ from: sitePath(site.base, '/*'), to: '/:splat', status: 200, force: true })

    if (rules.length) await write(CONFIG_FILE, `${JSON.stringify({ redirects: rules }, null, 2)}\n`)

    return { files, notes }
  },
}
