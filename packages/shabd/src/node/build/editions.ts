/**
 * What a page's document says because of the version and the language the
 * page is in (shared/editions.ts): the language it is written in, the same
 * page in the site's other languages, and whether a search engine should
 * list it.
 */
import { pathAt, placeOf } from '../../shared/editions.js'
import { textOf, type Text } from '../../shared/ui-text.js'
import type { ResolvedConfig } from '../config/load.js'
import type { ShabdContext } from '../context.js'
import { pageAddress } from '../llms/llms-txt.js'

export interface DocumentEdition {
  /** The page's language, where the site has more than one. */
  lang?: string
  dir?: 'rtl'
  /** The page in each language that has it, this one included, for search engines. Needs `site.url`. */
  alternates?: { lang: string; href: string }[]
  /** The page is in a version that search engines are asked not to list. */
  noindex: boolean
}

/** The language of the page at a path: the one it is under, and the site's own where the site has one language. */
export function languageAt(config: ResolvedConfig, routePath: string): string {
  return placeOf(routePath, config.editions).language?.lang ?? config.config.site.lang
}

/** The site's own words (shared/ui-text.ts) as the language of the page at a path says them. */
export function textAt(config: ResolvedConfig, routePath: string): Text {
  const lang = languageAt(config, routePath)
  return textOf(config.config.languages.find((language) => language.code === lang)?.ui)
}

export function documentEdition(context: ShabdContext, routePath: string): DocumentEdition {
  const { editions } = context.config
  const { site } = context.config.config
  const place = placeOf(routePath, editions)
  const out: DocumentEdition = { noindex: place.version?.noindex === true }
  if (!place.language?.lang) return out

  out.lang = place.language.lang
  if (place.language.dir === 'rtl') out.dir = 'rtl'
  // Search engines are told of a page's other languages by full addresses, and each page names itself among them.
  if (site.url && (editions.languages?.length ?? 0) > 1 && context.store.byPath(routePath)) {
    const alternates = (editions.languages ?? []).flatMap((language) => {
      const there = pathAt({ ...place, language })
      return language.lang && context.store.byPath(there) ? [{ lang: language.lang, href: pageAddress(context, there) }] : []
    })
    if (alternates.length > 1) {
      // For a reader whose language the site does not have: the language the site is written in, where it has the page.
      const fallback = alternates.find((alternate) => alternate.lang === editions.languages?.[0]?.lang)
      out.alternates = [...alternates, ...(fallback ? [{ lang: 'x-default', href: fallback.href }] : [])]
    }
  }
  return out
}
