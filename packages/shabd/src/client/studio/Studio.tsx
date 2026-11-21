/**
 * The Studio: edit the page you are looking at, beside the page itself.
 *
 * There is no separate preview. Each pause in typing writes the Markdown file
 * (through the File System Access API when a folder is connected, otherwise
 * through the dev server), the dev server hot-updates the page, and the real
 * page re-renders next to the editor.
 *
 * Loaded only in `shabd dev`, and only when the Studio is opened.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { onPageUpdate } from '../app/hmr.js'
import { Icon } from '../app/icons.js'
import { usePage } from '../app/router.js'
import { useSite } from '../app/store.js'
import { setUi } from '../app/ui.js'
import { IMAGE_BYTES_LIMIT, IMAGE_TOO_LARGE, imageMarkdown } from '../../shared/image-file.js'
import { CodeEditor, type EditorHandle, type EditorInsertion } from '../editor/CodeEditor.js'
import { endsLinesWithCrLf, toCrLf, toLineFeeds, type Replacement } from '../editor/text.js'
import {
  ConflictError,
  connectFolder,
  connectServer,
  folderAccessSupported,
  restoreFolder,
  type SourceFile,
  type StudioBackend,
} from './backends.js'
import { SharedDraft, type Link } from './draft.js'
import { PageActions } from './PageActions.js'
import { PeerChannel, PeerError, peerId, tabChannel, type PeerState, type StudioChannel } from './sync.js'

/** How long typing must pause before the file is written. */
const SAVE_DELAY = 250

type Status =
  | { kind: 'loading' }
  | { kind: 'idle' }
  | { kind: 'unsaved' }
  | { kind: 'saving' }
  | { kind: 'saved'; updatedIn?: number }
  | { kind: 'conflict'; current: SourceFile }
  | { kind: 'error'; message: string }

function describe(status: Status): string {
  switch (status.kind) {
    case 'loading':
      return 'Opening the file…'
    case 'idle':
      return 'Changes are saved as you type.'
    case 'unsaved':
      return 'Unsaved changes'
    case 'saving':
      return 'Saving…'
    case 'saved':
      return status.updatedIn === undefined
        ? 'Saved.'
        : `Saved. The page updated ${Math.round(status.updatedIn)} ms later.`
    case 'conflict':
      return 'This file was changed outside the Studio.'
    case 'error':
      return status.message
  }
}

