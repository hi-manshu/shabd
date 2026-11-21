/**
 * How the page looks, for the frame of an isolated snippet to look the same.
 *
 * The frame has an origin of its own. It may show a stylesheet it is given as
 * text, and it may link one from anywhere, but it may not fetch a font: fonts
 * are only given to the origin that asks where the host says so, and most
 * hosts, and the dev server, do not say so to an origin that has no name. So
 * the page reads its own stylesheets, takes the `@font-face` rules out, and
 * sends the bytes of the fonts it has itself loaded.
 */
import type { FrameFont, Look, Sheet } from './protocol.js'

/** A font a stylesheet of the page declares, and where its files are. */
interface DeclaredFont {
  family: string
  urls: string[]
  descriptors: FontFaceDescriptors
}

/** Rules that hold other rules, among which a `@font-face` may be. */
const GROUPS = new Set(['CSSMediaRule', 'CSSSupportsRule', 'CSSLayerBlockRule', 'CSSContainerRule', 'CSSScopeRule'])

/** An address in a stylesheet is read from where the stylesheet is. In the frame it is read from the page, so it is written out in full. */
const absolute = (css: string, base: string) =>
  css.replace(/url\((["']?)(?!["']?(?:data:|blob:|#))([^"')]+)\1\)/g, (whole, _quote: string, address: string) => {
    try {
      return `url("${new URL(address, base).href}")`
    } catch {
      return whole
    }
  })

function declared(rule: CSSFontFaceRule, base: string): DeclaredFont | undefined {
  const value = (name: string) => rule.style.getPropertyValue(name).trim()
  const family = value('font-family').replace(/^["']|["']$/g, '')
  const urls = [...value('src').matchAll(/url\((["']?)([^"')]+)\1\)/g)].flatMap((match) => {
    try {
      return [new URL(match[2]!, base).href]
    } catch {
      return []
    }
  })
  if (!family || urls.length === 0) return undefined
  const descriptors: FontFaceDescriptors = {}
  const keep = (key: keyof FontFaceDescriptors, name: string) => {
    if (value(name)) descriptors[key] = value(name) as never
  }
  keep('weight', 'font-weight')
  keep('style', 'font-style')
  keep('stretch', 'font-stretch')
  keep('unicodeRange', 'unicode-range')
  keep('featureSettings', 'font-feature-settings')
  keep('display', 'font-display')
  return { family, urls, descriptors }
}

/** The rules as text, without the fonts, which are gathered in `fonts`. */
function written(rules: CSSRuleList, base: string, fonts: DeclaredFont[]): string {
  let css = ''
  for (const rule of rules) {
    if (rule instanceof CSSFontFaceRule) {
      const font = declared(rule, base)
      if (font) fonts.push(font)
    } else if (GROUPS.has(rule.constructor.name)) {
      const text = rule.cssText
      css += `${text.slice(0, text.indexOf('{') + 1)}${written((rule as CSSGroupingRule).cssRules, base, fonts)}}`
    } else {
      css += absolute(rule.cssText, base)
    }
  }
  return css
}

interface PageLook {
  look: Look
  fonts: DeclaredFont[]
}

/** The page as it looks now. */
export function readLook(): PageLook {
  const root = document.documentElement
  const attributes: Record<string, string> = {}
  // `data-shabd` says the app has started, which is not a matter of looks.
  for (const name of root.getAttributeNames()) if (name !== 'data-shabd') attributes[name] = root.getAttribute(name) ?? ''

  const sheets: Sheet[] = []
  const fonts: DeclaredFont[] = []
  for (const sheet of document.styleSheets) {
    if (sheet.disabled) continue
    const media = sheet.media.mediaText
    try {
      const css = written(sheet.cssRules, sheet.href ?? document.baseURI, fonts)
      if (css) sheets.push({ css: media && media !== 'all' ? `@media ${media}{${css}}` : css })
    } catch {
      // A stylesheet from another site may be shown and not read. The frame links it itself.
      if (sheet.href) sheets.push({ href: sheet.href, ...(media && media !== 'all' ? { media } : {}) })
    }
  }
  return { look: { attributes, sheets }, fonts }
}

const bytes = new Map<string, Promise<ArrayBuffer | undefined>>()

/**
 * The bytes of the declared fonts that the page has fetched, apart from those
 * in `sent`, which is added to. A font the page has not needed is not fetched
 * for the frame: a site's fonts come in many files, most of them for letters
 * the page does not have.
 */
export async function loadedFonts(fonts: DeclaredFont[], sent: Set<string>): Promise<FrameFont[]> {
  const fetched = new Set(performance.getEntriesByType('resource').map((entry) => entry.name))
  const wanted = fonts.flatMap((font) => {
    const url = font.urls.find((address) => fetched.has(address))
    if (!url || sent.has(url)) return []
    sent.add(url)
    return [{ font, url }]
  })
  const found = await Promise.all(
    wanted.map(async ({ font, url }): Promise<FrameFont | undefined> => {
      let source = bytes.get(url)
      if (!source) {
        source = fetch(url).then(
          (response) => (response.ok ? response.arrayBuffer() : undefined),
          () => undefined,
        )
        bytes.set(url, source)
      }
      const data = await source
      return data ? { family: font.family, source: data, descriptors: font.descriptors } : undefined
    }),
  )
  return found.filter((font) => font !== undefined)
}

const watchers = new Set<() => void>()
let stop: (() => void) | undefined

/** Call `changed` whenever the page may look different: its root element, its stylesheets, the fonts it has. */
export function watchLook(changed: () => void): () => void {
  watchers.add(changed)
  if (!stop) {
    let waiting = 0
    const tell = () => {
      window.clearTimeout(waiting)
      // A change of theme sets several attributes, and a hot update several stylesheets: one telling for the lot.
      waiting = window.setTimeout(() => {
        for (const watcher of watchers) watcher()
      }, 30)
    }
    const observer = new MutationObserver(tell)
    observer.observe(document.documentElement, { attributes: true })
    observer.observe(document.head, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href', 'media', 'disabled'] })
    // A stylesheet that was linked a moment ago can be read once it has loaded.
    document.head.addEventListener('load', tell, true)
    document.fonts.addEventListener('loadingdone', tell)
    stop = () => {
      window.clearTimeout(waiting)
      observer.disconnect()
      document.head.removeEventListener('load', tell, true)
      document.fonts.removeEventListener('loadingdone', tell)
    }
  }
  return () => {
    watchers.delete(changed)
    if (watchers.size === 0) {
      stop?.()
      stop = undefined
    }
  }
}
