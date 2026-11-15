import { useEffect, useId, useRef, useState } from 'react'
import { queryTerms, type SearchHit } from '../../shared/search-core.js'
import { Icon } from '../app/icons.js'
import { useRouter } from '../app/router.js'
import { useSite, useStore } from '../app/store.js'
import { setUi } from '../app/ui.js'
import { useHref } from '../ui/Link.js'
import { openSearch, runSearch, searchStatus, type SearchResults, type SearchStatus } from './client.js'

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * `text` with the words of the query marked. Words are matched from their
 * first letter, and very short ones ("a", "to") are skipped: marking them
 * lights up half the excerpt and says nothing about why it matched.
 */
function Highlighted({ text, query }: { text: string; query: string }) {
  const words = queryTerms(query).filter((word) => word.length > 2)
  if (words.length === 0) return <>{text}</>
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(${words.map(escapeRegExp).join('|')})`, 'giu')
  const parts = text.split(pattern)
  return <>{parts.map((part, index) => (index % 2 === 1 ? <mark key={index}>{part}</mark> : part))}</>
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
    openSearch()
    const element = dialog.current
    if (element && !element.open) element.showModal()
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
      close()
      void router.navigate(target(hit))
    }
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
            placeholder="Search the docs"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <button type="button" className="sb-kbd" onClick={close} aria-label="Close search">
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
                onClick={close}
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
                    <Highlighted text={hit.snippet} query={results?.query ?? ''} />
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

        <p className="sb-search-status" role="status">
          {statusLine(status, features.search.semantic)}
        </p>
      </div>
    </dialog>
  )
}
