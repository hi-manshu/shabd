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
import { Component, useEffect, useLayoutEffect, useRef, useState, type ComponentType, type ReactNode, type RefObject } from 'react'
import { REGIONS, type RegionName } from '../../shared/blocks.js'
import type { BlockRef } from '../../shared/schema.js'
import type { UiKey } from '../../shared/ui-text.js'
import { usePlace, useText } from '../app/edition.js'
import { usePage } from '../app/router.js'
import { useSite } from '../app/store.js'
import { setUi, useUi } from '../app/ui.js'
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

/** What a region is called, for the regions that are called something: by the key of its words. */
const REGION_LABEL: Partial<Record<RegionName, UiKey>> = {
  sidebar: 'region.sidebar',
  aside: 'toc',
}

/**
 * On a narrow screen the sidebar is a panel that starts where the header
 * ends. The header is not always at the top of the window: a banner above it
 * holds it down until the page is scrolled. So while the panel is open it is
 * told where the header ends, in `--sb-panel-top`. The value is left in place
 * when the panel closes, so that it does not jump as it fades.
 */
function usePanelTop(shell: RefObject<HTMLDivElement | null>, open: boolean) {
  useLayoutEffect(() => {
    const element = shell.current
    const header = element?.querySelector('.sb-region-header')
    if (!open || !element || !header) return undefined
    const place = () => element.style.setProperty('--sb-panel-top', `${Math.max(0, header.getBoundingClientRect().bottom)}px`)
    place()
    window.addEventListener('scroll', place, { passive: true })
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place)
      window.removeEventListener('resize', place)
    }
  }, [shell, open])
}

/** The width under which the sidebar is a panel over the page. The stylesheet (layout.css) has the same number. */
const NARROW = '(max-width: 59.99rem)'

/** Is the window that narrow? Not known on the server, nor in the first render in the browser, which has to match it. */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const query = window.matchMedia(NARROW)
    const update = () => setNarrow(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return narrow
}

/**
 * The sidebar as a panel over the page, on a narrow screen.
 *
 * While it is open the page under it cannot be seen, so it cannot be reached
 * either: the regions it covers are made inert, and the keyboard's focus
 * stays in the header and the panel. Escape closes the panel from inside it
 * and puts the focus back on the button that opened it. On a wide screen the
 * sidebar is a column and nothing is open: a panel left open is closed when
 * the window grows.
 *
 * Returns whether the panel is covering the page now.
 */
function usePanel(shell: RefObject<HTMLDivElement | null>, open: boolean): boolean {
  const narrow = useNarrow()
  const covering = open && narrow

  useEffect(() => {
    if (open && !window.matchMedia(NARROW).matches) setUi({ sidebarOpen: false })
  }, [open, narrow])

  useEffect(() => {
    if (!covering) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      // Something nearer the key has taken it already: the search dialog, the palette menu.
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const toggle = shell.current?.querySelector<HTMLElement>('.sb-menu-toggle')
      const panel = shell.current?.querySelector('.sb-region-sidebar')
      const focused = document.activeElement
      if (focused !== toggle && !panel?.contains(focused)) return
      setUi({ sidebarOpen: false })
      toggle?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [shell, covering])

  return covering
}

/** The regions the panel does not cover: the banner and the header above it, and itself. */
const ABOVE_THE_PANEL: readonly RegionName[] = ['banner', 'header', 'sidebar']

export function PageLayout() {
  const { layout, path } = usePage()
  const { sidebarOpen } = useUi()
  const { site } = useSite()
  const { language } = usePlace()
  // A reader who picks another language is taken there without a new document, so the one there is
  // says of itself what a new one would: the language it is in, and the direction that is written in.
  const lang = language?.lang ?? site.lang
  const dir = language?.dir
  const text = useText()
  useEffect(() => {
    document.documentElement.lang = lang
    if (dir === 'rtl') document.documentElement.dir = 'rtl'
    else document.documentElement.removeAttribute('dir')
  }, [lang, dir])
  const shell = useRef<HTMLDivElement>(null)
  usePanelTop(shell, sidebarOpen)
  const covering = usePanel(shell, sidebarOpen)

  return (
    <div
      ref={shell}
      className="sb-shell"
      data-layout={layout.name}
      data-width={layout.width}
      data-has-sidebar={layout.regions.sidebar ? '' : undefined}
      data-has-aside={layout.regions.aside ? '' : undefined}
      data-sidebar-open={sidebarOpen ? '' : undefined}
    >
      <a className="sb-skip-link" href="#sb-main">
        {text('skip')}
      </a>
      {REGIONS.map((region) => {
        const blocks = layout.regions[region]
        // Remount the main region per page so its error boundary resets on navigation.
        return blocks ? (
          <Region
            key={region === 'main' ? `main:${path}` : region}
            name={region}
            blocks={blocks}
            covered={covering && !ABOVE_THE_PANEL.includes(region)}
          />
        ) : null
      })}
    </div>
  )
}

/** The id of the sidebar, which the button that opens it on a narrow screen names as what it controls (blocks/Header.tsx). */
const SIDEBAR_ID = 'sb-sidebar'

function Region({ name, blocks, covered }: { name: RegionName; blocks: BlockRef[]; covered: boolean }) {
  const Element = REGION_ELEMENT[name]
  const text = useText()
  return (
    <Element
      className={`sb-region sb-region-${name}`}
      aria-label={REGION_LABEL[name] && text(REGION_LABEL[name])}
      // Under the open panel: not to be reached by a key or read out, since it cannot be seen.
      inert={covered ? true : undefined}
      {...(name === 'main' ? { id: 'sb-main', tabIndex: -1 } : {})}
      {...(name === 'sidebar' ? { id: SIDEBAR_ID } : {})}
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
