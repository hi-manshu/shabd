/**
 * Vercel, as a function with the Edge runtime: this becomes
 * `.vercel/output/functions/mcp.func/index.js`, which Vercel serves at
 * `/mcp`. It reads the site's JSON files from the deployment it is part of.
 *
 * `__SHABD_BASE__` is written in when `shabd build --adapter vercel` bundles
 * this file.
 */
import { hostedMcp } from '../hosted.js'

declare const __SHABD_BASE__: string

const mcp = hostedMcp(__SHABD_BASE__, (path, request) => fetch(new URL(path, request.url)))

export default function handler(request: Request): Promise<Response> {
  return mcp(request, undefined)
}
