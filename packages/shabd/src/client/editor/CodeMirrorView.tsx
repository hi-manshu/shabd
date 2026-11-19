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
import { EditorView, keymap } from '@codemirror/view'
import { useLayoutEffect, useRef } from 'react'
import type { EditorViewProps } from './CodeEditor.js'
import { endsLinesWithCrLf, replacement, toCrLf, toLineFeeds } from './text.js'
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

export function CodeMirrorView({ value, label, onChange, onSave, readOnly = false, hintId, grammar }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const mounted = useRef<{ view: EditorView; accessOf: Compartment } | null>(null)
  /** The text as the caller has it: what it passed in last, or what it was told last. */
  const known = useRef(value)
  /** CodeMirror keeps lines apart with a line feed alone. This remembers that the file's lines end in CR LF. */
  const crlf = useRef(false)
  const handlers = useRef({ onChange, onSave })

  useLayoutEffect(() => {
    handlers.current = { onChange, onSave }
  })

  useLayoutEffect(() => {
    const accessOf = new Compartment()
    crlf.current = endsLinesWithCrLf(known.current)

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
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || update.transactions.every((transaction) => transaction.annotation(fromOutside))) return
            const text = update.state.doc.toString()
            // A file with Windows line endings gets them back, so that one keystroke does not rewrite every line of it.
            known.current = crlf.current ? toCrLf(text) : text
            handlers.current.onChange(known.current)
          }),
        ],
      }),
    })
    mounted.current = { view, accessOf }
    return () => {
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
