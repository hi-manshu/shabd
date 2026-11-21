/**
 * A small client router for a site whose routes are known up front.
 *
 * Navigation waits for the next page's module before committing, so the
 * current page stays on screen until the new one can render in full. There is
 * no loading state to design around and no layout shift between pages.
 *
 * This file is what the router knows and what a component asks it: how a
 * page is loaded, what a page on screen is, and the two hooks. The component
 * that keeps the page on screen is in RouterProvider.tsx. They are apart
 * because a file that exports a component beside anything else cannot take a
 * hot update: a change to it started the whole page again.
 */
import { createContext, useContext, type ComponentType, type Context } from 'react'
import { resolvePageLayout, type ActiveLayout } from '../../shared/layout.js'
import type { PassageTarget } from '../../shared/passage.js'
import { normalizePath, stripBase } from '../../shared/paths.js'
import type { Frontmatter } from '../../shared/schema.js'
import type { PageUpdated, SiteData, TocEntry } from '../../shared/types.js'
import { pageModules } from './hmr.js'
import { NotFound } from './NotFound.js'
import { routeStore, siteStore } from './store.js'
import type { LoadedPage } from './types.js'

/* ───────────────────────────── loading ───────────────────────────── */

export async function loadPage(path: string): Promise<LoadedPage> {
  const load = routeStore.get()[path]
  if (!load) return { path, module: null }
  // While the dev server runs, a hot-updated module is preferred over the browser's cached copy of the
  // import. It is kept by the page's file, which the dev server's table of pages gives.
  const id = siteStore.get().pagesInDev?.[path]?.id
  let module = id === undefined ? undefined : pageModules.get(id)
  if (!module) {
    module = await load()
    if (id !== undefined) pageModules.set(id, module)
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
  /** The day the page was last changed, when the site shows it and has one. */
  updated?: PageUpdated | undefined
  /** The layout chosen by frontmatter, with this page's region switches applied. */
  layout: ActiveLayout
  Content: ComponentType<Record<string, unknown>>
  notFound: boolean
}

const NO_FRONTMATTER = { sidebar: {}, badges: [], draft: false, noindex: false, toc: undefined } as Frontmatter

export function toPageView(site: SiteData, page: LoadedPage): PageView {
  // What the site knows of the page comes with the page.
  const meta = page.module?.meta
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
      layout: resolvePageLayout(site, frontmatter, [], page.path),
      Content: NotFound,
      notFound: true,
    }
  }
  const { frontmatter, toc } = page.module
  return {
    codeCss: page.module.codeCss ?? '',
    updated: page.module.updated,
    path: page.path,
    id: meta.id,
    title: meta.title,
    description: meta.description,
    frontmatter,
    toc,
    layout: resolvePageLayout(site, frontmatter, toc, page.path),
    Content: page.module.default,
    notFound: false,
  }
}

/* ───────────────────────────── contexts ──────────────────────────── */

export interface RouterValue {
  path: string
  /**
   * Go to a page of the site. `passage` is what a search result passes on: the
   * page then opens at that passage, with the words of the query marked.
   *
   * `keepFocus` leaves focus where it is. A new page normally takes it; the Studio keeps it when it is
   * the Studio that moved the reader, to a page it has just made or renamed.
   */
  navigate(to: string, options?: { replace?: boolean; passage?: PassageTarget; keepFocus?: boolean }): Promise<void>
  /**
   * Dev: keep the page that is on screen there, though its file goes, until the function this returns is
   * called. The Studio holds a page while it renames or deletes it. Without that the page is "not found"
   * from the moment its file is gone until the Studio has gone to where the page went, and for a long page
   * that is most of a second.
   */
  hold(): () => void
}

/**
 * One pair of contexts for as long as the page lives.
 *
 * While the dev server runs, a hot update gives each module that takes it a fresh copy of the modules
 * above the one that changed, and this file is above several. A context made by a copy is one that
 * nothing provides: the components that had the copy said they were "used outside the Shabd app", and
 * drew nothing. So the dev server keeps the pair where every copy of this file finds it. A build has
 * one copy, and makes the pair once.
 */
interface Contexts {
  router: Context<RouterValue | null>
  page: Context<PageView | null>
}
const kept = import.meta.hot?.data as { contexts?: Contexts } | undefined
const contexts: Contexts = kept?.contexts ?? { router: createContext<RouterValue | null>(null), page: createContext<PageView | null>(null) }
if (kept) kept.contexts = contexts

export const RouterContext = contexts.router
export const PageContext = contexts.page

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
