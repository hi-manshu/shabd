/**
 * The words of the site's own furniture (shared/ui-text.ts) in the language
 * a page is in. This file knows nothing of the page on screen, so the router
 * can use it for what it works out before a page is drawn: `useText` in
 * edition.ts is the same for a component.
 */
import { placeOf } from '../../shared/editions.js'
import type { SiteData } from '../../shared/types.js'
import { textOf, type Text } from '../../shared/ui-text.js'

export type { Text }

/** The words in the language of the page at `path`. A key that language does not give is said in English. */
export function textFor(site: Pick<SiteData, 'ui' | 'editions' | 'site'>, path: string): Text {
  const { language } = placeOf(path, site.editions ?? {})
  return textOf(site.ui?.[language?.lang ?? site.site.lang])
}
