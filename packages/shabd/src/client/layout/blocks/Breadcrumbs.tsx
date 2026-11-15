import { useMemo } from 'react'
import { findTrail } from '../../../shared/sidebar.js'
import { usePage } from '../../app/router.js'
import { useSite } from '../../app/store.js'

/** Where the page sits in the sidebar: the groups above it, then the page itself. */
export function Breadcrumbs() {
  const { sidebar } = useSite()
  const { path, title } = usePage()
  const trail = useMemo(() => findTrail(sidebar, path), [sidebar, path])
  if (!trail || trail.length === 0) return null
  return (
    <nav className="sb-breadcrumbs" aria-label="Breadcrumb">
      <ol>
        {trail.map((group, index) => (
          <li key={`${group.label}:${index}`}>{group.label}</li>
        ))}
        <li aria-current="page">{title}</li>
      </ol>
    </nav>
  )
}
