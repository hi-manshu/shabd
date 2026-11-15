/**
 * The two pieces of global state: site data and the route table.
 *
 * Both come from virtual modules and both are hot-swappable. This is the only
 * file that imports those modules, and it accepts their updates, so editing
 * YAML or adding a page replaces data in place instead of reloading the tab.
 */
import { useSyncExternalStore } from 'react'
import initialData from 'virtual:shabd/data'
import { routes as initialRoutes } from 'virtual:shabd/routes'
import type { SiteData } from '../../shared/types.js'
import type { PageModule } from './types.js'

export interface Store<T> {
  get(): T
  set(next: T): void
  update(change: (current: T) => T): void
  subscribe(listener: () => void): () => void
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial
  const listeners = new Set<() => void>()
  const set = (next: T) => {
    if (Object.is(next, value)) return
    value = next
    for (const listener of listeners) listener()
  }
  return {
    get: () => value,
    set,
    update: (change) => set(change(value)),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}

export type RouteTable = Record<string, () => Promise<PageModule>>

export const siteStore = createStore<SiteData>(initialData)
export const routeStore = createStore<RouteTable>(initialRoutes)

/** Site config, layouts, sidebar and the page index. Re-renders when YAML changes in dev. */
export function useSite(): SiteData {
  return useStore(siteStore)
}

if (import.meta.hot) {
  // Theme tokens travel with the site data in dev. When they change, rewrite
  // the <style> the document was served with; every rule reads from it.
  siteStore.subscribe(() => {
    const css = siteStore.get().themeCss
    const style = document.getElementById('sb-theme')
    if (css !== undefined && style && style.textContent !== css) style.textContent = css
  })

  import.meta.hot.accept('virtual:shabd/data', (next) => {
    if (next) siteStore.set(next.default as SiteData)
  })
  import.meta.hot.accept('virtual:shabd/routes', (next) => {
    if (next) routeStore.set(next.routes as RouteTable)
  })
}
