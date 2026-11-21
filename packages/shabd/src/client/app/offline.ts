/**
 * The service worker that keeps a built site in the reader's browser
 * (`features.offline`). `shabd build` writes it; this registers it, or takes
 * it away again.
 *
 * Taking it away matters as much as registering it. A worker stays in a
 * browser until it is told to go, and a site that turned the feature off
 * would otherwise leave every earlier reader with a worker that answers from
 * a copy nobody updates. Pages are asked of the network first, so such a
 * reader still gets the new build's script, and that script removes the
 * worker and its copies.
 */
import type { SiteData } from '../../shared/types.js'

/** The name `shabd build` gives the worker's file (src/node/build/offline.ts). */
const SCRIPT = 'shabd-sw.js'

export function setUpOffline({ site, features }: SiteData, dev: boolean = import.meta.env.DEV): void {
  // `shabd dev` has no worker: its pages change as they are edited, and a copy of them would be in the way.
  if (dev || !('serviceWorker' in navigator)) return
  const { base } = site

  if (features.offline.enabled) {
    const register = () => void navigator.serviceWorker.register(`${base}${SCRIPT}`, { scope: base }).catch(() => {})
    // After the page has loaded: the worker fetches the whole site, and the page comes first.
    if (document.readyState === 'complete') register()
    else window.addEventListener('load', register, { once: true })
    return
  }

  void (async () => {
    const registration = await navigator.serviceWorker.getRegistration(base)
    const worker = registration?.active ?? registration?.waiting ?? registration?.installing
    // Only Shabd's own, for this site: a site may have a worker of another kind.
    if (!registration || !worker?.scriptURL.endsWith(`${base}${SCRIPT}`)) return
    await registration.unregister()
    for (const name of await caches.keys()) if (name.startsWith(`shabd:${base}:`)) await caches.delete(name)
  })().catch(() => {})
}
