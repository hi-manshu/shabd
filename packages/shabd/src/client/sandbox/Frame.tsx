/**
 * The result of an isolated snippet: a frame that runs the snippet where it
 * can reach nothing of the page.
 *
 * The page keeps what it has for every sandbox: the editor, the shared state
 * and its panel, the message when something is wrong. It makes the snippet's
 * text into a script, as it does for a snippet that runs in the page, and
 * sends the script to the frame. What happens in the frame comes back as
 * messages: frame/protocol.ts says which.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { transformSnippet, type Transformed } from '../../shared/snippet.js'
import { loadedFonts, readLook, watchLook } from './frame/look.js'
import { FROM_FRAME, FROM_PAGE, frameDocument, type ToFrame, type ToPage } from './frame/protocol.js'
import type { SharedGroup } from './shared-state.js'

interface FrameProps {
  code: string
  group: SharedGroup
  /** Nothing is wrong with the snippet as far as the page knows: say that it is starting until it is shown. */
  quiet: boolean
  /** What is wrong with the snippet, or `null` once it is on the screen. */
  onProblem: (message: string | null) => void
}

/** How long typing must pause before the snippet is sent again. */
const RUN_DELAY = 150

/** The script every frame runs. It is fetched when the first isolated snippet is shown, and once. */
let runtime: Promise<string> | undefined

/** The shared values that can be copied to another window. A function, for one, cannot. */
function copyable(entries: ReadonlyArray<readonly [string, unknown]>): [string, unknown][] {
  return entries.flatMap(([key, value]): [string, unknown][] => {
    try {
      structuredClone(value)
      return [[key, value]]
    } catch {
      return []
    }
  })
}

export function Frame({ code, group, quiet, onProblem }: FrameProps) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(0)
  const [shown, setShown] = useState(false)
  /** The frame's own document has been read to its end. */
  const [loaded, setLoaded] = useState(false)
  // Addresses in the frame are read from where the page is, and its document is in the page's language.
  const source = useMemo(() => frameDocument(window.location.href, document.documentElement.lang || 'en'), [])

  /** The frame's script is running. Until then what is meant for it waits. */
  const ready = useRef(false)
  /** Numbers the snippets sent, so that word of an earlier one is not taken for the latest. */
  const run = useRef(0)
  const waiting = useRef<Transformed | undefined>(undefined)
  /** Send a snippet to the frame, now or as soon as its script is running. */
  const send = useRef<(snippet: Transformed) => void>(() => {})
  const report = useRef(onProblem)
  report.current = onProblem
  /** Hands the frame its script, once: when the frame asks for it, or when its document has been read. */
  const boot = useRef<() => void>(() => {})
  const booted = useRef(false)

  // A layout effect, so that the page is listening before the frame can have said anything. The frame is in
  // the document from the moment React puts it there, and asks for its script as soon as its own document
  // is read. An effect that waited for the page to be painted first was now and then later than that. The
  // frame's question was then asked of nobody, and the example never started: seen in WebKit on Linux, on
  // a built site, where a page is quick to be read.
  useLayoutEffect(() => {
    const post = (message: ToFrame) => frame.current?.contentWindow?.postMessage({ ...message, shabd: FROM_PAGE }, '*')
    boot.current = () => {
      if (booted.current) return
      booted.current = true
      runtime ??= import('virtual:shabd/sandbox-frame').then((module) => module.default)
      runtime.then(
        (script) => post({ type: 'boot', code: script }),
        (error: unknown) => report.current(`The frame for this example could not be started: ${error instanceof Error ? error.message : String(error)}`),
      )
    }
    const start = (snippet: Transformed) => post({ type: 'run', run: ++run.current, ...snippet, state: copyable(group.entries()) })

    /** The fonts this frame has been given, by address. */
    const sent = new Set<string>()
    const dress = () => {
      const { look, fonts } = readLook()
      post({ type: 'look', look })
      void loadedFonts(fonts, sent).then((found) => {
        if (found.length > 0) post({ type: 'fonts', fonts: found })
      })
    }

    const onMessage = (event: MessageEvent) => {
      // Only this frame, and only what is marked as its script's: a snippet can post anything it likes.
      if (!frame.current || event.source !== frame.current.contentWindow) return
      const message = event.data as (ToPage & { shabd?: string }) | null
      if (!message || message.shabd !== FROM_FRAME) return
      switch (message.type) {
        case 'boot':
          boot.current()
          break
        case 'ready':
          ready.current = true
          dress()
          if (waiting.current) start(waiting.current)
          waiting.current = undefined
          break
        case 'shown':
          if (message.run !== run.current) break
          setShown(true)
          report.current(null)
          break
        case 'error':
          if (message.run === run.current) report.current(String(message.message))
          break
        case 'height':
          if (typeof message.height === 'number' && Number.isFinite(message.height)) setHeight(Math.max(0, message.height))
          break
        case 'set':
          if (typeof message.key === 'string') group.set(message.key, message.value)
          break
      }
    }
    window.addEventListener('message', onMessage)

    const unsubscribe = group.subscribe(() => {
      if (ready.current) post({ type: 'state', state: copyable(group.entries()) })
    })
    const unwatch = watchLook(() => {
      if (ready.current) dress()
    })
    send.current = (snippet) => {
      if (ready.current) start(snippet)
      else waiting.current = snippet
    }
    return () => {
      window.removeEventListener('message', onMessage)
      unsubscribe()
      unwatch()
    }
  }, [group])

  const first = useRef(true)
  useEffect(() => {
    let current = true
    const timer = window.setTimeout(
      () => {
        transformSnippet(code).then(
          (snippet) => {
            if (current) send.current(snippet)
          },
          (error: unknown) => {
            // What ran last stays on the screen while the code is mid-edit.
            if (current) report.current(error instanceof Error ? error.message : String(error))
          },
        )
      },
      first.current ? 0 : RUN_DELAY,
    )
    first.current = false
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [code])

  return (
    <>
      {!shown && quiet && <p className="sb-sandbox-wait">Starting the example…</p>}
      <iframe
        ref={frame}
        className="sb-sandbox-frame"
        title="The result of this example"
        // Scripts, and nothing else: not the site's origin, no forms, no new windows, no leaving the page.
        sandbox="allow-scripts"
        srcDoc={source}
        // Its document has been read, and with it the line that waits for the script. The frame asks for the
        // script itself as well: whichever comes first is answered, so that a question nobody heard costs nothing.
        onLoad={() => {
          setLoaded(true)
          boot.current()
        }}
        // Nothing of it is seen until the snippet is: before that it does not yet look like the page.
        //
        // And it is not laid out at all until its document has been read. Firefox warns when a layout is
        // asked of a document it is still reading, "Layout was forced before the page was fully loaded",
        // and on a page that also draws a code editor something asked that of the frame now and then.
        // What asked was not found. A frame that is not displayed has no layout to ask for.
        style={{ blockSize: `${height}px`, visibility: shown ? 'visible' : 'hidden', display: loaded ? undefined : 'none' }}
      />
    </>
  )
}
