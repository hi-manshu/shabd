/**
 * The layout wrapper around every page.
 *
 * There is no <DocLayout>, <SplashLayout> or <ApiLayout> component. A layout
 * is data: a table of regions, each an ordered list of block names, defined
 * in YAML (built-ins live in src/shared/layout.ts in the same shape).
 *
 *   frontmatter `layout: api`
 *        │
 *        ▼
 *   resolvePageLayout()      picks that table, then applies the page's own
 *        │                   switches: `sidebar: false`, `toc: false`, …
 *        ▼
 *   <PageLayout>             draws the regions that are left, in a fixed order
 *        │
 *        ▼
 *   <Region> → blocks        looks each block name up in the registry
 *
 * Changing what a page looks like is therefore a frontmatter or YAML edit,
 * and a new layout needs no new component.
 */
import { Component, type ComponentType, type ReactNode } from 'react'
import { REGIONS, type RegionName } from '../../shared/blocks.js'
import type { BlockRef } from '../../shared/schema.js'
import { usePage } from '../app/router.js'
import { useUi } from '../app/ui.js'
import { blockRegistry } from './registry.js'

/** The element each region renders as, so the page has proper landmarks. */
const REGION_ELEMENT: Record<RegionName, 'div' | 'header' | 'nav' | 'main' | 'aside' | 'footer'> = {
  banner: 'div',
  header: 'header',
  sidebar: 'nav',
  main: 'main',
  aside: 'aside',
  footer: 'footer',
}

const REGION_LABEL: Partial<Record<RegionName, string>> = {
  sidebar: 'Documentation',
  aside: 'On this page',
}

export function PageLayout() {
  const { layout, path } = usePage()
  const { sidebarOpen } = useUi()

  return (
    <div
      className="sb-shell"
      data-layout={layout.name}
      data-width={layout.width}
      data-has-sidebar={layout.regions.sidebar ? '' : undefined}
      data-has-aside={layout.regions.aside ? '' : undefined}
      data-sidebar-open={sidebarOpen ? '' : undefined}
    >
      <a className="sb-skip-link" href="#sb-main">
        Skip to content
      </a>
      {REGIONS.map((region) => {
        const blocks = layout.regions[region]
        // Remount the main region per page so its error boundary resets on navigation.
        return blocks ? <Region key={region === 'main' ? `main:${path}` : region} name={region} blocks={blocks} /> : null
      })}
    </div>
  )
}

function Region({ name, blocks }: { name: RegionName; blocks: BlockRef[] }) {
  const Element = REGION_ELEMENT[name]
  return (
    <Element
      className={`sb-region sb-region-${name}`}
      aria-label={REGION_LABEL[name]}
      {...(name === 'main' ? { id: 'sb-main', tabIndex: -1 } : {})}
    >
      {blocks.map((ref, index) => (
        <Block key={`${ref.block}:${index}`} blockRef={ref} />
      ))}
    </Element>
  )
}

function Block({ blockRef }: { blockRef: BlockRef }) {
  const Implementation = blockRegistry[blockRef.block] as ComponentType<Record<string, unknown>> | undefined
  // Unknown names are rejected when the config loads; this guards a stale client during a hot update.
  if (!Implementation) return null
  return (
    <BlockBoundary name={blockRef.block}>
      <Implementation {...blockRef.props} />
    </BlockBoundary>
  )
}

/** One failing block (a bad expression in MDX, a bug in a custom block) must not blank the page. */
class BlockBoundary extends Component<{ name: string; children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  override render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="sb-block-error" role="alert">
        <strong>The “{this.props.name}” block could not be rendered.</strong>
        <pre>{this.state.error.message}</pre>
      </div>
    )
  }
}
