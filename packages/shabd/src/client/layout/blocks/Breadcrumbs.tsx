import { useMemo } from 'react'
import { findTrail } from '../../../shared/sidebar.js'
import { useText } from '../../app/edition.js'
import { usePage } from '../../app/router.js'
import { useSidebar } from '../../app/sidebar.js'

/** Where the page sits in the sidebar: the groups above it, then the page itself. */
export function Breadcrumbs() {
  const sidebar = useSidebar()
  const { path, title } = usePage()
  const text = useText()
  const trail = useMemo(() => findTrail(sidebar, path), [sidebar, path])
  if (!trail || trail.length === 0) return null
  return (
    <nav className="sb-breadcrumbs" aria-label={text('breadcrumb')}>
      <ol>
        {trail.map((group, index) => (
          <li key={`${group.label}:${index}`}>{group.label}</li>
        ))}
        <li aria-current="page">{title}</li>
      </ol>
    </nav>
  )
}
