import { useEffect, useMemo, useRef, useState } from 'react'
import type { SidebarGroup, SidebarNode } from '../../../shared/types.js'
import { Icon } from '../../app/icons.js'
import { usePage } from '../../app/router.js'
import { useSidebar } from '../../app/sidebar.js'
import { Badge } from '../../ui/Badge.js'
import { useHref } from '../../ui/Link.js'

function contains(group: SidebarGroup, path: string): boolean {
  return group.items.some((item) =>
    item.type === 'group' ? contains(item, path) : item.type === 'page' && item.path === path,
  )
}

const keyOf = (node: SidebarNode, index: number) =>
  node.type === 'page' ? node.path : node.type === 'link' ? node.href : `${node.label}:${index}`

/** The sidebar tree resolved from sidebar.yaml and the content folder. */
export function SidebarNav() {
  const sidebar = useSidebar()
  const { path } = usePage()
  const root = useRef<HTMLDivElement>(null)

  // Keep the current page's entry in view inside a long sidebar.
  useEffect(() => {
    root.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' })
  }, [path])

  return (
    <div className="sb-sidebar-nav" ref={root}>
      <NodeList nodes={sidebar} path={path} />
    </div>
  )
}

function NodeList({ nodes, path }: { nodes: SidebarNode[]; path: string }) {
  return (
    <ul className="sb-nav-list">
      {nodes.map((node, index) => (
        <li key={keyOf(node, index)}>
          <Node node={node} path={path} />
        </li>
      ))}
    </ul>
  )
}

function Node({ node, path }: { node: SidebarNode; path: string }) {
  const href = useHref()

  if (node.type === 'page') {
    return (
      <a className="sb-nav-link" href={href(node.path)} aria-current={node.path === path ? 'page' : undefined}>
        <span>{node.label}</span>
        {node.badge && <Badge {...node.badge} />}
      </a>
    )
  }

  if (node.type === 'link') {
    return (
      <a
        className="sb-nav-link"
        href={node.external ? node.href : href(node.href)}
        {...(node.external ? { target: '_blank', rel: 'noreferrer' } : {})}
      >
        <span>{node.label}</span>
        {node.external && <Icon name="external" size={13} />}
        {node.badge && <Badge {...node.badge} />}
      </a>
    )
  }

  if (node.kind === 'category') {
    return (
      <div className="sb-nav-category">
        <p className="sb-nav-heading">
          <span>{node.label}</span>
          {node.badge && <Badge {...node.badge} />}
        </p>
        <NodeList nodes={node.items} path={path} />
      </div>
    )
  }

  return <Folder node={node} path={path} />
}

function Folder({ node, path }: { node: SidebarGroup; path: string }) {
  const holdsCurrent = useMemo(() => contains(node, path), [node, path])
  const [open, setOpen] = useState(!node.collapsed || holdsCurrent)

  // Navigating into a collapsed folder opens it; the reader's own toggles are otherwise kept.
  useEffect(() => {
    if (holdsCurrent) setOpen(true)
  }, [holdsCurrent])

  return (
    <details className="sb-nav-folder" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <Icon name="chevron" size={14} />
        <span>{node.label}</span>
        {node.badge && <Badge {...node.badge} />}
      </summary>
      <NodeList nodes={node.items} path={path} />
    </details>
  )
}
