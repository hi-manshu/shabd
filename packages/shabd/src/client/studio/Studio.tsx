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
import { CodeEditor, type EditorInsertion } from '../editor/CodeEditor.js'
import {
  ConflictError,
  connectFolder,
  connectServer,
  folderAccessSupported,
  restoreFolder,
  type SourceFile,
  type StudioBackend,
} from './backends.js'
import { PageActions } from './PageActions.js'
import {
  isNewer,
  PeerChannel,
  PeerError,
  peerId,
  tabChannel,
  type DraftMessage,
  type PeerState,
  type StudioChannel,
} from './sync.js'

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
  const { features, contentDir, pages } = useSite()
  const { id, path, title } = usePage()
  /** A page made from an OpenAPI description is written again whenever the description changes, so it is not edited here. */
  const generated = pages[path]?.generated === true
  const [backend, setBackend] = useState<StudioBackend | null>(null)
  const [text, setText] = useState('')
  /** The page whose text is in the editor. It trails `id` for as long as the next page's file takes to read. */
  const [shown, setShown] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>({ kind: 'loading' })

  /** State the save loop needs without re-subscribing effects on every keystroke. */
  const live = useRef({
    text: '',
    saved: '',
    version: '',
    revision: 0,
    remotePeer: peerId,
    saveStarted: 0,
    /** How long the page took to follow the save in flight, when it followed before the save was confirmed. */
    updatedIn: undefined as number | undefined,
    timer: 0,
  })
  const channel = useRef<StudioChannel | null>(null)

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

  /** Put a file that has been read into the editor. */
  const show = useCallback((page: string, file: SourceFile) => {
    live.current = { ...live.current, text: file.source, saved: file.source, version: file.version }
    setText(file.source)
    setShown(page)
    setStatus({ kind: 'idle' })
  }, [])

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
    if (!backend || !id) return
    if (state.text === state.saved) {
      // Typed and taken back before it was written: nothing is unsaved after all.
      setStatus((current) => (current.kind === 'unsaved' ? { kind: 'idle' } : current))
      return
    }
    const writing = state.text
    state.saveStarted = performance.now()
    state.updatedIn = undefined
    setStatus({ kind: 'saving' })
    try {
      const file = await backend.write(id, writing, state.version)
      state.version = file.version
      state.saved = writing
      // More was typed while the write was in flight: go again.
      if (state.text !== writing) state.timer = window.setTimeout(() => void save(), SAVE_DELAY)
      // The page can follow the file before the write is confirmed: where the watcher is quick, it does.
      else setStatus(state.updatedIn === undefined ? { kind: 'saved' } : { kind: 'saved', updatedIn: state.updatedIn })
    } catch (error) {
      if (error instanceof ConflictError) setStatus({ kind: 'conflict', current: error.current })
      else setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }, [backend, id])

  const edit = useCallback(
    (next: string, origin: 'local' | 'remote' = 'local') => {
      const state = live.current
      state.text = next
      setText(next)
      setStatus((current) => (current.kind === 'conflict' ? current : { kind: 'unsaved' }))
      window.clearTimeout(state.timer)
      state.timer = window.setTimeout(() => void save(), SAVE_DELAY)
      if (origin === 'local' && id) {
        state.revision++
        state.remotePeer = peerId
        channel.current?.send({ type: 'draft', page: id, source: next, revision: state.revision, peer: peerId })
      }
    },
    [id, save],
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
        // Our own save came back as a rendered page. It is kept for a save that is still waiting for its answer.
        state.updatedIn = sinceSave
        setStatus((current) => (current.kind === 'saved' ? { kind: 'saved', updatedIn: sinceSave } : current))
        state.saveStarted = 0
      } else if (state.text === state.saved) {
        // Someone else changed the file (an editor, git). Nothing unsaved here, so follow it.
        backend.read(id).then(
          (file) => {
            if (watching) show(id, file)
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

  const receive = useCallback(
    (message: DraftMessage, from: 'tab' | 'peer') => {
      const state = live.current
      if (message.page !== id || !isNewer(message, state.revision, state.remotePeer)) return
      state.revision = message.revision
      state.remotePeer = message.peer
      if (message.source === state.text) return
      if (from === 'peer') {
        // Another machine: this editor saves the draft to its own copy of the file.
        edit(message.source, 'remote')
      } else {
        // Another tab on this machine shares the file and saves it. Show the
        // draft and leave the writing to the tab it was typed in.
        window.clearTimeout(state.timer)
        state.text = state.saved = message.source
        setText(message.source)
      }
    },
    [id, edit],
  )

  useEffect(() => {
    if (features.studio.sync === 'off') return
    const tabs = tabChannel('shabd-studio')
    if (!tabs) return
    channel.current = tabs
    const unsubscribe = tabs.subscribe((message) => receive(message, 'tab'))
    return () => {
      unsubscribe()
      tabs.close()
      if (channel.current === tabs) channel.current = null
    }
  }, [features.studio.sync, receive])

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
    state.version = status.current.version
    if (choice === 'disk') {
      state.text = state.saved = status.current.source
      setText(status.current.source)
      setStatus({ kind: 'idle' })
    } else {
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
          onSave={() => void save()}
          onFiles={addImages}
        />
      ) : (
        <p className="sb-studio-empty">There is no page at this address to edit.</p>
      )}

      {features.studio.sync === 'peers' && id && (
        <PeerPanel
          onChannel={(peer) => {
            channel.current = peer
            return peer.subscribe((message) => receive(message, 'peer'))
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
