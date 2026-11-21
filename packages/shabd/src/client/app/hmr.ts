/**
 * Where hot-updated pages land.
 *
 * Every compiled page accepts its own updates and calls `acceptPage` with its
 * new module (see src/node/markdown/page-module.ts). The router listens here
 * and swaps the module for the page on screen.
 *
 * The map also keeps the newest module for pages that are *not* on screen.
 * The route table's `import()` would return the browser's stale copy of an
 * already-loaded module, so the router asks this map first.
 */
import type { PageModule } from './types.js'

export const pageModules = new Map<string, PageModule>()

type Listener = (id: string, module: PageModule) => void
const listeners = new Set<Listener>()

export function acceptPage(id: string, module: PageModule): void {
  pageModules.set(id, module)
  for (const listener of listeners) listener(id, module)
}

export function onPageUpdate(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Drop the modules of pages that are gone. A page made later under the name
 * of one that was deleted is another page: kept here, the old module would
 * be shown as the new page's content.
 */
export function keepPages(ids: Set<string>): void {
  for (const id of pageModules.keys()) if (!ids.has(id)) pageModules.delete(id)
}
