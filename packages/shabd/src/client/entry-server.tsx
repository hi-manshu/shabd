/** Entry for the static build: renders one route to HTML. Bundled by Vite's SSR build. */
import { renderToString } from 'react-dom/server'
import { App } from './app/App.js'
import { loadPage } from './app/router.js'
import { siteStore } from './app/store.js'
import type { RenderedPage } from '../shared/types.js'

export async function render(path: string): Promise<RenderedPage> {
  const page = await loadPage(path)
  const meta = siteStore.get().pages[path]
  return {
    html: renderToString(<App initial={page} />),
    found: page.module !== null,
    title: meta?.title ?? 'Page not found',
    description: meta?.description ?? '',
  }
}
