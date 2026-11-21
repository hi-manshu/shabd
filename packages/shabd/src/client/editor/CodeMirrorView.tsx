/**
 * The part of the editor that is CodeMirror. `CodeEditor` fetches this file,
 * and with it CodeMirror, the first time an editor is shown.
 *
 * The view is made once and lives as long as the component. Props that
 * change afterwards are carried into it: the name and the read-only switch
 * by reconfiguring, a new `value` as a change to the document.
 */
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, indentOnInput, indentUnit } from '@codemirror/language'
import { Annotation, Compartment, EditorState, Transaction, type Extension } from '@codemirror/state'
import { dropCursor, EditorView, keymap } from '@codemirror/view'
import { useLayoutEffect, useRef } from 'react'
import type { EditorHandle, EditorViewProps } from './CodeEditor.js'
import { endsLinesWithCrLf, replacement, toCrLf, toLineFeeds, type Replacement } from './text.js'
import { editorTheme } from './theme.js'

interface Props extends EditorViewProps {
  /** What reads the text: see markdown.ts and tsx.ts. */
  grammar: Extension
}

/** Marks a change that came in through `value`, so that it is not reported back as something typed. */
const fromOutside = Annotation.define<boolean>()

/** Whether the text may be changed, and what the field tells a screen reader about itself. */
function access(label: string, readOnly: boolean, hintId: string): Extension {
  return [
    EditorState.readOnly.of(readOnly),
    // Off, a phone does not raise its keyboard for text that cannot be typed into.
    EditorView.editable.of(!readOnly),
    EditorView.contentAttributes.of(
      readOnly
        ? // Text that is not editable is not in the tab order unless it is put there. It still scrolls and copies.
          { 'aria-label': label, tabindex: '0' }
        : { 'aria-label': label, 'aria-describedby': hintId },
    ),
  ]
}

