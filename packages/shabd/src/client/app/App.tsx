import { lazy, Suspense } from 'react'
import { PageLayout } from '../layout/PageLayout.js'
import { RouterProvider } from './RouterProvider.js'
import { useSite } from './store.js'
import type { LoadedPage } from './types.js'
import { useUi } from './ui.js'

// Overlays are code-split: a reader who never opens search or the studio never downloads them.
const SearchDialog = lazy(() => import('../search/SearchDialog.js'))
const Studio = import.meta.env.DEV ? lazy(() => import('../studio/Studio.js')) : null

function Overlays() {
  const { features } = useSite()
  const ui = useUi()
  return (
    <Suspense fallback={null}>
      {features.search.enabled && ui.searchOpen && <SearchDialog />}
      {Studio && features.studio.enabled && ui.studioOpen && <Studio />}
    </Suspense>
  )
}

export function App({ initial }: { initial: LoadedPage }) {
  return (
    <RouterProvider initial={initial}>
      <PageLayout />
      <Overlays />
    </RouterProvider>
  )
}
