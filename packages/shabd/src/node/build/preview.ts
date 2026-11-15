/**
 * `shabd preview`: serve dist/ the way a production host would, including
 * the MCP route, which a plain static file server cannot answer.
 */
import { createReadStream, existsSync } from 'node:fs'
import path from 'node:path'
import { preview as vitePreview, type Plugin } from 'vite'
import { stripBase } from '../../shared/paths.js'
import { ShabdError } from '../config/errors.js'
import { loadConfig } from '../config/load.js'
import { sendWebResponse, toWebRequest } from '../http.js'
import { createMcpHandler } from '../mcp/http.js'
import { staticDocs } from '../mcp/static.js'

export interface PreviewOptions {
  port?: number | undefined
  host?: string | boolean | undefined
}

export async function preview(root: string, options: PreviewOptions = {}): Promise<void> {
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
      const mcp = features.mcp.enabled ? createMcpHandler(() => staticDocs(outDir)) : null

      server.middlewares.use((req, res, next) => {
        const [pathname = '/', query = ''] = (req.url ?? '/').split('?')
        const route = stripBase(site.base, pathname)

        if (mcp && route === features.mcp.route) {
          mcp(toWebRequest(req)).then((response) => sendWebResponse(res, response), next)
          return
        }

        // Pages are written as `<route>/index.html`. Hosts serve `/guide/install`
        // and `/guide/install/` from that file (directly or after a redirect); do the same here.
        if (!path.extname(route) && existsSync(path.join(outDir, route, 'index.html'))) {
          req.url = `${pathname.replace(/\/?$/, '/')}index.html${query ? `?${query}` : ''}`
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
  server.printUrls()
}
