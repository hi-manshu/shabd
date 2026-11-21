/** Blocks that normally live in the `header` region. Each is independent, so YAML can reorder or drop them. */
import { Fragment, useEffect, useRef, useState, type CSSProperties } from 'react'
import { CODE_THEMES_ID, CODE_THEMES_META, COLOR_MODE_KEY, PALETTE_KEY } from '../../../shared/presets.js'
import { placeOf, samePlace } from '../../../shared/editions.js'
import { isExternal, normalizePath } from '../../../shared/paths.js'
import type { PaletteChoice } from '../../../shared/types.js'
import { useLocalLink, usePlace, useSiteInLanguage, useText } from '../../app/edition.js'
import { hasIcon } from '../../app/icon-table.js'
import { Icon } from '../../app/icons.js'
import { usePage } from '../../app/router.js'
import { useSite } from '../../app/store.js'
import { setUi, useUi } from '../../app/ui.js'
import { Badge } from '../../ui/Badge.js'
import { useHref } from '../../ui/href.js'

export function MenuToggle() {
  const { layout } = usePage()
  const { sidebarOpen } = useUi()
  const text = useText()
  if (!layout.regions.sidebar) return null
  return (
    <button
      type="button"
      className="sb-icon-button sb-menu-toggle"
      aria-label={text(sidebarOpen ? 'nav.close' : 'nav.open')}
      aria-expanded={sidebarOpen}
      // The sidebar region. PageLayout gives it this id.
      aria-controls="sb-sidebar"
      onClick={() => setUi({ sidebarOpen: !sidebarOpen })}
    >
      <Icon name={sidebarOpen ? 'close' : 'menu'} />
    </button>
  )
}

export function SiteTitle() {
  const { site } = useSite()
  const href = useHref()
  const { home } = useSiteInLanguage()
  const { logo } = site
  // The title leads to where the site starts, which for a reader of another language is where that language starts.
  const target = !logo || logo.href === '/' ? home : logo.href
  // A logo that stands in for the title has to carry the link's name.
  const alt = logo?.replacesTitle ? logo.alt || site.title : (logo?.alt ?? '')
  return (
    <a
      className="sb-site-title"
      href={isExternal(target) ? target : href(target)}
      style={logo ? ({ '--sb-logo-height': logo.height } as CSSProperties) : undefined}
    >
      {logo && logo.light === logo.dark && <img className="sb-logo" src={href(logo.light)} alt={alt} />}
      {logo && logo.light !== logo.dark && (
        <>
          <img className="sb-logo sb-only-light" src={href(logo.light)} alt={alt} />
          <img className="sb-logo sb-only-dark" src={href(logo.dark)} alt={alt} />
        </>
      )}
      {!logo?.replacesTitle && <span>{site.title}</span>}
    </a>
  )
}

const firstSegment = (path: string) => path.split('/')[1] ?? ''

