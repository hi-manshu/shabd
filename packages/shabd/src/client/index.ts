/**
 * Public API for custom blocks and MDX components.
 *
 *     import { usePage, useSite, Badge } from 'shabd/client'
 */
export { usePage, useRouter, type PageView } from './app/router.js'
export { useSite } from './app/store.js'
export { Icon, type IconName } from './app/icons.js'
export { Badge } from './ui/Badge.js'
export { Link, useHref } from './ui/Link.js'
export { Callout } from './mdx/Callout.js'
export { Card, CardGrid } from './mdx/Card.js'
export { Tab, Tabs } from './mdx/Tabs.js'
export { useShared } from './sandbox/shared-state.js'
export type { PageModule, LoadedPage } from './app/types.js'
export type { PageMeta, SidebarNode, SiteData, TocEntry } from '../shared/types.js'
export type { Badge as BadgeData, Frontmatter } from '../shared/schema.js'
