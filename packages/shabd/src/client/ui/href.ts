import { siteHref } from '../../shared/paths.js'
import { routeStore, useSite, useStore } from '../app/store.js'

/**
 * Turn a path inside the site into an href: the site's base goes in front,
 * and a path that is a page is written the way `site.urls` writes pages.
 */
export function useHref(): (path: string) => string {
  const { site } = useSite()
  // The routes are the pages there are: every page has one, and nothing else does.
  const routes = useStore(routeStore)
  return (path) => siteHref(path, site, (route) => Object.hasOwn(routes, route))
}
