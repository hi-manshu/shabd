/**
 * Making, renaming and deleting pages from the Studio.
 *
 * Each of the three changes more than one file's worth of the site: a page
 * that moves leaves links behind that still point at its old address, and
 * one that is deleted leaves them pointing at nothing. The Studio does not
 * rewrite other pages. It asks the dev server what `shabd check` reports
 * before and after, and lists what is new, so that nothing is found out
 * later from a failed build.
 *
 * The dev server learns of a new or a missing file a moment after it is
 * written, and tells the page by hot update. Going to a page waits for that:
 * an address the page does not know yet would load the whole document again.
 */
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { leftBehindProblem, pagePathProblem, pageRoute } from '../../shared/page-path.js'
import { isPageFile, parentDir, titleize } from '../../shared/paths.js'
import { flattenSidebar } from '../../shared/sidebar.js'
import type { PageMeta, SiteData } from '../../shared/types.js'
import { useRouter } from '../app/router.js'
import { routeStore, siteStore, useSite } from '../app/store.js'
import { useHref } from '../ui/Link.js'
import { addRedirect, checkSite, leftBehind, redirectOffer, type CheckProblem, type RedirectOffer, type StudioBackend } from './backends.js'

interface PageActionsProps {
  backend: StudioBackend
  /** The page on screen. Null at an address that has none: a page can still be made from there. */
  page: { id: string; path: string } | null
  /** Write what has been typed and not saved yet. False when the file does not hold it afterwards. */
  settle: () => Promise<boolean>
  /** Stop the save that a pause in typing has on its way. */
  discard: () => void
  /** The page's file as the Studio last read it: what a delete is allowed to remove. */
  version: () => string
  /** Told when one of the three starts and when it ends. What is typed in between would belong to a file on its way out. */
  acting: (now: boolean) => void
}

type Form = 'create' | 'rename' | 'delete'

/** What an action did, and what else it changed. */
interface Outcome {
  summary: string
  /** A page whose address changed: where it was and where it is. */
  moved?: { from: string; to: string }
  /** What `shabd check` reports now and did not before. Undefined while it is asked, null when it could not be. */
  problems?: CheckProblem[] | null
  /** Whether a redirect from the old address can be added to the config. Undefined while that is asked. */
  redirect?: RedirectOffer | 'added'
}

const UNSAVED = 'This page has changes that are not saved yet. Deal with those first.'

/** How long the dev server is given to notice a file. It takes a tenth of a second or so. */
const NOTICE_MS = 10_000

/** What was typed, as a path in the content folder: `/guide/new page` is `guide/new page.md`. */
export function typedPath(typed: string): string {
  const path = typed.trim().replace(/^\.?\/+/, '')
  return path === '' || path.endsWith('/') || isPageFile(path) ? path : `${path}.md`
}

/** What stands in the way of a page at `id`. `moving` is the page being renamed, which may keep its own address. */
function placeProblem(id: string, pages: SiteData['pages'], moving?: string): string | undefined {
  // A folder and no file yet: said more plainly than the general rule would.
  if (id.endsWith('/')) return 'Give the file a name, such as guide/new-page.md.'
  const problem = pagePathProblem(id)
  if (problem) return problem
  if (id === moving) return 'That is the name the page has.'
  const other = pages[pageRoute(id)]
  // Two files with one address cannot both be served.
  return other && other.id !== moving ? `${other.id} already has the address ${other.path}.` : undefined
}

/** What a new page starts with: a title made from its file name, for the author to change. */
function starter(id: string): string {
  const name = id.slice(id.lastIndexOf('/') + 1).replace(/\.mdx?$/i, '')
  const subject = name.toLowerCase() === 'index' ? parentDir(id).split('/').pop() || 'Home' : name
  const title = titleize(subject)
  // Left bare only where YAML cannot read it as a number, a boolean or the start of a comment.
  const written = /^[A-Za-z][A-Za-z0-9 ]*$/.test(title) && !/^(?:true|false|yes|no|on|off|null)$/i.test(title) ? title : JSON.stringify(title)
  return `---\ntitle: ${written}\n---\n\n`
}

