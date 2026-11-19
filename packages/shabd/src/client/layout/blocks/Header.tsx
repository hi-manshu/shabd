/** Blocks that normally live in the `header` region. Each is independent, so YAML can reorder or drop them. */
import { Fragment, useEffect, useRef, useState, type CSSProperties } from 'react'
import { COLOR_MODE_KEY, PALETTE_KEY } from '../../../shared/presets.js'
import { isExternal } from '../../../shared/paths.js'
import type { PaletteChoice } from '../../../shared/types.js'
import { hasIcon, Icon } from '../../app/icons.js'
import { usePage } from '../../app/router.js'
import { useSite } from '../../app/store.js'
import { setUi, useUi } from '../../app/ui.js'
import { Badge } from '../../ui/Badge.js'
import { useHref } from '../../ui/Link.js'

export function MenuToggle() {
  const { layout } = usePage()
  const { sidebarOpen } = useUi()
  if (!layout.regions.sidebar) return null
  return (
    <button
      type="button"
      className="sb-icon-button sb-menu-toggle"
      aria-label={sidebarOpen ? 'Close navigation' : 'Open navigation'}
      aria-expanded={sidebarOpen}
      onClick={() => setUi({ sidebarOpen: !sidebarOpen })}
    >
      <Icon name={sidebarOpen ? 'close' : 'menu'} />
    </button>
  )
}

export function SiteTitle() {
  const { site } = useSite()
  const href = useHref()
  const { logo } = site
  const target = logo?.href ?? '/'
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
  const { site } = useSite()
  const { path } = usePage()
  const href = useHref()
  if (site.nav.length === 0) return null
  return (
    <nav className="sb-nav" aria-label="Main">
      <ul>
        {site.nav.map((item) => {
          const internal = item.link.startsWith('/')
          const current = internal && firstSegment(item.link) === firstSegment(path) && path !== '/'
          return (
            <li key={item.link}>
              <a href={href(item.link)} aria-current={current ? 'true' : undefined}>
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

export function SearchButton({ label = 'Search' }: { label?: string }) {
  const { features } = useSite()
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
      <span className="sb-search-button-label">{label}</span>
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

export function ThemeToggle() {
  const { colorMode, palettes } = useSite()
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
    <button type="button" className="sb-icon-button sb-theme-toggle" onClick={toggle} aria-label="Switch colour theme">
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
    { title: titled ? 'Themes' : undefined, palettes: looks },
    { title: titled ? 'Palettes' : undefined, palettes: colours },
  ].filter((group) => group.palettes.length > 0)

  const choose = (name: string) => {
    const root = document.documentElement
    try {
      if (name === own) {
        delete root.dataset.palette
        localStorage.removeItem(PALETTE_KEY)
      } else {
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
        aria-label="Choose a theme"
        aria-expanded={open}
        aria-controls="sb-theme-menu-list"
        onClick={() => setOpen(!open)}
      >
        <Icon name="palette" />
      </button>
      <div className="sb-theme-menu-list" id="sb-theme-menu-list" role="group" aria-label="Theme" hidden={!open}>
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
  const { features, pages } = useSite()
  const { studioOpen } = useUi()
  const { path, notFound } = usePage()
  // A page made from an OpenAPI description has no file of its own to edit.
  if (!import.meta.env.DEV || !features.studio.enabled || notFound || pages[path]?.generated) return null
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
