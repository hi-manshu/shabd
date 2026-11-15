/** Read-only helpers over a resolved sidebar tree. Used by navigation blocks and llms.txt. */
import type { SidebarGroup, SidebarNode, SidebarPage } from './types.js'

/** Pages in reading order, for previous/next links. */
export function flattenSidebar(nodes: SidebarNode[]): SidebarPage[] {
  return nodes.flatMap((node) =>
    node.type === 'group' ? flattenSidebar(node.items) : node.type === 'page' ? [node] : [],
  )
}

/** The groups that contain a page, outermost first. Null when the page is not in the sidebar. */
export function findTrail(nodes: SidebarNode[], path: string): SidebarGroup[] | null {
  for (const node of nodes) {
    if (node.type === 'page' && node.path === path) return []
    if (node.type === 'group') {
      const trail = findTrail(node.items, path)
      if (trail) return [node, ...trail]
    }
  }
  return null
}
