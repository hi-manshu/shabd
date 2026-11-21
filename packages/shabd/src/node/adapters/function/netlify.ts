/**
 * The function that `shabd build --adapter netlify` writes to
 * `.netlify/v1/functions/`.
 *
 * Netlify calls the default export with a web `Request` and expects a
 * `Response`. Which addresses it is called for is said by the `config` the
 * build writes beside it:
 *
 *   https://docs.netlify.com/build/frameworks/frameworks-api/#netlifyv1functions
 *   https://docs.netlify.com/build/functions/configuration/#routing
 */
import { Endpoint, readFromSite, type EndpointSite } from './endpoint.js'

export function netlifyFunction(site: EndpointSite) {
  const endpoint = new Endpoint(site)
  return async (request: Request): Promise<Response> => {
    if (!endpoint.owns(new URL(request.url).pathname)) return endpoint.notFound()
    const { read, from } = readFromSite(request)
    return endpoint.respond(request, read, from)
  }
}
