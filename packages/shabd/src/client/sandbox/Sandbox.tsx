/**
 * A live code sandbox: an editor and the running result, side by side.
 *
 * Written in Markdown as a fence with `live`:
 *
 *     ```tsx live
 *     export default function Counter() {
 *       const [count, setCount] = useShared('count', 0)
 *       return <button onClick={() => setCount(count + 1)}>Clicked {count}</button>
 *     }
 *     ```
 *
 * The three panes show one piece of state from three sides:
 *   - the code that declares it
 *   - the widget that renders and changes it
 *   - the state panel, which lists it and can set it
 * Editing the code keeps the state; changing the state re-renders the widget.
 */
import { Component, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ComponentType, type ReactNode } from 'react'
import { useMDXComponents } from 'virtual:shabd/mdx-components'
import { modules as declared } from 'virtual:shabd/sandbox-modules'
import { compileSnippet } from './compile.js'
import { sharedGroup, SharedGroupContext, useShared, type SharedGroup } from './shared-state.js'

interface SandboxProps {
  code: string
  lang?: string
  title?: string
  /** Sandboxes with the same group name share their state. */
  group?: string
}

/** How long typing must pause before the snippet is recompiled. */
const COMPILE_DELAY = 150

export default function Sandbox({ code: authored, title, group: groupName }: SandboxProps) {
  const id = useId()
  const group = useMemo(() => sharedGroup(groupName ?? `sandbox:${id}`), [groupName, id])
  const [code, setCode] = useState(authored)
  const [built, setBuilt] = useState<{ Example: ComponentType; version: number } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const components = useMDXComponents()
  const version = useRef(0)

  // The author edited the snippet in the Markdown file: start again from the new text.
  useEffect(() => setCode(authored), [authored])

  useEffect(() => {
    let current = true
    const timer = window.setTimeout(
      () => {
        // Components registered for MDX are in scope by name, like they are in the page.
        const scope: Record<string, unknown> = { useShared }
        for (const [name, value] of Object.entries(components)) if (/^[A-Z]/.test(name)) scope[name] = value

        // A snippet may import what it uses. `shabd/client` is the short name, good on any site; the other
        // is what this package is called on npm, for a snippet copied from a component file. After those
        // come the modules the site's config names, each fetched when a snippet asks for it.
        compileSnippet(code, scope, { 'shabd/client': { useShared }, '@himanshoe/shabd/client': { useShared } }, declared).then(
          (Example) => {
            if (!current) return
            setBuilt({ Example, version: ++version.current })
            setProblem(null)
          },
          (error: unknown) => {
            // Keep showing the last version that worked while the code is mid-edit.
            if (current) setProblem(error instanceof Error ? error.message : String(error))
          },
        )
      },
      built ? COMPILE_DELAY : 0,
    )
    return () => {
      current = false
      window.clearTimeout(timer)
    }
    // `built` only decides the first compile's delay; recompiling when it changes would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, components])

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Tab' || event.shiftKey) return
    event.preventDefault()
    const area = event.currentTarget
    const { selectionStart, selectionEnd, value } = area
    setCode(`${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`)
    requestAnimationFrame(() => area.setSelectionRange(selectionStart + 2, selectionStart + 2))
  }

  return (
    <figure className="sb-sandbox">
      <figcaption className="sb-code-bar">
        <span className="sb-code-label" data-kind={title ? 'title' : 'lang'}>
          {title ?? 'Live example'}
        </span>
        {code !== authored && (
          <button type="button" className="sb-code-copy" onClick={() => setCode(authored)}>
            Reset code
          </button>
        )}
      </figcaption>

      <div className="sb-sandbox-panes">
        <textarea
          className="sb-sandbox-editor"
          aria-label="Code for this example. Edit it to change the result."
          value={code}
          rows={code.split('\n').length}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(event) => setCode(event.target.value)}
          onKeyDown={onKeyDown}
        />

        <div className="sb-sandbox-result">
          <div className="sb-sandbox-stage">
            {built ? (
              <SharedGroupContext value={group}>
                <RenderBoundary key={built.version} onError={setProblem}>
                  <built.Example />
                </RenderBoundary>
              </SharedGroupContext>
            ) : (
              !problem && <p className="sb-sandbox-wait">Starting the example…</p>
            )}
          </div>
          {problem && (
            <pre className="sb-sandbox-problem" role="alert">
              {problem}
            </pre>
          )}
          <StatePanel group={group} />
        </div>
      </div>
    </figure>
  )
}

/** The shared values of a group, each with a control that edits it. */
function StatePanel({ group }: { group: SharedGroup }) {
  const entries = useSyncExternalStore(group.subscribe, group.entries, group.entries)
  if (entries.length === 0) return null
  return (
    <dl className="sb-sandbox-state" aria-label="State">
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>
            {typeof value === 'boolean' ? (
              <input type="checkbox" aria-label={key} checked={value} onChange={(event) => group.set(key, event.target.checked)} />
            ) : typeof value === 'number' ? (
              <input
                type="number"
                aria-label={key}
                value={value}
                onChange={(event) => event.target.value !== '' && group.set(key, Number(event.target.value))}
              />
            ) : typeof value === 'string' ? (
              <input type="text" aria-label={key} value={value} onChange={(event) => group.set(key, event.target.value)} />
            ) : (
              <code>{JSON.stringify(value)}</code>
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** A snippet that throws while rendering reports the error instead of taking the page down. */
class RenderBoundary extends Component<{ children: ReactNode; onError: (message: string) => void }, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  override componentDidCatch(error: Error) {
    this.props.onError(error.message)
  }

  override render() {
    return this.state.failed ? null : this.props.children
  }
}