/** Where to go when the page on screen is deleted: the page before it in the sidebar, or else the one after, or else the home page. */
function neighbour(site: SiteData, path: string): string | undefined {
  const order = flattenSidebar(site.sidebar).map((entry) => entry.path)
  const at = order.indexOf(path)
  const beside = at === -1 ? undefined : (order[at - 1] ?? order[at + 1])
  if (beside !== undefined) return beside
  return path !== '/' && site.pages['/'] ? '/' : Object.keys(site.pages).find((other) => other !== path)
}

/**
 * Wait until the site the browser holds knows a page, or has forgotten it.
 * Resolves with the page when it is there.
 */
function known(id: string, present: boolean): Promise<PageMeta | undefined> {
  const find = () => {
    const meta = Object.values(siteStore.get().pages).find((page) => page.id === id)
    // A page can be gone to only once its route has arrived as well.
    return meta && routeStore.get()[meta.path] ? meta : undefined
  }
  return new Promise((resolve, reject) => {
    const stop = () => {
      window.clearTimeout(timer)
      for (const unsubscribe of subscriptions) unsubscribe()
    }
    const look = () => {
      const meta = find()
      if ((meta !== undefined) !== present) return
      stop()
      resolve(meta)
    }
    const timer = window.setTimeout(() => {
      stop()
      reject(new Error('The file was changed, but the dev server has not noticed. Load the page again to see where things stand.'))
    }, NOTICE_MS)
    const subscriptions = [siteStore.subscribe(look), routeStore.subscribe(look)]
    look()
  })
}

/** The problems in `now` that were not in `before`. One reported twice counts twice: two links to one page are two broken links. */
function newProblems(before: CheckProblem[], now: CheckProblem[]): CheckProblem[] {
  const key = (problem: CheckProblem) => [problem.level, problem.file, problem.line ?? '', problem.message].join('\n')
  const had = new Map<string, number>()
  for (const problem of before) had.set(key(problem), (had.get(key(problem)) ?? 0) + 1)
  return now.filter((problem) => {
    const left = had.get(key(problem)) ?? 0
    if (left > 0) had.set(key(problem), left - 1)
    return left === 0
  })
}

