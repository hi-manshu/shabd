/**
 * A site within the site: one version of the docs, or one language of them.
 *
 * Each is the pages under one path. The first of its kind is at the root of
 * the site: the current version, the language the site is written in. The
 * others are each under a path of their own, `/v1` or `/de`. A page has the
 * same path inside each, so `/v1/guide/install` is the page that
 * `/guide/install` is in the current version, and that is how a reader is
 * taken from one to the other.
 *
 * A site can have both. A language is then the outer of the two:
 * `/de/v1/guide/install`.
 *
 * This file is shared: the build decides with it what a page is part of, and
 * the browser finds the same page elsewhere with it.
 */

export interface Edition {
  /** What a reader picks it by: `2.x`, `Deutsch`. */
  label: string
  /** Where its pages start: `/v1`. Empty for the one at the root of the site. */
  prefix: string
  /** A language's code, as the `lang` of a page says it: `de`, `pt-BR`. */
  lang?: string
  /** The direction a language is written in. Left out, it is left to right. */
  dir?: 'ltr' | 'rtl'
  /** Search engines are asked not to list the pages of this one. An older version, unless the site says otherwise. */
  noindex?: boolean
}

export interface Editions {
  /** The languages of the site, the one at its root first. Left out on a site in one language. */
  languages?: Edition[]
  /** The versions of the docs, the current one first. Left out on a site with one. */
  versions?: Edition[]
}

/** Where a page is: in which language, in which version, and at which path inside those. */
export interface Place {
  language: Edition | undefined
  version: Edition | undefined
  /** The page's path with what says the language and the version taken off: `/guide/install`. */
  rest: string
}

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`)

/** The one of a kind that a path is in, and the path inside it. Only the first of a kind has no path of its own. */
function take(path: string, kind: Edition[] | undefined): [Edition | undefined, string] {
  if (!kind || kind.length === 0) return [undefined, path]
  const found = kind.find((edition) => edition.prefix !== '' && under(path, edition.prefix))
  return found ? [found, path.slice(found.prefix.length) || '/'] : [kind[0], path]
}

export function placeOf(path: string, editions: Editions): Place {
  const [language, inLanguage] = take(path, editions.languages)
  const [version, rest] = take(inLanguage, editions.versions)
  return { language, version, rest }
}

/** The path of a page that is at `rest` in a language and a version. */
export function pathAt(place: Place): string {
  const prefix = `${place.language?.prefix ?? ''}${place.version?.prefix ?? ''}`
  return place.rest === '/' ? prefix || '/' : `${prefix}${place.rest}`
}

/** Are two pages in the same language and the same version? */
export function samePlace(a: Place, b: Place): boolean {
  return a.language?.prefix === b.language?.prefix && a.version?.prefix === b.version?.prefix
}

/**
 * Where a reader goes when they pick another language or another version:
 * the page they are on, there, when it has that page, and its first page
 * when it has not.
 */
export function elsewhere(place: Place, to: Partial<Pick<Place, 'language' | 'version'>>, isPage: (path: string) => boolean): string {
  const target = { ...place, ...to }
  const same = pathAt(target)
  return isPage(same) ? same : pathAt({ ...target, rest: '/' })
}

/** Every path that a language or a version starts at, the longest first: `/de/v1`, `/de`, `/v1`. */
export function editionRoots(editions: Editions): string[] {
  const languages = editions.languages ?? [{ label: '', prefix: '' }]
  const versions = editions.versions ?? [{ label: '', prefix: '' }]
  const roots = languages.flatMap((language) => versions.map((version) => `${language.prefix}${version.prefix}`)).filter((root) => root !== '')
  return [...new Set(roots)].sort((a, b) => b.length - a.length)
}

/** Is the page in the language at the root of the site, and in the current version? */
export function isCurrent(path: string, editions: Editions): boolean {
  const { language, version } = placeOf(path, editions)
  return (language?.prefix ?? '') === '' && (version?.prefix ?? '') === ''
}
