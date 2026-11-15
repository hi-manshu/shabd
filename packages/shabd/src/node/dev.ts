import { createServer, type ViteDevServer } from 'vite'
import { shabd } from './vite/plugin.js'

export interface DevOptions {
  port?: number | undefined
  host?: string | boolean | undefined
  open?: boolean | undefined
}

/** Start the dev server for the site at `root`. */
export async function dev(root: string, options: DevOptions = {}): Promise<ViteDevServer> {
  const server = await createServer({
    // The site is configured in YAML; a stray vite.config in the folder is not ours to load.
    configFile: false,
    root,
    plugins: [shabd({ root })],
    server: {
      ...(options.port !== undefined ? { port: options.port } : {}),
      ...(options.host !== undefined ? { host: options.host } : {}),
      ...(options.open !== undefined ? { open: options.open } : {}),
    },
  })
  await server.listen()
  return server
}
