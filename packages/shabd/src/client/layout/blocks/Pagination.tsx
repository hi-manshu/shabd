import { useMemo } from 'react'
import { flattenSidebar } from '../../../shared/sidebar.js'
import { usePage } from '../../app/router.js'
import { useSidebar } from '../../app/sidebar.js'
import { useHref } from '../../ui/href.js'

/** Previous and next page, in the order of the sidebar the page is shown with. */
export function Pagination() {
  const sidebar = useSidebar()
  const { path } = usePage()
  const href = useHref()
  const pages = useMemo(() => flattenSidebar(sidebar), [sidebar])
  const index = pages.findIndex((page) => page.path === path)
  if (index === -1) return null
  const previous = pages[index - 1]
  const next = pages[index + 1]
  if (!previous && !next) return null
  return (
    <nav className="sb-pagination" aria-label="Previous and next page">
      {previous ? (
        <a className="sb-pagination-link" rel="prev" href={href(previous.path)}>
          <span className="sb-pagination-label">Previous</span>
          <span className="sb-pagination-title">{previous.label}</span>
        </a>
      ) : (
        <span />
      )}
      {next && (
        <a className="sb-pagination-link" data-next="" rel="next" href={href(next.path)}>
          <span className="sb-pagination-label">Next</span>
          <span className="sb-pagination-title">{next.label}</span>
        </a>
      )}
    </nav>
  )
}
