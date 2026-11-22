/**
 * Cloudflare: Pages in advanced mode, or Workers with static assets. Both
 * are given the same folder, `dist/`, and everything is written into it:
 *
 *   _worker.js      The function. It answers the MCP route, and hands any
 *                   other request that reaches it to the static site.
 *   _routes.json    Pages: which addresses call the function. Only the MCP
 *                   route does, so every other request stays a static one,
 *                   which Pages serves without running or billing a Worker.
 *   _redirects      The site's `redirects:` as 301s. Both products read it.
 *   .assetsignore   Workers: keeps `_worker.js` and `_routes.json` from being
 *                   published as files of the site. To Pages the two are
 *                   configuration, not files.
 *
 * Workers also needs a Wrangler configuration. That file names the Worker
 * and its account, so it is the site's own to write; the docs page on
 * deploying shows the lines that matter.
 *
 * One thing is read between the lines of Cloudflare's documentation, not
 * stated in it: that a rule in `_redirects` matches an address exactly,
 * the slash at its end included. The examples there (`/trailing /trailing/
 * 301`) only make sense that way, so each form of an address gets a rule
 * of its own. None of this is tested on Cloudflare.
 *
 * What this follows, as read on 17 November 2026:
 *
 *   https://developers.cloudflare.com/pages/functions/advanced-mode/
 *     `_worker.js` in the output folder, module syntax, `env.ASSETS.fetch`
 *   https://developers.cloudflare.com/pages/functions/routing/#functions-invocation-routes
 *     `_routes.json`: `version`, `include`, `exclude`; a rule is 100 characters at most
 *   https://developers.cloudflare.com/pages/configuration/redirects/
 *   https://developers.cloudflare.com/workers/static-assets/redirects/
 *     `_redirects`: `source destination code`, 2,000 static rules of 1,000
 *     characters, followed whether or not a file is at the address
 *   https://developers.cloudflare.com/workers/static-assets/binding/
 *     the `ASSETS` binding, `run_worker_first`, `.assetsignore`
 *   https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/
 *     a Pages `_worker.js` as the `main` of a Worker
 *   https://developers.cloudflare.com/workers/static-assets/routing/advanced/serving-a-subdirectory/
 *     `assets.base_path`: `_redirects` and the binding then take addresses with the base
 */
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ShabdError } from '../config/errors.js'
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
  wireAddress,
  type Adapter,
} from './shared.js'

/** Cloudflare's limits on what is written here. */
const MAX_ROUTE_LENGTH = 100
const MAX_STATIC_REDIRECTS = 2000
const MAX_RULE_LENGTH = 1000

const read = (file: string) => readFile(file, 'utf8').catch(() => '')

/** Lines of a `_redirects` file that are rules, and of those the ones without a pattern in what they match. */
function staticRules(text: string): number {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && isLiteralSource(line.split(/\s+/)[0] ?? '')).length
}

