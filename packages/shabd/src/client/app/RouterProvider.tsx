/**
 * Keeps the page that is on screen, and moves between pages.
 *
 * What a page is and how one is loaded is in router.tsx, with the hooks
 * components use. This file exports the component and nothing else, so that
 * a change to it is taken in place while the dev server runs.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { PassageTarget } from '../../shared/passage.js'
import { onPageUpdate } from './hmr.js'
import { loadPage, preloadPage, routeFor, currentRoute, toPageView, RouterContext, PageContext, type PageView, type RouterValue } from './router.js'
import { routeStore, siteStore, useSite } from './store.js'
import type { LoadedPage } from './types.js'
import { setUi } from './ui.js'

interface ScrollTarget {
  hash: string
  /** Pixel offset to restore, or null to go to the hash (or the top). */
  top: number | null
  focus: boolean
  /** The passage a search result led to, within the section the hash names. */
  passage?: PassageTarget | undefined
}

/**
 * What an entry of the browser's history holds. A passage travels here and
 * not in the address, so the address of a search result is the address of
 * its section and nothing more.
 */
interface EntryState {
  key?: string
  passage?: PassageTarget
}

const scrollPositions = new Map<string, number>()
let keySeed = 0
const newKey = () => `${Date.now().toString(36)}${keySeed++}`
const entryState = (): EntryState => (history.state as EntryState | null) ?? {}
const historyKey = (): string => entryState().key ?? ''

/**
 * The passage the current entry holds. History outlives a deploy, so what is
 * read back may have been put there by another version of the site: anything
 * that is not a passage as this version knows it is left alone.
 */
function heldPassage(): PassageTarget | undefined {
  const held: Partial<Record<keyof PassageTarget, unknown>> | undefined = entryState().passage
  const isPassage =
    typeof held?.text === 'string' && Array.isArray(held.words) && held.words.every((word) => typeof word === 'string')
  return isPassage ? (held as PassageTarget) : undefined
}

/**
 * Take the passage out of the current entry. It is kept while the reader is
 * at it, so that a reload shows the same thing again, and dropped when they
 * clear the marks or leave: coming back does not mark the page a second time.
 */
function forgetPassage(): void {
  const { key, passage } = entryState()
  if (passage) history.replaceState({ key }, '')
}

/** Removes the marks a search result left on the page. Null when there are none. */
let removeMarks: (() => void) | null = null

function clearMarks(): void {
  removeMarks?.()
  removeMarks = null
}

function goToPassage(passage: PassageTarget, hash: string): void {
  const key = historyKey()
  // Fetched when it is needed: only a reader who arrives from search has a passage to go to,
  // and the search dialog has loaded this module by then.
  void import('../search/passage.js').then(
    ({ showPassage }) => {
      // The reader may have gone somewhere else while it loaded.
      if (historyKey() !== key) return
      clearMarks()
      removeMarks = showPassage(passage, hash ? decodeURIComponent(hash.slice(1)) : '', forgetPassage)
    },
    () => {
      // The page is at the section's heading, which is where a result led before there were passages.
    },
  )
}

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
  if (target.passage) goToPassage(target.passage, target.hash)
}

export function RouterProvider({ initial, children }: { initial: LoadedPage; children: ReactNode }) {
  const site = useSite()
  const [page, setPage] = useState(initial)
  const [navigation, setNavigation] = useState(0)
  const pathRef = useRef(initial.path)
  const keyRef = useRef('')
  const scrollTarget = useRef<ScrollTarget | null>(null)

  const show = useCallback((next: LoadedPage, target: ScrollTarget) => {
    // The marks of a search result belong to the visit they were made for.
    clearMarks()
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
      // The entry being left gives up its passage, so that coming back to it marks nothing.
      forgetPassage()
      keyRef.current = newKey()
      const { passage } = options
      const state: EntryState = { key: keyRef.current, ...(passage ? { passage } : {}) }
      history[options.replace ? 'replaceState' : 'pushState'](state, '', url.href)
      setUi({ sidebarOpen: false })
      show(next, { hash: url.hash, top: null, focus: !options.keepFocus && path !== pathRef.current, passage })
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
    // After a reload, the entry may still hold the passage a search result led to.
    const passage = heldPassage()
    if (location.hash || passage) applyScroll({ hash: location.hash, top: null, focus: false, passage })

    const onPopState = async () => {
      scrollPositions.set(keyRef.current, window.scrollY)
      keyRef.current = historyKey()
      // Back at an entry that was left with its marks on: they went when the reader did.
      forgetPassage()
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
        // The body is rendered again from the new module, so the text a search result's marks were on is gone.
        const fileOf = (path: string) => siteStore.get().pagesInDev?.[path]?.id
        if (fileOf(pathRef.current) === id) clearMarks()
        setPage((current) => (fileOf(current.path) === id ? { path: current.path, module } : current))
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

  const found = useMemo(() => toPageView(site, page), [site, page])
  /** The page a caller of `hold` asked to keep on screen. It is shown for as long as there is no page at the address. */
  const [held, setHeld] = useState<PageView | null>(null)
  const view = held && found.notFound ? held : found
  const shown = useRef(view)
  useEffect(() => {
    shown.current = view
  })

  const hold = useCallback(() => {
    const kept = shown.current
    setHeld(kept)
    return () => setHeld((current) => (current === kept ? null : current))
  }, [])

  useEffect(() => {
    document.title = view.title && view.title !== site.site.title ? `${view.title} | ${site.site.title}` : site.site.title
  }, [view.title, site.site.title])

  const router = useMemo<RouterValue>(() => ({ path: page.path, navigate, hold }), [page.path, navigate, hold])

  return (
    <RouterContext value={router}>
      <PageContext value={view}>{children}</PageContext>
    </RouterContext>
  )
}
