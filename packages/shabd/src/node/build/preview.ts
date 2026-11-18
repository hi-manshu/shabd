/**
 * `shabd preview`: serve dist/ the way a production host would, including
 * the MCP route, which a plain static file server cannot answer.
 *
 * Unlike a function on a host, this is a process that stays, so its MCP
 * route can afford the embedding model: where the build wrote vectors,
 * `search_docs` ranks by meaning as well as by keyword (see mcp/static.ts).
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { preview as vitePreview, type Plugin, type PreviewServer } from 'vite'
import { stripBase } from '../../shared/paths.js'
import { ShabdError } from '../config/errors.js'
import { loadConfig } from '../config/load.js'
import { sendWebResponse, toWebRequest } from '../http.js'
import { createMcpHandler } from '../mcp/http.js'
import { latestStaticDocs } from '../mcp/static.js'

export interface PreviewOptions {
  port?: number | undefined
  host?: string | boolean | undefined
}

const isFile = (file: string): boolean => statSync(file, { throwIfNoEntry: false })?.isFile() ?? false

/** The file a request path names inside `dir`, or undefined if the path would leave it. */
function safeJoin(dir: string, requestPath: string): string | undefined {
  let decoded: string
  try {
    decoded = decodeURIComponent(requestPath)
  } catch {
    return undefined
  }
  const file = path.join(dir, decoded)
  return file === dir || file.startsWith(dir + path.sep) ? file : undefined
}

/** Start the server. The caller prints its address (`server.printUrls()`) and closes it when done. */
export async function preview(root: string, options: PreviewOptions = {}): Promise<PreviewServer> {
  const config = await loadConfig(root)
  const outDir = path.join(config.root, 'dist')
  if (!existsSync(path.join(outDir, 'index.html'))) {
    throw new ShabdError(config.configFile, [
      { path: [], message: `Nothing to preview: ${outDir} has no build. Run "shabd build" first.` },
    ])
  }

  const { site, features } = config.config
  const host: Plugin = {
    name: 'shabd:preview',
    configurePreviewServer(server) {
      // By meaning too only where the site's search is, and where the endpoint has not been kept to keywords.
      const semantic =
        features.search.semantic && features.mcp.semantic
          ? {
              root: config.root,
              minSimilarity: features.search.minSimilarity,
              log: (message: string) => server.config.logger.warn(`shabd: ${message}`),
            }
          : undefined
      const mcp = features.mcp.enabled ? createMcpHandler(latestStaticDocs(outDir, { semantic })) : null

      server.middlewares.use((req, res, next) => {
        const [pathname = '/', query = ''] = (req.url ?? '/').split('?')
        const route = stripBase(site.base, pathname)

        if (mcp && route === features.mcp.route) {
          mcp(toWebRequest(req)).then((response) => sendWebResponse(res, response), next)
          return
        }

        // A page is written as `<route>/index.html`, or as `<route>.html` when `site.urls` is `html`.
        // Hosts serve `/guide/install` and `/guide/install/` from either file (directly or after a
        // redirect); do the same here. An address that names a file of its own is left alone.
        const file = safeJoin(outDir, route)
        if (file && !isFile(file)) {
          const search = query ? `?${query}` : ''
          if (isFile(path.join(file, 'index.html'))) req.url = `${pathname.replace(/\/?$/, '/')}index.html${search}`
          else if (isFile(`${file.replace(/[\\/]+$/, '')}.html`)) req.url = `${pathname.replace(/\/+$/, '')}.html${search}`
        }
        next()
      })

      // After the static files: whatever is left does not exist.
      return () => {
        server.middlewares.use((_req, res) => {
          res.statusCode = 404
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          createReadStream(path.join(outDir, '404.html')).pipe(res)
        })
      }
    },
  }

  const server = await vitePreview({
    configFile: false,
    root: config.root,
    base: site.base,
    // "mpa": unknown URLs get 404.html rather than the home page.
    appType: 'mpa',
    build: { outDir },
    preview: {
      ...(options.port !== undefined ? { port: options.port } : {}),
      ...(options.host !== undefined ? { host: options.host } : {}),
    },
    plugins: [host],
  })
  return server
}
