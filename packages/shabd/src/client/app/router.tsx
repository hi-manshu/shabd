/**
 * A small client router for a site whose routes are known up front.
 *
 * Navigation waits for the next page's module before committing, so the
 * current page stays on screen until the new one can render in full. There is
 * no loading state to design around and no layout shift between pages.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react'
import { resolvePageLayout, type ActiveLayout } from '../../shared/layout.js'
import { normalizePath, stripBase } from '../../shared/paths.js'
import type { Frontmatter } from '../../shared/schema.js'
import type { SiteData, TocEntry } from '../../shared/types.js'
import { onPageUpdate, pageModules } from './hmr.js'
import { NotFound } from './NotFound.js'
import { routeStore, siteStore, useSite } from './store.js'
import type { LoadedPage } from './types.js'
import { setUi } from './ui.js'

/* ───────────────────────────── loading ───────────────────────────── */

export async function loadPage(path: string): Promise<LoadedPage> {
  const meta = siteStore.get().pages[path]
  const load = routeStore.get()[path]
  if (!meta || !load) return { path, module: null }
  // Prefer a hot-updated module over the browser's cached copy of the import.
  let module = pageModules.get(meta.id)
  if (!module) {
    module = await load()
    pageModules.set(meta.id, module)
  }
  return { path, module }
}

/** Fetch a page's code ahead of the click. Failures are ignored; the click will retry. */
export function preloadPage(path: string): void {
  void loadPage(path).catch(() => {})
}

/** The route for a URL, or null if the URL is not a page of this site. */
export function routeFor(url: URL): string | null {
  if (url.origin !== location.origin) return null
  const base = siteStore.get().site.base
  const prefix = base.replace(/\/$/, '')
  if (prefix && url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) return null
  const path = normalizePath(stripBase(base, url.pathname))
  return routeStore.get()[path] ? path : null
}

export function currentRoute(): string {
  return normalizePath(stripBase(siteStore.get().site.base, location.pathname))
}

/* ─────────────────────────── page view model ─────────────────────── */

/** Everything a block needs to know about the page on screen. */
export interface PageView {
  path: string
  /** Content-relative file path. Null on the not-found page. */
  id: string | null
  title: string
  description: string
  frontmatter: Frontmatter
  toc: TocEntry[]
  /** The colours of the page's code tokens, as a stylesheet. */
  codeCss: string
  /** The layout chosen by frontmatter, with this page's region switches applied. */
  layout: ActiveLayout
  Content: ComponentType<Record<string, unknown>>
  notFound: boolean
}

const NO_FRONTMATTER = { sidebar: {}, badges: [], draft: false, toc: undefined } as Frontmatter

export function toPageView(site: SiteData, page: LoadedPage): PageView {
  const meta = site.pages[page.path]
  if (!page.module || !meta) {
    const frontmatter = { ...NO_FRONTMATTER, pagination: false, editLink: false, toc: false } as Frontmatter
    return {
      path: page.path,
      id: null,
      title: 'Page not found',
      description: '',
      frontmatter,
      toc: [],
      codeCss: '',
      layout: resolvePageLayout(site, frontmatter, []),
      Content: NotFound,
      notFound: true,
    }
  }
  const { frontmatter, toc } = page.module
  return {
    codeCss: page.module.codeCss ?? '',
    path: page.path,
    id: meta.id,
    title: meta.title,
    description: meta.description,
    frontmatter,
    toc,
    layout: resolvePageLayout(site, frontmatter, toc),
    Content: page.module.default,
    notFound: false,
  }
}

/* ───────────────────────────── contexts ──────────────────────────── */

interface RouterValue {
  path: string
  navigate(to: string, options?: { replace?: boolean }): Promise<void>
}

const RouterContext = createContext<RouterValue | null>(null)
const PageContext = createContext<PageView | null>(null)

export function useRouter(): RouterValue {
  const value = useContext(RouterContext)
  if (!value) throw new Error('useRouter must be used inside the Shabd app')
  return value
}

/** The page on screen: frontmatter, table of contents, resolved layout. */
export function usePage(): PageView {
  const value = useContext(PageContext)
  if (!value) throw new Error('usePage must be used inside the Shabd app')
  return value
}

/* ───────────────────────────── provider ──────────────────────────── */

interface ScrollTarget {
  hash: string
  /** Pixel offset to restore, or null to go to the hash (or the top). */
  top: number | null
  focus: boolean
}

const scrollPositions = new Map<string, number>()
let keySeed = 0
const newKey = () => `${Date.now().toString(36)}${keySeed++}`
const historyKey = (): string => (history.state as { key?: string } | null)?.key ?? ''

