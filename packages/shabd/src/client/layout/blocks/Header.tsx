/** Blocks that normally live in the `header` region. Each is independent, so YAML can reorder or drop them. */
import { useEffect, useState } from 'react'
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
  return (
    <a className="sb-site-title" href={href('/')}>
      {logo && logo.light === logo.dark && <img className="sb-logo" src={href(logo.light)} alt={logo.alt} />}
      {logo && logo.light !== logo.dark && (
        <>
          <img className="sb-logo sb-only-light" src={href(logo.light)} alt={logo.alt} />
          <img className="sb-logo sb-only-dark" src={href(logo.dark)} alt={logo.alt} />
        </>
      )}
      <span>{site.title}</span>
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

export function ThemeToggle() {
  const { colorMode } = useSite()
  if (!colorMode.toggle) return null
  const toggle = () => {
    const root = document.documentElement
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark'
    root.dataset.theme = next
    try {
      localStorage.setItem('shabd-theme', next)
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

/** Opens the Studio. Only exists in `shabd dev`; production builds render nothing. */
export function StudioToggle() {
  const { features } = useSite()
  const { studioOpen } = useUi()
  const { notFound } = usePage()
  if (!import.meta.env.DEV || !features.studio.enabled || notFound) return null
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
