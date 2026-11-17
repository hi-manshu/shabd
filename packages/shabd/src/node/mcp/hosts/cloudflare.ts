/**
 * Cloudflare Pages, in "advanced mode": this becomes `_worker.js` in the
 * output directory. A Worker there sees every request, so everything that is
 * not the MCP route goes on to the static files.
 *
 * `__SHABD_BASE__` is written in when `shabd build --adapter cloudflare`
 * bundles this file.
 */
import { hostedMcp } from '../hosted.js'

declare const __SHABD_BASE__: string

interface Env {
  ASSETS: { fetch(input: Request | URL | string): Promise<Response> }
}

const route = `${__SHABD_BASE__}mcp`
const mcp = hostedMcp<Env>(__SHABD_BASE__, (path, request, env) => env.ASSETS.fetch(new URL(path, request.url)))

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return new URL(request.url).pathname === route ? mcp(request, env) : env.ASSETS.fetch(request)
  },
}
