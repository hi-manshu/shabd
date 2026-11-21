/**
 * What runs inside the frame of an isolated snippet.
 *
 * It is built into one script with React and the modules the site lets its
 * snippets import (src/node/sandbox/frame.ts), and the page hands that script
 * to the frame. From then on the page sends snippets, the shared state and
 * how the page looks; the frame sends back what the snippet did.
 *
 * Nothing here may import the app: the frame has no site data, no router and
 * no page around it.
 */
import { Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { runSnippet, type Loaders } from '../run.js'
import { SharedGroup, SharedGroupContext, useShared } from '../shared-state.js'
import { FROM_FRAME, FROM_PAGE, type Look, type Sheet, type ToFrame, type ToPage } from './protocol.js'

/** Are two shared values the same to a reader? A value that crossed between the windows is a copy, never the same object. */
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

export function startFrame(loaders: Loaders): void {
  const send = (message: ToPage) => window.parent.postMessage({ ...message, shabd: FROM_FRAME }, '*')
  const root = createRoot(document.getElementById('root')!)

  // The snippet's shared values live here and in the page's group, which has the state panel. Each
  // side tells the other what it set; what came from the page is not sent back to it.
  const group = new SharedGroup()
  const told = new Map<string, unknown>()
  let taking = false
  group.subscribe(() => {
    if (taking) return
    for (const [key, value] of group.entries()) {
      if (told.has(key) && same(told.get(key), value)) continue
      told.set(key, value)
      try {
        send({ type: 'set', key, value })
      } catch {
        // A value that cannot be copied to another window, a function for one, stays in the frame.
      }
    }
  })
  const take = (state: [string, unknown][]) => {
    taking = true
    try {
      for (const [key, value] of state) {
        told.set(key, value)
        if (!group.has(key) || !same(group.get(key), value)) group.set(key, value)
      }
    } finally {
      taking = false
    }
  }

  /** The page sizes the frame to what is in it. */
  const tellHeight = () => send({ type: 'height', height: Math.ceil(document.documentElement.getBoundingClientRect().height) })

  const client = { useShared }
  let current = 0
  const run = async (message: Extract<ToFrame, { type: 'run' }>) => {
    const id = (current = message.run)
    take(message.state)
    try {
      const Example = await runSnippet(message, { useShared }, { 'shabd/client': client, '@himanshoe/shabd/client': client }, loaders)
      // A newer snippet arrived while this one was fetching what it imports.
      if (id !== current) return
      root.render(
        <SharedGroupContext value={group}>
          <Boundary
            key={id}
            onError={(text) => send({ type: 'error', run: id, message: text })}
            onShown={() => {
              // Its size first, so that the page shows the frame at the height of what is in it.
              tellHeight()
              send({ type: 'shown', run: id })
            }}
          >
            <Example />
          </Boundary>
        </SharedGroupContext>,
      )
    } catch (error) {
      send({ type: 'error', run: id, message: error instanceof Error ? error.message : String(error) })
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return
    const message = event.data as (ToFrame & { shabd?: string }) | null
    if (!message || message.shabd !== FROM_PAGE) return
    if (message.type === 'run') void run(message)
    else if (message.type === 'state') take(message.state)
    else if (message.type === 'look') wear(message.look)
    else if (message.type === 'fonts') {
      for (const font of message.fonts) {
        try {
          document.fonts.add(new FontFace(font.family, font.source, font.descriptors))
        } catch {
          // A face this browser cannot make of the bytes: the text falls back to the next font.
        }
      }
    }
  })

  new ResizeObserver(tellHeight).observe(document.documentElement)

  send({ type: 'ready' })
}

/** The page's stylesheets as they are in the frame now, by what each is. */
const worn = new Map<string, HTMLElement>()

/** Look like the page: the same attributes on the root element, and the same stylesheets in the same order. */
function wear(look: Look): void {
  const html = document.documentElement
  for (const name of html.getAttributeNames()) if (!(name in look.attributes)) html.removeAttribute(name)
  for (const [name, value] of Object.entries(look.attributes)) if (html.getAttribute(name) !== value) html.setAttribute(name, value)

  // The frame's own rules come last, after the page's.
  const own = document.getElementById('sb-frame')
  const keyOf = (sheet: Sheet) => ('css' in sheet ? `css:${sheet.css}` : `href:${sheet.media ?? ''}:${sheet.href}`)
  const wanted = new Set(look.sheets.map(keyOf))
  for (const [key, element] of worn) {
    if (wanted.has(key)) continue
    element.remove()
    worn.delete(key)
  }
  // From the last to the first, each put before the one after it. One that is where it belongs is not
  // touched: a stylesheet that is put in again is read again, and a linked one is fetched again.
  let after: Element | null = own
  for (const sheet of [...look.sheets].reverse()) {
    const key = keyOf(sheet)
    let element = worn.get(key)
    if (!element) {
      if ('css' in sheet) {
        element = document.createElement('style')
        element.textContent = sheet.css
      } else {
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = sheet.href
        if (sheet.media) link.media = sheet.media
        element = link
      }
      worn.set(key, element)
    }
    if (element.parentNode !== document.head || element.nextElementSibling !== after) document.head.insertBefore(element, after)
    after = element
  }
}

/** A snippet that throws while rendering tells the page, and leaves the frame empty. */
class Boundary extends Component<{ children: ReactNode; onError: (message: string) => void; onShown: () => void }, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  override componentDidMount() {
    if (!this.state.failed) this.props.onShown()
  }

  override componentDidCatch(error: Error) {
    this.props.onError(error.message)
  }

  override render() {
    return this.state.failed ? null : this.props.children
  }
}
