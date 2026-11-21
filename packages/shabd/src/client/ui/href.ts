import { siteHref } from '../../shared/paths.js'
import { useSite } from '../app/store.js'

/**
 * Turn a path inside the site into an href: the site's base goes in front,
 * and a path that is a page is written the way `site.urls` writes pages.
 */
export function useHref(): (path: string) => string {
  const { site, pages } = useSite()
  return (path) => siteHref(path, site, (route) => Object.hasOwn(pages, route))
}
