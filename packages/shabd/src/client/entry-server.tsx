/** Entry for the static build: renders one route to HTML. Bundled by Vite's SSR build. */
import { renderToString } from 'react-dom/server'
import { App } from './app/App.js'
import { loadPage } from './app/router.js'
import { siteStore } from './app/store.js'
import { textFor } from './app/words.js'
import type { RenderedPage } from '../shared/types.js'

export async function render(path: string): Promise<RenderedPage> {
  const page = await loadPage(path)
  const meta = page.module?.meta
  return {
    html: renderToString(<App initial={page} />),
    found: page.module !== null,
    title: meta?.title ?? textFor(siteStore.get(), path)('notFound.title'),
    description: meta?.description ?? '',
  }
}