export function PageActions({ backend, page, settle, discard, version, acting }: PageActionsProps) {
  const site = useSite()
  const { navigate, hold } = useRouter()
  const href = useHref()
  const [form, setForm] = useState<Form | null>(null)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const field = useRef<HTMLInputElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const said = useRef<HTMLDivElement>(null)
  const openers = useRef<Partial<Record<Form, HTMLButtonElement | null>>>({})
  /** What `shabd check` said before the last action, for telling what is new after it. Null when it could not be asked. */
  const before = useRef<CheckProblem[] | null>(null)
  /** Counts actions, so that an answer about an earlier one is not shown under a later one. */
  const turn = useRef(0)
  const fieldId = useId()
  const hintId = useId()
  const inContent = (id: string) => `${site.contentDir}/${id}`

  useEffect(() => {
    if (form === 'delete') cancel.current?.focus()
    else if (form) field.current?.focus()
  }, [form])

  // The form that had focus is gone once its work is done. Focus goes to what was said about it, which is what comes next.
  const done = outcome?.summary
  useEffect(() => {
    if (done) said.current?.focus()
  }, [done])

  const open = (which: Form) => {
    setProblem('')
    setTyped(which === 'rename' ? (page?.id ?? '') : page && parentDir(page.id) ? `${parentDir(page.id)}/` : '')
    setForm(form === which ? null : which)
    // The first answer takes the longest, because every page is compiled for it. Asking now has it ready sooner.
    void checkSite().catch(() => {})
  }

  const close = () => {
    const opener = form && openers.current[form]
    setForm(null)
    setProblem('')
    opener?.focus()
  }

  /** Ask what `shabd check` reports now, and show what was not there before the action. */
  const report = async (mine: number) => {
    const was = before.current
    const now = was && (await checkSite().catch(() => null))
    if (turn.current !== mine) return
    setOutcome((current) => current && { ...current, problems: was && now ? newProblems(was, now) : null })
  }

  const run = async (work: () => Promise<Outcome>) => {
    const mine = ++turn.current
    setBusy(true)
    acting(true)
    setProblem('')
    try {
      const result = await work()
      setOutcome(result)
      setForm(null)
      void report(mine)
      const { moved } = result
      if (moved) {
        void redirectOffer(moved.from, moved.to).then(
          (offer) => turn.current === mine && setOutcome((current) => current && { ...current, redirect: offer }),
          // Nothing is offered when the dev server cannot say.
          () => {},
        )
      }
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
      acting(false)
    }
  }

  const create = () =>
    run(async () => {
      const id = typedPath(typed)
      const invalid = placeProblem(id, siteStore.get().pages)
      if (invalid) throw new Error(invalid)
      if (!(await settle())) throw new Error(UNSAVED)
      before.current = await checkSite().catch(() => null)
      await backend.create(id, starter(id))
      const made = (await known(id, true))!
      await navigate(href(made.path), { keepFocus: true })
      return { summary: `Made ${inContent(id)}. Its address is ${made.path}.` }
    })

  const rename = () =>
    run(async () => {
      if (!page) throw new Error('There is no page here to rename.')
      const to = typedPath(typed)
      const invalid = placeProblem(to, siteStore.get().pages, page.id)
      if (invalid) throw new Error(invalid)
      if (!(await settle())) throw new Error(UNSAVED)
      // A page that could not be shown where it went could not be opened here again to be mended.
      const lost = await leftBehind(page.id, to)
      if (lost.length > 0) throw new Error(leftBehindProblem(to, lost))
      // What was wrong inside the page before is still wrong in it: counted under its new name, it is not news.
      const renamed = (found: CheckProblem) => (found.file === inContent(page.id) ? { ...found, file: inContent(to) } : found)
      before.current = (await checkSite().catch(() => null))?.map(renamed) ?? null
      // The page stays on screen until the Studio has gone to where it went. It is not "not found" in between.
      const release = hold()
      let moved: PageMeta
      try {
        await backend.rename(page.id, to)
        moved = (await known(to, true))!
        await navigate(href(moved.path), { replace: true, keepFocus: true })
      } finally {
        release()
      }
      if (moved.path === page.path) return { summary: `${inContent(page.id)} is now ${inContent(to)}. Its address is still ${page.path}.` }
      return {
        summary: `${inContent(page.id)} is now ${inContent(to)}. Its address changed from ${page.path} to ${moved.path}.`,
        moved: { from: page.path, to: moved.path },
      }
    })

  const remove = () =>
    run(async () => {
      if (!page) throw new Error('There is no page here to delete.')
      discard()
      before.current = await checkSite().catch(() => null)
      const next = neighbour(siteStore.get(), page.path)
      // As for a rename: the deleted page is on screen until the one beside it is.
      const release = hold()
      try {
        await backend.remove(page.id, version())
        await known(page.id, false)
        if (next !== undefined) await navigate(href(next), { replace: true, keepFocus: true })
      } finally {
        release()
      }
      return { summary: `Deleted ${inContent(page.id)}.` }
    })

  const redirect = async () => {
    const moved = outcome?.moved
    if (!moved) return
    const mine = turn.current
    setBusy(true)
    setProblem('')
    try {
      await addRedirect(moved.from, moved.to)
      // The links that were broken now work, by way of the redirect: ask again.
      setOutcome((current) => current && { ...current, redirect: 'added', problems: undefined })
      void report(mine)
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    void (form === 'create' ? create() : form === 'rename' ? rename() : remove())
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !busy) close()
  }

  const id = typedPath(typed)
  // Nothing is called wrong while only a folder has been typed: the name is still to come.
  const named = id !== '' && !id.endsWith('/')
  const invalid = form && form !== 'delete' && named ? placeProblem(id, site.pages, form === 'rename' ? page?.id : undefined) : undefined
  const address = pageRoute(id)

  const opener = (which: Form, label: string) => (
    <button
      type="button"
      className="sb-studio-action"
      aria-expanded={form === which}
      disabled={busy}
      ref={(element) => {
        openers.current[which] = element
      }}
      onClick={() => open(which)}
    >
      {label}
    </button>
  )

  const choices = (label: string) => (
    <p className="sb-studio-choices">
      <button type="submit" className="sb-studio-action" disabled={busy || invalid !== undefined}>
        {busy ? 'Working…' : label}
      </button>
      <button type="button" className="sb-studio-action" ref={cancel} disabled={busy} onClick={close}>
        Cancel
      </button>
    </p>
  )

  /** The field for a file's name, with what the name means, or what is wrong with it, under it. */
  const nameField = (label: string, meaning: ReactNode) => (
    <>
      <label htmlFor={fieldId}>{label}</label>
      <input
        id={fieldId}
        ref={field}
        value={typed}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        aria-invalid={invalid !== undefined}
        aria-describedby={hintId}
        onChange={(event) => setTyped(event.target.value)}
      />
      <p id={hintId} className="sb-studio-hint" data-invalid={invalid !== undefined ? '' : undefined}>
        {invalid ?? (named ? meaning : `A path in ${site.contentDir}/, such as guide/new-page.md.`)}
      </p>
    </>
  )

  return (
    <div className="sb-studio-pages">
      <div className="sb-studio-tools">
        {opener('create', 'New page')}
        {page && opener('rename', 'Rename')}
        {page && opener('delete', 'Delete')}
      </div>

      {form === 'create' && (
        <form className="sb-studio-form" aria-label="New page" onSubmit={submit} onKeyDown={onKeyDown}>
          {nameField(`File for the new page, in ${site.contentDir}/`, `Its address will be ${address}.`)}
          {choices('Create page')}
        </form>
      )}

      {form === 'rename' && page && (
        <form className="sb-studio-form" aria-label="Rename this page" onSubmit={submit} onKeyDown={onKeyDown}>
          {nameField(
            `New name for ${page.id}, in ${site.contentDir}/`,
            address === page.path
              ? `Its address stays ${page.path}.`
              : `Its address changes from ${page.path} to ${address}. Links to ${page.path} in other pages are not changed.`,
          )}
          {choices('Rename page')}
        </form>
      )}

      {form === 'delete' && page && (
        <form className="sb-studio-form" aria-label="Delete this page" onSubmit={submit} onKeyDown={onKeyDown}>
          <p>
            Delete {inContent(page.id)}? The file is removed from disk. Links to {page.path} in other pages are not changed.
          </p>
          {choices('Delete page')}
        </form>
      )}

      {problem && (
        <p className="sb-studio-problem" role="alert">
          {problem}
        </p>
      )}

      {outcome && !form && (
        <div className="sb-studio-outcome" role="status" tabIndex={-1} ref={said}>
          <p>{outcome.summary}</p>
          {outcome.problems === undefined ? (
            <p>
              Asking what <code>shabd check</code> makes of it…
            </p>
          ) : outcome.problems === null ? (
            <p>
              What <code>shabd check</code> reports could not be read here. Run it to see what else this changed.
            </p>
          ) : outcome.problems.length === 0 ? (
            <p>
              <code>shabd check</code> reports nothing it did not report before.
            </p>
          ) : (
            <>
              <p>
                <code>shabd check</code> now also reports:
              </p>
              <ul className="sb-studio-found">
                {outcome.problems.map((found, index) => (
                  <li key={index} data-level={found.level}>
                    <strong>{found.level}</strong> <span>{found.line === undefined ? found.file : `${found.file}:${found.line}`}</span>{' '}
                    {found.message}
                  </li>
                ))}
              </ul>
            </>
          )}
          {outcome.moved && outcome.redirect === 'added' && (
            <p>
              Readers of {outcome.moved.from} are now sent on to {outcome.moved.to}: the redirect is in shabd.config.yaml.
            </p>
          )}
          {outcome.moved && typeof outcome.redirect === 'object' && !outcome.redirect.possible && (
            <p>
              A redirect from {outcome.moved.from} was not offered. {outcome.redirect.reason} To add it yourself, put this under{' '}
              <code>redirects:</code> in shabd.config.yaml: <code>{outcome.redirect.line}</code>
            </p>
          )}
          <p className="sb-studio-choices">
            {outcome.moved && typeof outcome.redirect === 'object' && outcome.redirect.possible && (
              <button type="button" className="sb-studio-action" disabled={busy} onClick={() => void redirect()}>
                Add a redirect from {outcome.moved.from}
              </button>
            )}
            <button type="button" className="sb-studio-action" onClick={() => setOutcome(null)}>
              Dismiss
            </button>
          </p>
        </div>
      )}
    </div>
  )
}
