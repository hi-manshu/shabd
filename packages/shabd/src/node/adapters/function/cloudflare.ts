/**
 * The Worker that `shabd build --adapter cloudflare` writes as `_worker.js`.
 *
 * Cloudflare calls `fetch(request, env)`, and `env.ASSETS` is the site's
 * static files, on Pages (advanced mode) and on Workers with static assets
 * alike:
 *
 *   https://developers.cloudflare.com/pages/functions/advanced-mode/
 *   https://developers.cloudflare.com/workers/static-assets/binding/
 */
import { Endpoint, type EndpointSite } from './endpoint.js'

/** The part of Cloudflare's assets binding this Worker uses. */
interface Assets {
  fetch(input: Request | URL | string): Promise<Response>
}

export interface CloudflareEnv {
  ASSETS?: Assets
}

/** Pages always has the binding. A Worker has it when its configuration asks for one. */
const NO_ASSETS =
  'This Worker has no ASSETS binding. Add "binding": "ASSETS" under "assets" in the Wrangler configuration.'

export function cloudflareWorker(site: EndpointSite) {
  const endpoint = new Endpoint(site)
  return {
    async fetch(request: Request, env: CloudflareEnv): Promise<Response> {
      const url = new URL(request.url)
      const assets = env.ASSETS

      if (!endpoint.owns(url.pathname)) {
        // `_routes.json` (Pages) and `run_worker_first` (Workers) keep other requests away from the Worker.
        // One that arrives all the same is for the static site: hand it on, 404 page included.
        if (!assets) return new Response(NO_ASSETS, { status: 500 })
        return assets.fetch(request)
      }

      return endpoint.respond(request, async (path) => {
        if (!assets) throw new Error(NO_ASSETS)
        // The binding looks at the path of this address and at nothing else. The host name is not used.
        return assets.fetch(new URL(path, url))
      })
    },
  }
}
