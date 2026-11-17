/**
 * Netlify, as an edge function: this becomes
 * `.netlify/v1/edge-functions/shabd-mcp.js`. The path it answers is declared
 * in a `config` export that the build adds after bundling, because Netlify
 * reads it from the file's text and takes literal values only.
 *
 * `__SHABD_BASE__` is written in when `shabd build --adapter netlify` bundles
 * this file.
 */
import { hostedMcp } from '../hosted.js'

declare const __SHABD_BASE__: string

const mcp = hostedMcp(__SHABD_BASE__, (path, request) => fetch(new URL(path, request.url)))

export default function handler(request: Request): Promise<Response> {
  return mcp(request, undefined)
}
