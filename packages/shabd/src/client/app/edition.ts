/**
 * The language and the version of the page on screen (shared/editions.ts),
 * and what follows from them: where the same page is in another, and the
 * words of the site's own furniture in the page's language.
 */
import { elsewhere, pathAt, placeOf, type Edition, type Editions, type Place } from '../../shared/editions.js'
import { normalizePath } from '../../shared/paths.js'
import type { NavItem } from '../../shared/schema.js'
import { flattenSidebar } from '../../shared/sidebar.js'
import { usePage } from './router.js'
import { routeStore, useSite, useStore } from './store.js'
import { textFor, type Text } from './words.js'

const NONE: Editions = {}

/** Where the page on screen is among the site's languages and versions. */
export function usePlace(): Place & { editions: Editions } {
  const { editions = NONE } = useSite()
  const { path } = usePage()
  return { ...placeOf(path, editions), editions }
}

/**
 * Where a reader lands when they pick another language or another version:
 * the page they are on, there; or its first page, where it has no such page.
 */
export function useElsewhere(): (to: { language?: Edition; version?: Edition }) => { path: string; samePage: boolean } {
  const place = usePlace()
  const { sidebars } = useSite()
  const routes = useStore(routeStore)
  const isPage = (path: string) => Object.hasOwn(routes, path)
  return (to) => {
    const same = pathAt({ ...place, ...to })
    if (isPage(same)) return { path: same, samePage: true }
    const home = elsewhere(place, to, isPage)
    if (isPage(home)) return { path: home, samePage: false }
    // It has no page at its own root: the first page of its sidebar is where it starts.
    const first = flattenSidebar(sidebars?.find((section) => section.prefix === home)?.sidebar ?? [])[0]
    return { path: first?.path ?? home, samePage: false }
  }
}

/**
 * A link the site writes once for every language and version, as it is for
 * the reader of the page on screen: the same page in their language and
 * their version where there is one. Where there is not, their language
 * comes before their version: the page in their language, then the page in
 * their version, then the link as it is written.
 *
 * A link that names a language goes to that language, and one that names a
 * version to that version. Only what a link leaves unsaid follows the reader.
 */
export function useLocalLink(): (link: string) => string {
  const place = usePlace()
  const routes = useStore(routeStore)
  return (link) => {
    if (!link.startsWith('/') || link.startsWith('//')) return link
    const cut = link.search(/[?#]/)
    const path = normalizePath(cut < 0 ? link : link.slice(0, cut))
    const written = placeOf(path, place.editions)
    const language = (written.language?.prefix ?? '') === '' ? place.language : written.language
    const version = (written.version?.prefix ?? '') === '' ? place.version : written.version
    const tries = [
      { language, version },
      { language, version: written.version },
      { language: written.language, version },
    ]
    for (const to of tries) {
      const there = pathAt({ ...to, rest: written.rest })
      if (there === path) break
      if (Object.hasOwn(routes, there)) return there + (cut < 0 ? '' : link.slice(cut))
    }
    return link
  }
}

/** The header's links and the footer as the language of the page on screen has them, and where that language starts. */
export function useSiteInLanguage(): { nav: NavItem[]; footer: string | undefined; home: string } {
  const { site, siteIn } = useSite()
  const { language } = usePlace()
  const routes = useStore(routeStore)
  const said = siteIn?.[language?.lang ?? '']
  const home = language?.prefix && Object.hasOwn(routes, language.prefix) ? language.prefix : '/'
  return { nav: said?.nav ?? site.nav, footer: said?.footer ?? site.footer, home }
}

/** The words of the site's furniture in the language of the page on screen (words.ts). */
export function useText(): Text {
  return textFor(useSite(), usePage().path)
}
