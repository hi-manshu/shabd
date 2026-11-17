import type { ComponentProps } from 'react'
import { isExternal, siteHref } from '../../shared/paths.js'
import { useSite } from '../app/store.js'

const WEB_LINK = /^(?:https?:)?\/\//i

/**
 * Turn a path inside the site into an href: the site's base goes in front,
 * and a path that is a page is written the way `site.urls` writes pages.
 */
export function useHref(): (path: string) => string {
  const { site, pages } = useSite()
  return (path) => siteHref(path, site, (route) => Object.hasOwn(pages, route))
}

/**
 * The link every Markdown `[text](href)` renders as. Internal paths get the
 * site base and are handled by the client router; links to other sites open
 * in a new tab.
 */
export function Link({ href = '', children, ...rest }: ComponentProps<'a'>) {
  const toHref = useHref()
  if (WEB_LINK.test(href)) {
    return (
      <a href={href} target="_blank" rel="noreferrer" {...rest}>
        {children}
      </a>
    )
  }
  return (
    <a href={isExternal(href) ? href : toHref(href)} {...rest}>
      {children}
    </a>
  )
}