export const cloudflare: Adapter = {
  name: 'cloudflare',

  async write({ config, outDir, moved }) {
    const { site } = config.config
    const files: string[] = []
    const notes: string[] = []
    const write = async (file: string, contents: string) => {
      await writeFile(path.join(outDir, file), contents)
      files.push(`dist/${file}`)
    }

    const route = mcpAddress(config)
    if (route !== undefined) {
      if (route.length > MAX_ROUTE_LENGTH) {
        const at = ['features', 'mcp', 'route']
        throw new ShabdError(config.configFile, [
          {
            path: at,
            ...config.locate(at),
            message:
              `Cloudflare Pages takes addresses of up to ${MAX_ROUTE_LENGTH} characters in _routes.json, ` +
              `and the MCP route is ${route.length}: ${route}. Shorten site.base or features.mcp.route.`,
          },
        ])
      }
      // The build emptied dist/ before it wrote there, so a file of either name is the site's own, copied
      // from public/. Writing over it would drop a Worker the site runs, without a word.
      const own = ['_worker.js', '_routes.json'].filter((file) => existsSync(path.join(outDir, file)))
      if (own.length) {
        throw new ShabdError(config.configFile, [
          {
            path: [],
            message:
              `The cloudflare adapter writes ${own.join(' and ')} into dist/, and the site has ` +
              `${own.map((file) => `public/${file}`).join(' and ')} of its own, which the build copied there. ` +
              `Remove ${own.length === 1 ? 'it' : 'them'} from public/, or build without the adapter and answer ` +
              'the MCP route in a Worker of your own.',
          },
        ])
      }

      // With `assets.base_path` the binding serves dist/ under the base, so that is where the function asks.
      const code = await bundleFunction('cloudflare', endpointSite([route], site.base), config)
      await write(
        '_worker.js',
        `${banner('cloudflare', 'The MCP endpoint of this site, as a Cloudflare Worker.')}${code}\nexport default ${FUNCTION};\n`,
      )
      await write('_routes.json', `${JSON.stringify({ version: 1, include: [route], exclude: [] }, null, 2)}\n`)

      // A site may keep an .assetsignore of its own in public/, which the build copied here.
      const ignored = await read(path.join(outDir, '.assetsignore'))
      const listed = new Set(ignored.split('\n').map((line) => line.trim()))
      const missing = ['_worker.js', '_routes.json'].filter((file) => !listed.has(file))
      const kept = ignored && !ignored.endsWith('\n') ? `${ignored}\n` : ignored
      await write('.assetsignore', `${kept}${missing.map((file) => `${file}\n`).join('')}`)
    }

    if (moved.length) {
      // A `_redirects` of the site's own (from public/) is kept, below these. Cloudflare takes the first rule
      // that matches, and asks for plain rules to come before rules with a pattern, which the site's may have.
      const own = await read(path.join(outDir, '_redirects'))
      const room = Math.max(0, MAX_STATIC_REDIRECTS - staticRules(own))

      const redirects = moved.map(({ from, to }) => ({ sources: addressesOf(from, site), target: wireAddress(to) }))
      const rules: string[] = []
      let unwritable = 0
      const forms = Math.max(...redirects.map(({ sources }) => sources.length))
      // Today's form of every address first: if the file fills up, what is left out is the older forms.
      for (let form = 0; form < forms; form++) {
        for (const { sources, target } of redirects) {
          const source = sources[form]
          if (source === undefined) continue
          const rule = `${source} ${target} 301`
          if (isLiteralSource(source) && isLiteralTarget(target) && rule.length <= MAX_RULE_LENGTH) rules.push(rule)
          else if (form === 0) unwritable++
        }
      }

      const written = rules.slice(0, room)
      if (written.length) {
        const header = '# The redirects of shabd.config.yaml, written by `shabd build --adapter cloudflare`.\n'
        await write('_redirects', `${header}${written.join('\n')}\n${own ? `\n${own}` : ''}`)
      }
      const left = rules.length - written.length
      if (left) {
        notes.push(
          `Cloudflare reads ${MAX_STATIC_REDIRECTS} plain rules from _redirects, and this site has ${rules.length}. ` +
            `${count(left, 'rule')} ${left === 1 ? 'is' : 'are'} left out. ${LEFT_TO_ITS_PAGE}`,
        )
      }
      if (unwritable) {
        notes.push(
          `${count(unwritable, 'redirect')} could not be written as a rule for Cloudflare (a "*" or ":name" in an ` +
            `address, or a rule over ${MAX_RULE_LENGTH} characters). ${LEFT_TO_ITS_PAGE}`,
        )
      }
    }

    if (site.base !== '/' && files.length) {
      const base = site.base.replace(/\/$/, '')
      notes.push(
        `site.base is ${site.base}. Cloudflare Workers serves dist/ from there when "base_path" under "assets" ` +
          `in the Wrangler configuration is "${base}". Cloudflare Pages documents no such setting, and serves dist/ ` +
          'from the root.',
      )
    }

    return { files, notes }
  },
}
