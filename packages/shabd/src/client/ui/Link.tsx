import type { ComponentProps } from 'react'
import { isExternal, withBase } from '../../shared/paths.js'
import { useSite } from '../app/store.js'

const WEB_LINK = /^(?:https?:)?\/\//i

/** Turn a route path into an href under the site's base path. */
export function useHref(): (path: string) => string {
  const base = useSite().site.base
  return (path) => withBase(base, path)
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