export default function Studio() {
  const { features, contentDir, pagesInDev: pages = {} } = useSite()
  const { id, path, title } = usePage()
  /** A page made from an OpenAPI description is written again whenever the description changes, so it is not edited here. */
  const generated = pages[path]?.generated === true
  const [backend, setBackend] = useState<StudioBackend | null>(null)
  const [text, setText] = useState('')
  /** The page whose text is in the editor. It trails `id` for as long as the next page's file takes to read. */
  const [shown, setShown] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>({ kind: 'loading' })

  /** State the save loop needs without re-subscribing effects on every keystroke. */
  const live = useRef({ text: '', saved: '', version: '', crlf: false, saveStarted: 0, timer: 0 })
  /** The page's text as the editors that are connected share it (draft.ts), and the ways to those editors. */
  const draft = useRef<SharedDraft | null>(null)
  const links = useRef(new Map<Link, StudioChannel>())
  /** The editor on screen, for changes that arrive from other editors. */
  const editor = useRef<EditorHandle | null>(null)
  const setEditor = useCallback((handle: EditorHandle | null) => {
    editor.current = handle
  }, [])
  /** The save below, for what is set up before it is. */
  const saver = useRef<() => void>(() => {})

  /* ── backend ── */

  useEffect(() => {
    let current = true
    void (async () => {
      try {
        const chosen = (await restoreFolder()) ?? (await connectServer())
        if (current) setBackend(chosen)
      } catch (error) {
        if (current) setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
      }
    })()
    return () => {
      current = false
    }
  }, [])

  /** The text is now `next`, typed here or by someone else: show it, and save it once typing pauses. */
  const taken = useCallback((next: string) => {
    const state = live.current
    state.text = next
    setText(next)
    setStatus((current) => (current.kind === 'conflict' ? current : { kind: 'unsaved' }))
    window.clearTimeout(state.timer)
    state.timer = window.setTimeout(() => saver.current(), SAVE_DELAY)
  }, [])

  /** Put a file that has been read into the editor, and begin the draft that is shared with other editors. */
  const show = useCallback(
    (page: string, file: SourceFile) => {
      const state = live.current
      window.clearTimeout(state.timer)
      // The draft holds the text with line feeds between its lines, as the editor does. What the file's
      // lines end in is this machine's own business.
      const source = toLineFeeds(file.source)
      const held = draft.current?.page === page ? draft.current : undefined
      if (held && file.draft === held.meta.draft && held.text !== source) {
        // The file was read again, and what it holds was saved from the draft that is held here, by another
        // editor that shares it. Where the two differ, a change is still on its way from one editor to
        // the other. The draft has the last word, and is saved over the file once it differs from it.
        Object.assign(state, { saved: file.source, version: file.version })
        if (state.text !== state.saved) state.timer = window.setTimeout(() => saver.current(), SAVE_DELAY)
        return
      }
      Object.assign(state, { text: file.source, saved: file.source, version: file.version, crlf: endsLinesWithCrLf(file.source) })
      setText(file.source)
      setShown(page)
      setStatus({ kind: 'idle' })
      // The file was read again and says what the editors share already: there is nothing to tell them.
      if (held && held.text === source) return
      const begun: SharedDraft = new SharedDraft({
        page,
        source,
        peer: peerId,
        // The same page, read again because it changed on disk: this is what the others are to take now.
        replacing: held,
        send(message, where) {
          for (const [link, channel] of links.current) {
            if ('only' in where ? link === where.only : link !== where.except) channel.send(message)
          }
        },
        changed(changes, shared) {
          // The Studio has gone on to another page, or read this one again.
          if (draft.current !== begun) return
          // Put into the editor at once, so that the next thing typed is typed into the text as it now is.
          // An editor that is not on screen yet, or that holds another text, is given the whole text below.
          editor.current?.apply(changes)
          taken(live.current.crlf ? toCrLf(shared) : shared)
        },
        unsaved: () => live.current.text !== live.current.saved,
      })
      draft.current = begun
      begun.greet()
    },
    [taken],
  )

  useEffect(() => {
    if (!backend || !id) return
    setStatus({ kind: 'loading' })
    // A file that arrives after the Studio has moved on to another page is dropped: it is not that page's text.
    let current = true
    backend.read(id).then(
      (file) => {
        if (current) show(id, file)
      },
      (error: unknown) => {
        if (current) setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => {
      current = false
      window.clearTimeout(live.current.timer)
    }
  }, [backend, id, show])

  /* ── saving ── */

  const save = useCallback(async () => {
    const state = live.current
    window.clearTimeout(state.timer)
    if (!backend || !id || state.text === state.saved) return
    const writing = state.text
    state.saveStarted = performance.now()
    setStatus({ kind: 'saving' })
    try {
      // The draft is named, so that editors that share it and save to the same file do not take each
      // other's saves for a change from outside.
      const file = await backend.write(id, writing, state.version, draft.current?.page === id ? draft.current.meta.draft : undefined)
      state.version = file.version
      state.saved = writing
      // More was typed while the write was in flight: go again.
      if (state.text !== writing) state.timer = window.setTimeout(() => void save(), SAVE_DELAY)
      else {
        setStatus({ kind: 'saved' })
        // An editor that waited for this before it would hand over a newer text is asked again.
        draft.current?.settled()
      }
    } catch (error) {
      if (error instanceof ConflictError) setStatus({ kind: 'conflict', current: error.current })
      else setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }, [backend, id])

  useEffect(() => {
    saver.current = () => void save()
  }, [save])

  /** Typed in the editor here. The other editors are told the change, as the change it was. */
  const edit = useCallback(
    (next: string, changes?: readonly Replacement[]) => {
      draft.current?.typed(changes, toLineFeeds(next))
      taken(next)
    },
    [taken],
  )

  /* ── for making, renaming and deleting pages, which must not start with a draft on its way ── */

  const settle = useCallback(async () => {
    await save()
    return live.current.text === live.current.saved
  }, [save])

  /** A page that is about to be deleted is not saved first. */
  const discard = useCallback(() => window.clearTimeout(live.current.timer), [])

  const version = useCallback(() => live.current.version, [])

  /**
   * True while a page is being made, renamed or deleted. The editor is not typed into then: the page stays on
   * screen until the Studio has gone to the next one, and what was typed in that time would be lost with it.
   */
  const [acting, setActing] = useState(false)

  /* ── an image pasted or dropped into the editor ── */

  const [imageProblem, setImageProblem] = useState('')

  const addImages = useCallback(
    async (files: File[]): Promise<EditorInsertion | undefined> => {
      if (!backend || !id) return undefined
      const links: string[] = []
      let problem = ''
      for (const file of files) {
        try {
          // Said here as well as where the image is saved, so that one that is too large is not read first.
          if (file.size > IMAGE_BYTES_LIMIT) throw new Error(IMAGE_TOO_LARGE)
          links.push(imageMarkdown(await backend.addImage(id, file.name, new Uint8Array(await file.arrayBuffer()))))
        } catch (error) {
          problem = error instanceof Error ? error.message : String(error)
        }
      }
      setImageProblem(problem)
      // The cursor is left between the brackets of the first: the words for someone who cannot see it are still to be written.
      return links.length > 0 ? { text: links.join('\n'), cursor: 2 } : undefined
    },
    [backend, id],
  )

  useEffect(() => setImageProblem(''), [id])

  /* ── the page hot-updated ── */

  useEffect(() => {
    if (!id || !backend) return
    let watching = true
    const stop = onPageUpdate((updated) => {
      if (updated !== id) return
      const state = live.current
      const sinceSave = performance.now() - state.saveStarted
      if (state.saveStarted && sinceSave < 2000) {
        // Our own save came back as a rendered page.
        setStatus((current) => (current.kind === 'saved' ? { kind: 'saved', updatedIn: sinceSave } : current))
        state.saveStarted = 0
      } else if (state.text === state.saved) {
        // Someone else changed the file (an editor, git). Nothing unsaved here, so follow it.
        const before = state.text
        backend.read(id).then(
          (file) => {
            // Unless the text here changed while the file was read: typed in, or changed by another editor.
            // What was read is out of date then, and the save that follows says so if it matters.
            if (watching && live.current.text === before && live.current.saved === before) show(id, file)
          },
          () => {},
        )
      }
    })
    return () => {
      watching = false
      stop()
    }
  }, [id, backend, show])

  /* ── while typing, a half-written line of frontmatter is an "error" for a moment ── */

  useEffect(() => {
    const removeOverlays = () => document.querySelectorAll('vite-error-overlay').forEach((overlay) => overlay.remove())
    const observer = new MutationObserver(removeOverlays)
    observer.observe(document.body, { childList: true })
    const onError = (payload: { err: { message: string } }) =>
      setStatus({ kind: 'error', message: payload.err.message.split('\n')[0] ?? 'The page could not be compiled.' })
    import.meta.hot?.on('vite:error', onError)
    document.documentElement.dataset.studio = ''
    return () => {
      observer.disconnect()
      import.meta.hot?.off('vite:error', onError)
      delete document.documentElement.dataset.studio
    }
  }, [])

  /* ── draft sync ── */

  /*
   * Every editor saves the text it holds, whoever typed it. Between tabs of one browser that is the same
   * file, and the dev server writes it once: a save that says what is on disk already writes nothing.
   */
  useEffect(() => {
    if (features.studio.sync === 'off') return
    const tabs = tabChannel('shabd-studio')
    if (!tabs) return
    links.current.set('tabs', tabs)
    const unsubscribe = tabs.subscribe((message) => draft.current?.receive(message, 'tabs'))
    // A page that is open already says what it holds to the tabs that are there.
    draft.current?.greet('tabs')
    return () => {
      unsubscribe()
      tabs.close()
      links.current.delete('tabs')
    }
  }, [features.studio.sync])

  /* ── view ── */

  const connect = async () => {
    if (!id) return
    try {
      setBackend(await connectFolder(id))
    } catch (error) {
      // Closing the folder picker is not an error worth reporting.
      if ((error as DOMException).name !== 'AbortError') {
        setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
      }
    }
  }

  const resolveConflict = (choice: 'disk' | 'mine') => {
    if (status.kind !== 'conflict') return
    const state = live.current
    if (choice === 'disk') {
      // As when the file is read again for any other reason: the editors that share the draft take the file's text.
      if (id) show(id, status.current)
    } else {
      state.version = status.current.version
      state.saved = status.current.source
      setStatus({ kind: 'unsaved' })
      void save()
    }
  }

  return (
    <aside className="sb-studio" aria-label="Page editor">
      <header className="sb-studio-header">
        <div className="sb-studio-file">
          <strong>{id ? `${contentDir}/${id}` : 'No page'}</strong>
          <span>{backend?.label ?? 'Connecting…'}</span>
        </div>
        {backend?.kind === 'server' && folderAccessSupported() && id && (
          <button type="button" className="sb-studio-action" onClick={connect}>
            <Icon name="folder" size={15} />
            Connect a folder
          </button>
        )}
        <button type="button" className="sb-icon-button" onClick={() => setUi({ studioOpen: false })} aria-label="Close the editor">
          <Icon name="close" />
        </button>
      </header>

      {backend && (
        <PageActions backend={backend} page={id && !generated ? { id, path } : null} settle={settle} discard={discard} version={version} acting={setActing} />
      )}

      {generated ? (
        <p className="sb-studio-empty">This page is made from an OpenAPI description. Change the description, and the page follows.</p>
      ) : id ? (
        // The key makes each page a document of its own: a new page starts with nothing to undo.
        <CodeEditor
          key={shown ?? ''}
          className="sb-studio-editor"
          language="markdown"
          label={`Markdown source of ${title}`}
          value={text}
          readOnly={status.kind === 'loading' || acting}
          onChange={edit}
          handle={setEditor}
          onSave={() => void save()}
          onFiles={addImages}
        />
      ) : (
        <p className="sb-studio-empty">There is no page at this address to edit.</p>
      )}

      {features.studio.sync === 'peers' && id && (
        <PeerPanel
          onChannel={(peer) => {
            links.current.set('peer', peer)
            const stopMessages = peer.subscribe((message) => draft.current?.receive(message, 'peer'))
            // Once the two are connected, each says what it holds of the page it is on.
            const stopState = peer.onState((state) => {
              if (state === 'connected') draft.current?.greet('peer')
            })
            return () => {
              stopMessages()
              stopState()
              if (links.current.get('peer') === peer) links.current.delete('peer')
            }
          }}
        />
      )}

      <footer className="sb-studio-footer" data-state={status.kind}>
        {imageProblem && (
          <p className="sb-studio-problem" role="alert">
            {imageProblem}
          </p>
        )}
        <p role="status">{describe(status)}</p>
        {status.kind === 'conflict' && (
          <p className="sb-studio-choices">
            <button type="button" className="sb-studio-action" onClick={() => resolveConflict('disk')}>
              Load the file from disk
            </button>
            <button type="button" className="sb-studio-action" onClick={() => resolveConflict('mine')}>
              Keep my version
            </button>
          </p>
        )}
      </footer>
    </aside>
  )
}

/**
 * Pair editing over WebRTC. Signalling is two pasted codes: an invite from
 * the host and a reply from the guest. After that the browsers talk directly.
 */
function PeerPanel({ onChannel }: { onChannel: (channel: PeerChannel) => () => void }) {
  const [peer, setPeer] = useState<PeerChannel | null>(null)
  const [state, setState] = useState<PeerState>('idle')
  const [role, setRole] = useState<'host' | 'guest' | null>(null)
  const [code, setCode] = useState('')
  const [pasted, setPasted] = useState('')
  const [problem, setProblem] = useState('')

  useEffect(() => {
    if (!peer) return
    const stopState = peer.onState(setState)
    const stopMessages = onChannel(peer)
    return () => {
      stopState()
      stopMessages()
      peer.close()
    }
    // `onChannel` is recreated each render; the channel itself is what this effect follows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peer])

  const startAgain = () => {
    setPeer(null)
    setState('idle')
    setRole(null)
    setCode('')
    setPasted('')
    setProblem('')
  }

  const attempt = async (step: () => Promise<void>) => {
    setProblem('')
    try {
      await step()
    } catch (error) {
      setProblem(
        error instanceof PeerError ? error.message : 'That code could not be read. Copy the whole code and try again.',
      )
    }
  }

  const host = () =>
    attempt(async () => {
      const created = new PeerChannel()
      setPeer(created)
      setRole('host')
      setCode(await created.invite())
    })

  const submit = () =>
    attempt(async () => {
      if (role === 'host' && peer) {
        await peer.accept(pasted)
      } else {
        const created = new PeerChannel()
        setPeer(created)
        setRole('guest')
        setCode(await created.join(pasted))
      }
      setPasted('')
    })

  const label = state === 'connected' ? 'Connected' : state === 'waiting' ? 'Waiting' : state === 'failed' ? 'Not connected' : ''

  return (
    <details className="sb-studio-peers">
      <summary>
        Edit together
        <span data-state={state}>{label}</span>
      </summary>
      {state === 'connected' ? (
        <p>You are connected. Edits to this page appear in both editors, and each one saves to its own files.</p>
      ) : state === 'failed' ? (
        <p role="alert">
          <span>The two browsers could not reach each other, or the connection dropped.</span>
          <button type="button" className="sb-studio-action" onClick={startAgain}>
            Start again
          </button>
        </p>
      ) : (
        <>
          {!role && (
            <p>
              <button type="button" className="sb-studio-action" onClick={host}>
                Create an invite
              </button>
              <span>or paste an invite someone sent you:</span>
            </p>
          )}
          {code && (
            <label>
              {role === 'host' ? 'Send this invite to the other person' : 'Send this reply back'}
              <textarea readOnly rows={3} value={code} onFocus={(event) => event.currentTarget.select()} />
            </label>
          )}
          {(role === 'host' || !code) && (
            <label>
              {role === 'host' ? 'Paste their reply' : 'Invite'}
              <textarea rows={3} value={pasted} onChange={(event) => setPasted(event.target.value)} />
            </label>
          )}
          {pasted.trim() && (
            <p>
              <button type="button" className="sb-studio-action" onClick={submit}>
                {role === 'host' ? 'Connect' : 'Join'}
              </button>
            </p>
          )}
          {problem && (
            <p role="alert">
              <span>{problem}</span>
              {role && (
                <button type="button" className="sb-studio-action" onClick={startAgain}>
                  Start again
                </button>
              )}
            </p>
          )}
        </>
      )}
    </details>
  )
}
