import { useMemo } from 'react'
import { sidebarFor } from '../../shared/sidebar.js'
import type { SidebarNode } from '../../shared/types.js'
import { usePage } from './router.js'
import { useSite } from './store.js'

/**
 * The sidebar of the page on screen. A site with several sidebars gives each
 * part of itself one, and the blocks that read the sidebar (the navigation,
 * the breadcrumbs, previous and next) all have to read the same one.
 */
export function useSidebar(): SidebarNode[] {
  const site = useSite()
  const { path } = usePage()
  return useMemo(() => sidebarFor(site, path), [site, path])
}
