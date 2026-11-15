/** Locations inside the shabd package, resolved the same way from `src/` (tests) and `dist/` (published). */
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** This file lives at `<pkg>/{src,dist}/node/paths.{ts,js}`. */
export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** The browser runtime ships as source and is compiled by the site's Vite build. */
export const CLIENT_DIR = path.join(PACKAGE_ROOT, 'src', 'client')
export const CLIENT_ENTRY = path.join(CLIENT_DIR, 'entry-client.tsx')
export const SERVER_ENTRY = path.join(CLIENT_DIR, 'entry-server.tsx')

const require = createRequire(import.meta.url)

/** Resolve a module the way shabd itself would, independent of the site's node_modules layout. */
export function resolveFromPackage(specifier: string): string | undefined {
  try {
    return require.resolve(specifier)
  } catch {
    return undefined
  }
}

export function packageVersion(): string {
  try {
    return (require(path.join(PACKAGE_ROOT, 'package.json')) as { version: string }).version
  } catch {
    return '0.0.0'
  }
}