export function CodeMirrorView({ value, label, onChange, onSave, onFiles, handle, readOnly = false, hintId, grammar }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const mounted = useRef<{ view: EditorView; accessOf: Compartment } | null>(null)
  /** The text as the caller has it: what it passed in last, or what it was told last. */
  const known = useRef(value)
  /** CodeMirror keeps lines apart with a line feed alone. This remembers that the file's lines end in CR LF. */
  const crlf = useRef(false)
  const handlers = useRef({ onChange, onSave, onFiles, handle })

  useLayoutEffect(() => {
    handlers.current = { onChange, onSave, onFiles, handle }
  })

  useLayoutEffect(() => {
    const accessOf = new Compartment()
    crlf.current = endsLinesWithCrLf(known.current)
    /** Where files landed that the caller is still dealing with. Kept in step with the text as it changes meanwhile. */
    const landings = new Set<{ from: number; to: number }>()

    /**
     * Hand files to the caller, and put what it answers where they landed.
     * False when this editor does nothing with files, so that CodeMirror does what it would.
     */
    const take = (files: File[], landing: { from: number; to: number }): boolean => {
      const { onFiles } = handlers.current
      if (!onFiles || view.state.readOnly) return false
      landings.add(landing)
      onFiles(files)
        .then((insertion) => {
          // The editor may be gone by now: the Studio has gone to another page.
          if (!insertion || mounted.current?.view !== view) return
          const text = toLineFeeds(insertion.text)
          view.dispatch({
            changes: { from: landing.from, to: landing.to, insert: text },
            selection: { anchor: landing.from + Math.min(insertion.cursor ?? text.length, text.length) },
            scrollIntoView: true,
            userEvent: 'input.paste',
          })
          view.focus()
        })
        // What went wrong is the caller's to say. Nothing is put in.
        .catch(() => {})
        .finally(() => landings.delete(landing))
      return true
    }

    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: toLineFeeds(known.current),
        extensions: [
          keymap.of([
            {
              key: 'Mod-s',
              run: () => {
                const save = handlers.current.onSave
                save?.()
                // Handled only when there is something to do. Otherwise the browser offers to save the page, as it does anywhere else.
                return save !== undefined
              },
            },
            // Tab and Shift+Tab indent. The way out for a keyboard is CodeMirror's own: Esc, then Tab.
            indentWithTab,
            ...historyKeymap,
            ...defaultKeymap,
          ]),
          history(),
          indentOnInput(),
          bracketMatching(),
          indentUnit.of('  '),
          EditorState.tabSize.of(2),
          // Long lines wrap: the editor is a narrow column beside a page, or a pane of a sandbox.
          EditorView.lineWrapping,
          editorTheme,
          grammar,
          // Filled in by the effect below, which also follows the props it is made from.
          accessOf.of([]),
          // Shows where something dragged over the text would land.
          dropCursor(),
          EditorView.domEventHandlers({
            paste(event) {
              const files = [...(event.clipboardData?.files ?? [])]
              // What is copied from a spreadsheet or a file manager comes as text with a picture or a file
              // beside it. The text is what is pasted then, as it always was.
              if (files.length === 0 || event.clipboardData?.getData('text/plain')) return false
              const { from, to } = view.state.selection.main
              if (!take(files, { from, to })) return false
              event.preventDefault()
              return true
            },
            drop(event) {
              const files = [...(event.dataTransfer?.files ?? [])]
              if (files.length === 0) return false
              const at = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head
              if (!take(files, { from: at, to: at })) return false
              event.preventDefault()
              return true
            },
          }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return
            for (const landing of landings) {
              landing.from = update.changes.mapPos(landing.from, 1)
              landing.to = update.changes.mapPos(landing.to, 1)
            }
            const outside = update.transactions.filter((transaction) => transaction.annotation(fromOutside)).length
            if (outside === update.transactions.length) return
            const text = update.state.doc.toString()
            // A file with Windows line endings gets them back, so that one keystroke does not rewrite every line of it.
            known.current = crlf.current ? toCrLf(text) : text
            // What was typed, as the change it was. Where a change from outside is mixed in with it, the two
            // cannot be told apart here, and the caller is left to work out what differs.
            const changes: Replacement[] = []
            if (outside === 0) update.changes.iterChanges((from, to, _fromNow, _toNow, inserted) => changes.push({ from, to, insert: inserted.toString() }))
            handlers.current.onChange(known.current, outside === 0 ? changes : undefined)
          }),
        ],
      }),
    })
    mounted.current = { view, accessOf }
    const api: EditorHandle = {
      apply(changes) {
        try {
          view.dispatch({
            changes: changes.map((change) => ({ from: change.from, to: change.to, insert: toLineFeeds(change.insert) })),
            // As for a new `value`: not typed here, so not reported, and not this editor's to undo.
            annotations: [fromOutside.of(true), Transaction.addToHistory.of(false)],
          })
        } catch {
          // They were made to another text than the one held here.
          return false
        }
        const text = view.state.doc.toString()
        known.current = crlf.current ? toCrLf(text) : text
        return true
      },
    }
    handlers.current.handle?.(api)
    return () => {
      handlers.current.handle?.(null)
      view.destroy()
      mounted.current = null
    }
    // Made once. An editor keeps its grammar; the two effects below follow the props that may change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useLayoutEffect(() => {
    const editor = mounted.current
    editor?.view.dispatch({ effects: editor.accessOf.reconfigure(access(label, readOnly, hintId)) })
  }, [label, readOnly, hintId])

  useLayoutEffect(() => {
    const view = mounted.current?.view
    // What the editor itself reported comes back as `value` a moment later. Only a text it does not know is news.
    if (!view || value === known.current) return
    known.current = value
    crlf.current = endsLinesWithCrLf(value)
    const before = view.state.doc.toString()
    const after = toLineFeeds(value)
    if (before === after) return
    view.dispatch({
      changes: replacement(before, after),
      // Not typed here, so not this editor's to undo. Undo still takes back what was typed before it, around the change.
      annotations: [fromOutside.of(true), Transaction.addToHistory.of(false)],
    })
  }, [value])

  return <div className="sb-editor-view" ref={host} />
}