export function Nav() {
  const place = usePlace()
  const { nav } = useSiteInLanguage()
  const local = useLocalLink()
  const href = useHref()
  const text = useText()
  if (nav.length === 0) return null
  return (
    <nav className="sb-nav" aria-label={text('nav.main')}>
      <ul>
        {nav.map((item) => {
          const internal = item.link.startsWith('/')
          // A link leads to the reader's own language and version where the page is there too.
          const link = local(item.link)
          const there = placeOf(normalizePath(link.split(/[?#]/)[0]!), place.editions)
          // The part of the site a reader is in: the link's first folder, in their language and version.
          const current = internal && samePlace(there, place) && firstSegment(there.rest) === firstSegment(place.rest) && place.rest !== '/'
          return (
            <li key={item.link}>
              <a href={href(link)} aria-current={current ? 'true' : undefined}>
                {item.label}
                {item.badge && <Badge {...item.badge} />}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** Pushes the blocks after it to the far edge of the header. */
export function Spacer() {
  return <span className="sb-spacer" />
}

export function SearchButton({ label }: { label?: string }) {
  const { features } = useSite()
  const text = useText()
  const enabled = features.search.enabled
  // The modifier differs by platform and is only known in the browser.
  const [shortcut, setShortcut] = useState('Ctrl K')

  useEffect(() => {
    if (!enabled) return
    if (/Mac|iPhone|iPad/i.test(navigator.platform)) setShortcut('⌘K')
    const onKeyDown = (event: KeyboardEvent) => {
      const typing = /^(?:INPUT|TEXTAREA|SELECT)$/.test((event.target as Element).tagName) ||
        (event.target as HTMLElement).isContentEditable
      const openKey = ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') || (event.key === '/' && !typing)
      if (!openKey) return
      event.preventDefault()
      setUi({ searchOpen: true })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])

  if (!enabled) return null
  return (
    <button type="button" className="sb-search-button" onClick={() => setUi({ searchOpen: true })}>
      <Icon name="search" size={16} />
      <span className="sb-search-button-label">{label ?? text('search')}</span>
      <kbd>{shortcut}</kbd>
    </button>
  )
}

export function Social() {
  const { site } = useSite()
  if (site.social.length === 0) return null
  return (
    <ul className="sb-social">
      {site.social.map((link) => (
        <li key={link.href}>
          <a className="sb-icon-button" href={link.href} target="_blank" rel="noreferrer" aria-label={link.label}>
            <Icon name={hasIcon(link.icon) ? link.icon : 'globe'} />
          </a>
        </li>
      ))}
    </ul>
  )
}

/**
 * A preset from the theme menu has syntax themes of its own. `data-code` on
 * the root element says which one applies now; the page's code stylesheet
 * has a rule for each. Call this after the palette or the colour mode changes.
 */
function syncCodeTheme(palettes: PaletteChoice[]): void {
  const root = document.documentElement
  const choice = palettes.find((palette) => palette.name === root.dataset.palette)
  if (choice) root.dataset.code = choice.code[root.dataset.theme === 'dark' ? 1 : 0]
  else delete root.dataset.code
}

/**
 * Fetch the colours of code under the presets' syntax themes. A built site
 * keeps them in one stylesheet, which a page names and does not load: only a
 * reader who picks a preset needs it. It is fetched as the menu opens, so
 * that it is there by the time one is picked. A reader who comes back with
 * a preset already picked gets it from the script in the page head.
 *
 * In `shabd dev` there is no such stylesheet: each page carries all of it.
 */
function loadCodeThemes(): void {
  if (document.getElementById(CODE_THEMES_ID)) return
  const href = document.querySelector<HTMLMetaElement>(`meta[name="${CODE_THEMES_META}"]`)?.content
  if (!href) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.id = CODE_THEMES_ID
  link.href = href
  document.head.append(link)
}

export function ThemeToggle() {
  const { colorMode, palettes } = useSite()
  const text = useText()
  if (!colorMode.toggle) return null
  const toggle = () => {
    const root = document.documentElement
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark'
    root.dataset.theme = next
    syncCodeTheme(palettes)
    try {
      localStorage.setItem(COLOR_MODE_KEY, next)
    } catch {
      // Private browsing: the choice lasts for this page view.
    }
  }
  // Both icons are rendered and CSS shows one, so server and client markup match in either mode.
  return (
    <button type="button" className="sb-icon-button sb-theme-toggle" onClick={toggle} aria-label={text('theme.mode')}>
      <span className="sb-only-light">
        <Icon name="moon" />
      </span>
      <span className="sb-only-dark">
        <Icon name="sun" />
      </span>
    </button>
  )
}

/**
 * A menu of palettes for the reader (`theme.picker`). The first entry is the
 * site's own. The choice is stored, and the inline script in the page head
 * applies it before the next page paints.
 */
export function ThemeMenu() {
  const text = useText()
  const { palettes } = useSite()
  const own = palettes[0]?.name
  const [open, setOpen] = useState(false)
  // The server cannot know the reader's choice: start from the site's own, then read what the inline script applied.
  const [current, setCurrent] = useState(own)
  const menu = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setCurrent(document.documentElement.dataset.palette ?? own)
  }, [own])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      menu.current?.querySelector('button')?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (palettes.length === 0) return null

  // The site's own first, then the presets that change the whole look, then the ones that only recolour.
  const others = palettes.slice(1)
  const looks = others.filter((palette) => palette.look)
  const colours = others.filter((palette) => !palette.look)
  const titled = looks.length > 0 && colours.length > 0
  const groups = [
    { title: undefined, palettes: palettes.slice(0, 1) },
    { title: titled ? text('theme.themes') : undefined, palettes: looks },
    { title: titled ? text('theme.palettes') : undefined, palettes: colours },
  ].filter((group) => group.palettes.length > 0)

  const choose = (name: string) => {
    const root = document.documentElement
    try {
      if (name === own) {
        delete root.dataset.palette
        localStorage.removeItem(PALETTE_KEY)
      } else {
        // Usually here already, from when the menu opened.
        loadCodeThemes()
        root.dataset.palette = name
        localStorage.setItem(PALETTE_KEY, name)
      }
    } catch {
      // Private browsing: the choice lasts for this page view.
    }
    syncCodeTheme(palettes)
    setCurrent(name)
    setOpen(false)
  }

  return (
    <div className="sb-theme-menu" ref={menu}>
      <button
        type="button"
        className="sb-icon-button"
        aria-label={text('theme.choose')}
        aria-expanded={open}
        aria-controls="sb-theme-menu-list"
        onClick={() => {
          if (!open) loadCodeThemes()
          setOpen(!open)
        }}
      >
        <Icon name="palette" />
      </button>
      <div className="sb-theme-menu-list" id="sb-theme-menu-list" role="group" aria-label={text('theme.list')} hidden={!open}>
        {groups.map((group) => (
          <Fragment key={group.title ?? 'own'}>
            {group.title && <p className="sb-theme-menu-heading">{group.title}</p>}
            {group.palettes.map((palette) => (
              <button
                key={palette.name}
                type="button"
                className="sb-theme-option"
                aria-pressed={palette.name === current}
                onClick={() => choose(palette.name)}
              >
                {(['light', 'dark'] as const).map((mode) => (
                  <span
                    key={mode}
                    className={`sb-swatch sb-only-${mode}`}
                    style={
                      {
                        '--sb-swatch-page': palette.swatch[mode][0],
                        '--sb-swatch-accent': palette.swatch[mode][1],
                        '--sb-swatch-mark': palette.swatch[mode][2],
                      } as CSSProperties
                    }
                  />
                ))}
                <span>{palette.label}</span>
              </button>
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  )
}

/** Opens the Studio. Only exists in `shabd dev`; production builds render nothing. */
export function StudioToggle() {
  const { features, pagesInDev } = useSite()
  const { studioOpen } = useUi()
  const { path, notFound } = usePage()
  // A page made from an OpenAPI description has no file of its own to edit.
  if (!import.meta.env.DEV || !features.studio.enabled || notFound || pagesInDev?.[path]?.generated) return null
  return (
    <button
      type="button"
      className="sb-studio-toggle"
      aria-pressed={studioOpen}
      onClick={() => setUi({ studioOpen: !studioOpen })}
    >
      <Icon name="edit" size={15} />
      <span>{studioOpen ? 'Close editor' : 'Edit page'}</span>
    </button>
  )
}
