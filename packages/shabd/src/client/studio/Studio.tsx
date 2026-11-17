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
import { withBase } from '../../shared/paths.js'
import { onPageUpdate } from '../app/hmr.js'
import { Icon } from '../app/icons.js'
import { usePage, useRouter } from '../app/router.js'
import { routeStore, siteStore, useSite } from '../app/store.js'
import { setUi } from '../app/ui.js'
import { Editor } from './Editor.js'
import {
  ConflictError,
  connectFolder,
  connectPages,
  connectServer,
  folderAccessSupported,
  restoreFolder,
  type SourceFile,
  type StudioBackend,
} from './backends.js'
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
  const { features, contentDir } = useSite()
  const { id, title } = usePage()
  const [backend, setBackend] = useState<StudioBackend | null>(null)
  const [text, setText] = useState('')
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

  const load = useCallback(async (from: StudioBackend, page: string) => {
    const file = await from.read(page)
    live.current = { ...live.current, text: file.source, saved: file.source, version: file.version }
    setText(file.source)
    setStatus({ kind: 'idle' })
  }, [])

  useEffect(() => {
    if (!backend || !id) return
    setStatus({ kind: 'loading' })
    let current = true
    load(backend, id).catch((error: unknown) => {
      if (current) setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
    })
    return () => {
      current = false
      window.clearTimeout(live.current.timer)
    }
  }, [backend, id, load])

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

  /* ── the page hot-updated ── */

  useEffect(() => {
    if (!id || !backend) return
    return onPageUpdate((updated) => {
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
        void load(backend, id).catch(() => {})
      }
    })
  }, [id, backend, load])

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

      <PageFiles id={id} contentDir={contentDir} unsaved={status.kind === 'unsaved' || status.kind === 'saving'} />

      {id ? (
        <Editor
          value={text}
          mdx={id.toLowerCase().endsWith('.mdx')}
          label={`Markdown source of ${title}`}
          disabled={status.kind === 'loading'}
          onChange={edit}
          onSave={() => void save()}
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

/** Wait for the page list to change after the dev server said it would. It follows within a few frames. */
async function untilRoute(path: string, exists: boolean): Promise<void> {
  for (let waited = 0; waited < 4000; waited += 50) {
    if (Boolean(routeStore.get()[path] && siteStore.get().pages[path]) === exists) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

/**
 * New page, rename, delete. Each asks for what it needs in the same strip,
 * does it through the dev server, and then goes where the page now is.
 */
function PageFiles({ id, contentDir, unsaved }: { id: string | null; contentDir: string; unsaved: boolean }) {
  const { path, navigate } = useRouter()
  /** Go to a page of this site. The dev server names a page by its route; the address bar has the site's base before it. */
  const go = (route: string, options?: { replace?: boolean }) => navigate(withBase(siteStore.get().site.base, route), options)
  const [mode, setMode] = useState<'new' | 'rename' | 'delete' | null>(null)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const [notice, setNotice] = useState('')

  const open = (next: 'new' | 'rename' | 'delete') => {
    const folder = id?.includes('/') ? id.slice(0, id.lastIndexOf('/') + 1) : ''
    setValue(next === 'new' ? `${folder}new-page.md` : (id ?? ''))
    setProblem('')
    setNotice('')
    setMode(next)
  }

  const run = async () => {
    if (!mode || busy) return
    setBusy(true)
    setProblem('')
    try {
      const pages = await connectPages()
      if (mode === 'new') {
        const made = await pages.create(value.trim())
        await untilRoute(made.path, true)
        await go(made.path)
        setNotice(`Created ${contentDir}/${made.id}.`)
      } else if (mode === 'rename' && id) {
        const moved = await pages.rename(id, value.trim())
        await untilRoute(moved.path, true)
        await go(moved.path, { replace: true })
        setNotice(`Now ${contentDir}/${moved.id}.${moved.sidebar === 'updated' ? ' sidebar.yaml follows.' : ''}`)
      } else if (mode === 'delete' && id) {
        const gone = await pages.remove(id)
        await untilRoute(path, false)
        await go('/', { replace: true })
        setNotice(
          `Deleted ${contentDir}/${id}.` +
            (gone.sidebar === 'updated' ? ' Its entry is out of sidebar.yaml.' : gone.sidebar === 'mentions' ? ' sidebar.yaml still lists it.' : ''),
        )
      }
      setMode(null)
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sb-studio-pages">
      {mode === null ? (
        <p className="sb-studio-page-buttons">
          <button type="button" className="sb-studio-action" onClick={() => open('new')}>
            New page
          </button>
          {id && (
            <>
              <button type="button" className="sb-studio-action" onClick={() => open('rename')} disabled={unsaved}>
                Rename
              </button>
              <button type="button" className="sb-studio-action" onClick={() => open('delete')}>
                Delete
              </button>
            </>
          )}
          {notice && <span role="status">{notice}</span>}
        </p>
      ) : (
        <form
          className="sb-studio-page-form"
          onSubmit={(event) => {
            event.preventDefault()
            void run()
          }}
        >
          {mode === 'delete' ? (
            <p>
              Delete <strong>{`${contentDir}/${id}`}</strong>? The file is removed from disk.
            </p>
          ) : (
            <label>
              {mode === 'new' ? `New page, under ${contentDir}/` : `Move to, under ${contentDir}/`}
              <input value={value} onChange={(event) => setValue(event.target.value)} spellCheck={false} autoFocus />
            </label>
          )}
          <p className="sb-studio-page-buttons">
            <button type="submit" className="sb-studio-action" disabled={busy}>
              {mode === 'new' ? 'Create' : mode === 'rename' ? 'Rename' : 'Delete the page'}
            </button>
            <button type="button" className="sb-studio-action" onClick={() => setMode(null)} disabled={busy}>
              Cancel
            </button>
          </p>
          {problem && (
            <p className="sb-studio-page-problem" role="alert">
              {problem}
            </p>
          )}
        </form>
      )}
    </div>
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