function applyScroll(target: ScrollTarget): void {
  if (target.top !== null) {
    window.scrollTo(0, target.top)
  } else {
    const id = target.hash ? decodeURIComponent(target.hash.slice(1)) : ''
    const element = id ? document.getElementById(id) : null
    if (element) element.scrollIntoView()
    else window.scrollTo(0, 0)
  }
  // Move focus to the content so keyboard and screen-reader users start at the new page.
  if (target.focus) document.getElementById('sb-main')?.focus({ preventScroll: true })
}

export function RouterProvider({ initial, children }: { initial: LoadedPage; children: ReactNode }) {
  const site = useSite()
  const [page, setPage] = useState(initial)
  const [navigation, setNavigation] = useState(0)
  const pathRef = useRef(initial.path)
  const keyRef = useRef('')
  const scrollTarget = useRef<ScrollTarget | null>(null)

  const show = useCallback((next: LoadedPage, target: ScrollTarget) => {
    pathRef.current = next.path
    scrollTarget.current = target
    setPage(next)
    setNavigation((n) => n + 1)
  }, [])

  const navigate = useCallback<RouterValue['navigate']>(
    async (to, options = {}) => {
      const url = new URL(to, location.href)
      const path = routeFor(url)
      if (path === null) {
        location.assign(url.href)
        return
      }
      const next = await loadPage(path)
      scrollPositions.set(keyRef.current, window.scrollY)
      keyRef.current = newKey()
      history[options.replace ? 'replaceState' : 'pushState']({ key: keyRef.current }, '', url.href)
      setUi({ sidebarOpen: false })
      show(next, { hash: url.hash, top: null, focus: path !== pathRef.current })
    },
    [show],
  )

  useEffect(() => {
    // Marks the moment the page is interactive: after hydration, or after the first client render.
    // Tests wait for it, and a site's own scripts and CSS can too.
    document.documentElement.dataset.shabd = 'ready'
    history.scrollRestoration = 'manual'
    if (!historyKey()) history.replaceState({ key: newKey() }, '')
    keyRef.current = historyKey()
    // On first load the browser looked for the hash before the page rendered.
    if (location.hash) applyScroll({ hash: location.hash, top: null, focus: false })

    const onPopState = async () => {
      scrollPositions.set(keyRef.current, window.scrollY)
      keyRef.current = historyKey()
      const next = await loadPage(currentRoute())
      show(next, { hash: location.hash, top: scrollPositions.get(keyRef.current) ?? null, focus: false })
    }

    const anchorRoute = (event: MouseEvent): { anchor: HTMLAnchorElement; path: string } | null => {
      const anchor = (event.target as Element | null)?.closest?.('a')
      if (!anchor || (anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return null
      const href = anchor.getAttribute('href')
      if (!href || href.startsWith('#')) return null
      const path = routeFor(new URL(anchor.href))
      return path === null ? null : { anchor, path }
    }

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const hit = anchorRoute(event)
      if (!hit) return
      event.preventDefault()
      void navigate(hit.anchor.href)
    }

    const onPointerOver = (event: MouseEvent) => {
      const hit = anchorRoute(event)
      if (hit) preloadPage(hit.path)
    }

    window.addEventListener('popstate', onPopState)
    document.addEventListener('click', onClick)
    document.addEventListener('mouseover', onPointerOver, { passive: true })
    return () => {
      window.removeEventListener('popstate', onPopState)
      document.removeEventListener('click', onClick)
      document.removeEventListener('mouseover', onPointerOver)
    }
  }, [navigate, show])

  // Dev: a hot-updated page replaces the one on screen; scroll position is kept.
  useEffect(
    () =>
      onPageUpdate((id, module) => {
        setPage((current) => (siteStore.get().pages[current.path]?.id === id ? { path: current.path, module } : current))
      }),
    [],
  )

  // Dev: pages were added or removed. The current URL may now resolve differently.
  useEffect(
    () =>
      routeStore.subscribe(() => {
        void loadPage(pathRef.current).then((next) => setPage(next))
      }),
    [],
  )

  useEffect(() => {
    const target = scrollTarget.current
    scrollTarget.current = null
    if (target) applyScroll(target)
  }, [navigation])

  const view = useMemo(() => toPageView(site, page), [site, page])

  useEffect(() => {
    document.title = view.title && view.title !== site.site.title ? `${view.title} | ${site.site.title}` : site.site.title
  }, [view.title, site.site.title])

  const router = useMemo<RouterValue>(() => ({ path: page.path, navigate }), [page.path, navigate])

  return (
    <RouterContext value={router}>
      <PageContext value={view}>{children}</PageContext>
    </RouterContext>
  )
}
