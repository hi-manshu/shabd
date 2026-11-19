/**
 * A code editor: the Studio's, and the one a live sandbox will use for its
 * snippet.
 *
 * This file is all a caller imports, and it is small. The editor itself is
 * CodeMirror, which is not: it is fetched the first time an editor is put on
 * screen, so a reader who never sees one never downloads it. Until it
 * arrives the text is shown as it is, laid out as the editor will lay it out.
 *
 * `value` is where the text starts, and how it is replaced from outside:
 * give a different text and the editor changes only the part that differs,
 * so the cursor stays where it was when it can. What is typed is reported
 * through `onChange`. To start on another document, with nothing to undo,
 * give the editor a different `key`.
 *
 * It renders in the browser only. The Studio is opened by a click, and a
 * sandbox is not put on the page until the page has hydrated (see `Sandbox`
 * in mdx/index.tsx). A caller that renders on the server has to wait the
 * same way.
 */
import type { Extension } from '@codemirror/state'
import { lazy, Suspense, useId } from 'react'

export type EditorLanguage = 'markdown' | 'tsx'

export interface CodeEditorProps {
  value: string
  /**
   * `markdown` is a page, with its frontmatter and the code in its fences. `tsx` is a snippet.
   * An editor keeps the language it starts with: a different one is a different editor.
   */
  language: EditorLanguage
  /** What the text field is called, for someone who cannot see what is around it. */
  label: string
  /** The whole text, after each edit made in the editor. Not called when `value` replaced the text. */
  onChange: (value: string) => void
  /** Ctrl or ⌘ + S. Left out, the key stays the browser's. */
  onSave?: (() => void) | undefined
  /** The text can be read, selected and copied, and not changed. */
  readOnly?: boolean | undefined
  /** Added to the frame's own class, for the caller to size it and give it a background. */
  className?: string | undefined
}

/** What the part that is CodeMirror is given. */
export interface EditorViewProps extends Omit<CodeEditorProps, 'language' | 'className'> {
  /** The id of the line that says how to leave the editor by keyboard. */
  hintId: string
}

/**
 * CodeMirror and one grammar, fetched together. Each grammar is a file of
 * its own, so that a page with a snippet on it does not fetch what only
 * Markdown needs: that is a quarter of the whole.
 */
const fetched = (grammarOf: () => Promise<{ grammar: Extension }>) =>
  lazy(async () => {
    const [{ CodeMirrorView }, { grammar }] = await Promise.all([import('./CodeMirrorView.js'), grammarOf()])
    return { default: (props: EditorViewProps) => <CodeMirrorView {...props} grammar={grammar} /> }
  })

const VIEWS = {
  markdown: fetched(() => import('./markdown.js')),
  tsx: fetched(() => import('./tsx.js')),
} satisfies Record<EditorLanguage, unknown>

export function CodeEditor({ value, language, label, onChange, onSave, readOnly = false, className }: CodeEditorProps) {
  const hint = useId()
  const View = VIEWS[language]
  return (
    <div className={className ? `sb-editor ${className}` : 'sb-editor'} data-readonly={readOnly ? '' : undefined}>
      <Suspense fallback={<pre className="sb-editor-plain">{value}</pre>}>
        <View value={value} label={label} onChange={onChange} onSave={onSave} readOnly={readOnly} hintId={hint} />
      </Suspense>
      {/*
       * Tab indents, so it cannot also move focus on, and someone using a keyboard alone would be held
       * in the editor. CodeMirror lets the Tab after an Esc through; that only helps a person who is told.
       */}
      <p className="sb-editor-hint" id={hint}>
        Tab indents. To move on by keyboard, press Esc, then Tab.
      </p>
    </div>
  )
}
