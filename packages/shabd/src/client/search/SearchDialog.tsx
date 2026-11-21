import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { passageTarget } from '../../shared/passage.js'
import { isUnspaced, spansToMark, wordSpans, type SearchHit } from '../../shared/search-core.js'
import { Icon } from '../app/icons.js'
import { useRouter } from '../app/router.js'
import { useSite, useStore } from '../app/store.js'
import { setUi } from '../app/ui.js'
import { useHref } from '../ui/Link.js'
import { openSearch, runSearch, searchStatus, type SearchResults, type SearchStatus } from './client.js'

/**
 * `text` with the words that were searched for marked. Words are matched
 * from their first letter. The words come with the result, because they are
 * not always the ones typed: a misspelt word is marked as what it was taken for.
 *
 * The text is cut into words the way the index is, so a word is found
 * whatever its case and accents, and in a script that has no spaces to find
 * a word by.
 */
function Highlighted({ text, words }: { text: string; words: string[] }) {
  const parts: ReactNode[] = []
  let at = 0
  spansToMark(wordSpans(text), words).forEach((span, index) => {
    // Of a word that is still being typed, only what was typed is marked. That takes counting letters off,
    // which works where the word as it is written and as it is indexed are the same length. It is not done in
    // a script without spaces, where a word of the text can start with a whole word of the query.
    const typed = Math.max(...words.filter((word) => span.token.startsWith(word)).map((word) => word.length))
    const written = span.end - span.start
    const counted = written === span.token.length && !isUnspaced(span.token)
    const end = span.start + (counted ? Math.min(typed, written) : written)
    parts.push(text.slice(at, span.start), <mark key={index}>{text.slice(span.start, end)}</mark>)
    at = end
  })
  return (
    <>
      {parts}
      {text.slice(at)}
    </>
  )
}

function statusLine(status: SearchStatus, semanticEnabled: boolean): string {
  if (status.index === 'error') return `Search is unavailable. ${status.error ?? ''}`.trim()
  if (status.index === 'loading') return 'Loading the search index…'
  if (!semanticEnabled) return 'Searching by keyword.'
  switch (status.model.state) {
    case 'loading':
      return `Searching by keyword. Loading the language model for search by meaning: ${status.model.progress}%`
    case 'ready':
      return 'Searching by keyword and by meaning. Your query stays on this device.'
    default:
      return 'Searching by keyword.'
  }
}

export default function SearchDialog() {
  const { features } = useSite()
  const status = useStore(searchStatus)
  const router = useRouter()
  const href = useHref()
  const dialog = useRef<HTMLDialogElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const listId = useId()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResults | null>(null)
  const [active, setActive] = useState(0)

  const close = () => setUi({ searchOpen: false })

  useEffect(() => {
    // What had the focus before search opened gets it back when search closes. A browser does that for
    // a dialog that is closed; this one is taken off the page, and the focus was left on nothing.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    openSearch()
    // The page a result leads to needs this the moment it is shown, so it is fetched while the reader types.
    void import('./passage.js').catch(() => {})
    const element = dialog.current
    if (element && !element.open) element.showModal()
    return () => {
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  const modelReady = status.model.state === 'ready'
  useEffect(() => {
    const text = query.trim()
    if (!text) {
      setResults(null)
      return
    }
    if (status.index !== 'ready') return
    let current = true
    // Embedding a query takes a few milliseconds; a short pause avoids doing it for every keystroke.
    const timer = window.setTimeout(
      () =>
        void runSearch(text, features.search.maxResults).then((next) => {
          if (!current) return
          setResults(next)
          setActive(0)
        }),
      modelReady ? 80 : 0,
    )
    return () => {
      current = false
      window.clearTimeout(timer)
    }
    // Re-run when the model becomes ready, so keyword results upgrade in place.
  }, [query, status.index, modelReady, features.search.maxResults])

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const hits = results?.hits ?? []
  const target = (hit: SearchHit) => href(hit.doc.path) + (hit.doc.anchor ? `#${hit.doc.anchor}` : '')

  /** Go to a result. The address is its section's; the passage and the words to mark travel beside it. */
  const go = (hit: SearchHit) => {
    close()
    void router.navigate(target(hit), { passage: passageTarget(hit.doc.text, hit.marks) })
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      // Some browsers use Escape to clear a field first. Here it always closes search.
      event.preventDefault()
      close()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (hits.length === 0) return
      setActive((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length)
    } else if (event.key === 'Enter') {
      const hit = hits[active]
      if (!hit) return
      event.preventDefault()
      go(hit)
    }
  }

  const onHitClick = (event: React.MouseEvent, hit: SearchHit) => {
    // A click that asks for a new tab or window is the browser's to follow, to the section's heading.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      close()
      return
    }
    event.preventDefault()
    go(hit)
  }

  return (
    <dialog
      ref={dialog}
      className="sb-search"
      data-store={status.store}
      data-persistent={status.persistent ? '' : undefined}
      aria-label="Search the documentation"
      onClose={close}
      // The dialog element itself is only hit by clicks on the backdrop around its content.
      onClick={(event) => event.target === dialog.current && close()}
    >
      <div className="sb-search-panel">
        <label className="sb-search-field">
          <Icon name="search" size={20} />
          <input
            type="text"
            inputMode="search"
            enterKeyHint="search"
            role="combobox"
            aria-expanded={hits.length > 0}
            aria-controls={listId}
            aria-activedescendant={hits[active] ? `${listId}-${active}` : undefined}
            aria-autocomplete="list"
            // Named here. The label around the field also holds the button that closes search, and
            // without a name of its own the field was read out as that button.
            aria-label="Search the docs"
            placeholder="Search the docs"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
          {/* The name starts with what the button shows, for a reader who says what they see to press it. */}
          <button type="button" className="sb-kbd" onClick={close} aria-label="Esc: close search">
            esc
          </button>
        </label>

        <ul className="sb-search-results" id={listId} role="listbox" ref={list} aria-label="Results">
          {hits.map((hit, index) => (
            <li key={`${hit.doc.path}#${hit.doc.anchor}:${index}`} role="presentation">
              <a
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                className="sb-search-hit"
                href={target(hit)}
                onClick={(event) => onHitClick(event, hit)}
                onMouseMove={() => setActive(index)}
              >
                <span className="sb-search-hit-where">
                  <span>{hit.doc.title}</span>
                  {hit.doc.heading && (
                    <>
                      <Icon name="chevron" size={12} />
                      <span>{hit.doc.heading}</span>
                    </>
                  )}
                  {hit.matched.meaning && !hit.matched.keywords && (
                    <span className="sb-search-hit-related" title="Found by meaning: it does not contain your words">
                      <Icon name="sparkle" size={13} />
                      Related
                    </span>
                  )}
                </span>
                {hit.snippet && (
                  <span className="sb-search-hit-snippet">
                    <Highlighted text={hit.snippet} words={hit.marks} />
                  </span>
                )}
              </a>
            </li>
          ))}
        </ul>

        {query.trim() && results && hits.length === 0 && (
          <p className="sb-search-empty">
            Nothing matches “{results.query}”. Try other words, or fewer of them.
          </p>
        )}

        {/* How many results there are, said aloud as they change: the list itself is silent until it is entered. */}
        <p className="sb-visually-hidden" aria-live="polite">
          {query.trim() && results ? (hits.length === 1 ? '1 result' : `${hits.length} results`) : ''}
        </p>

        <p className="sb-search-status" role="status">
          {statusLine(status, features.search.semantic)}
        </p>
      </div>
    </dialog>
  )
}
