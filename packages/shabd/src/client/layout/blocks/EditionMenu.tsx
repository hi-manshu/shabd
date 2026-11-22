/**
 * The two menus of a site that has more than one version or more than one
 * language (shared/editions.ts). Each takes a reader to the page they are on,
 * in the version or the language they pick.
 *
 * A menu is a `<details>` with links in it, so it opens, and its links lead
 * somewhere, with no script at all. The script that there is closes it: when
 * a link in it has been followed, on Escape, and on a click anywhere else.
 */
import { useEffect, useRef } from 'react'
import { usePlace, useElsewhere, useText } from '../../app/edition.js'
import { Icon } from '../../app/icons.js'
import { usePage } from '../../app/router.js'
import { useHref } from '../../ui/href.js'

interface Choice {
  label: string
  href: string
  current: boolean
  /** The language a label is written in, when it is the name of one. */
  lang?: string | undefined
}

function Menu({ kind, name, current, short, choices }: { kind: 'version' | 'language'; name: string; current: string; short?: string | undefined; choices: Choice[] }) {
  const details = useRef<HTMLDetailsElement>(null)
  const { path } = usePage()

  // The reader is somewhere else now: by this menu, or by any other way.
  useEffect(() => {
    if (details.current) details.current.open = false
  }, [path])

  useEffect(() => {
    const close = (event: MouseEvent | KeyboardEvent) => {
      const menu = details.current
      if (!menu?.open) return
      if (event instanceof KeyboardEvent) {
        if (event.key !== 'Escape') return
        menu.open = false
        // Focus goes back to what opened the list, and not to the top of the page.
        if (menu.contains(document.activeElement)) menu.querySelector('summary')?.focus()
      } else if (!menu.contains(event.target as Node)) {
        menu.open = false
      }
    }
    document.addEventListener('click', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('keydown', close)
    }
  }, [])

  return (
    <details className="sb-edition-menu" data-kind={kind} ref={details}>
      <summary>
        {/* What it is called says what the word on it is: "Version: 2.x". The words that are seen are
            that name's last part, or a language's code, which the name has in it too. */}
        <span className="sb-visually-hidden">{short ? `${name} (${short})` : name}</span>
        <span className="sb-edition-long" aria-hidden="true">
          {current}
        </span>
        {/* Shown in its place where the header is short of room: a language by its code. */}
        {short && (
          <span className="sb-edition-short" aria-hidden="true">
            {short}
          </span>
        )}
        <Icon name="chevron" size={14} />
      </summary>
      <ul>
        {choices.map((choice) => (
          <li key={choice.label}>
            <a href={choice.href} aria-current={choice.current ? 'true' : undefined} {...(choice.lang ? { lang: choice.lang, hrefLang: choice.lang } : {})}>
              {choice.label}
            </a>
          </li>
        ))}
      </ul>
    </details>
  )
}

/** The versions of the docs. Nothing on a site that has one. */
export function VersionMenu() {
  const { version, editions } = usePlace()
  const elsewhere = useElsewhere()
  const href = useHref()
  const text = useText()
  const versions = editions.versions ?? []
  if (versions.length < 2 || !version) return null
  return (
    <Menu
      kind="version"
      name={text('version.menu', { version: version.label })}
      current={version.label}
      choices={versions.map((other) => ({ label: other.label, href: href(elsewhere({ version: other }).path), current: other === version }))}
    />
  )
}

/** The languages of the site, each by its own name. Nothing on a site in one language. */
export function LanguageMenu() {
  const { language, editions } = usePlace()
  const elsewhere = useElsewhere()
  const href = useHref()
  const text = useText()
  const languages = editions.languages ?? []
  if (languages.length < 2 || !language) return null
  return (
    <Menu
      kind="language"
      name={text('language.menu', { language: language.label })}
      current={language.label}
      short={language.lang?.toUpperCase()}
      choices={languages.map((other) => ({ label: other.label, href: href(elsewhere({ language: other }).path), current: other === language, lang: other.lang }))}
    />
  )
}
