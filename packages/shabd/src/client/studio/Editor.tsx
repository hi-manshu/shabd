/**
 * The Studio's editor: a text area, with its Markdown shown in colour.
 *
 * The text area is the editor. Typing, selecting, undo, input methods and
 * screen readers are the browser's own, as in any text area. Its text is
 * transparent. A second layer lies over it, holds the same text in the same
 * font, line for line, and gives each part its colour. That layer cannot be
 * clicked or focused; the caret and the selection show through it.
 *
 * The two only agree while they wrap alike, so the stylesheet gives both the
 * same font, spacing and padding (overlays.css), and the colours never change
 * the weight or the slant of a letter: a bold letter is wider in some fonts.
 */
import { memo, useId, useMemo, useRef, type KeyboardEvent } from 'react'
import { indent, newLine, wrap, type Edit } from './editing.js'
import { colourSource, type ColouredSource, type Piece } from './markdown-colours.js'

interface EditorProps {
  value: string
  /** `.mdx`: expressions and imports are code. */
  mdx: boolean
  label: string
  disabled: boolean
  onChange(value: string): void
  onSave(): void
}

/** One line of the coloured layer. A line that did not change is given the same pieces, and is not drawn again. */
const Line = memo(function Line({ pieces }: { pieces: Piece[] }) {
  return (
    <div className="sb-studio-line">
      {pieces.length === 0 ? (
        // An empty line still takes a line's height.
        <br />
      ) : (
        pieces.map((piece, index) =>
          piece.part ? (
            <span key={index} className={`sbs-${piece.part}`}>
              {piece.text}
            </span>
          ) : (
            piece.text
          ),
        )
      )}
    </div>
  )
})

/**
 * Change the text the way typing does. `execCommand` is deprecated and has no
 * replacement: it is the one way to edit a text area that the browser's own
 * undo can take back. Where it is refused, the text is set directly.
 */
function apply(area: HTMLTextAreaElement, edit: Edit): void {
  if (edit.from !== edit.to || edit.text !== '') {
    area.setSelectionRange(edit.from, edit.to)
    const typed = edit.text === '' ? document.execCommand('delete') : document.execCommand('insertText', false, edit.text)
    if (!typed) {
      area.setRangeText(edit.text, edit.from, edit.to, 'end')
      area.dispatchEvent(new Event('input', { bubbles: true }))
    }
  }
  area.setSelectionRange(edit.select[0], edit.select[1])
}

export function Editor({ value, mdx, label, disabled, onChange, onSave }: EditorProps) {
  const keysHint = useId()
  const remembered = useRef<ColouredSource | undefined>(undefined)
  const coloured = useMemo(() => {
    remembered.current = colourSource(value, { mdx }, remembered.current)
    return remembered.current
  }, [value, mdx])
  /** Escape was pressed: the next Tab leaves the editor instead of indenting. */
  const leaving = useRef(false)

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const area = event.currentTarget
    const { selectionStart: from, selectionEnd: to } = area
    const command = event.metaKey || event.ctrlKey
    const key = event.key.toLowerCase()
    // A key pressed to choose a character in an input method is not ours. Nor is Shift on its way to Shift+Tab.
    if (event.nativeEvent.isComposing || ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return
    const wasLeaving = leaving.current
    leaving.current = false

    if (command && !event.altKey && key === 's') {
      event.preventDefault()
      onSave()
    } else if (command && !event.altKey && !event.shiftKey && (key === 'b' || key === 'i')) {
      event.preventDefault()
      apply(area, wrap(area.value, from, to, key === 'b' ? '**' : '_'))
    } else if (event.key === 'Escape') {
      leaving.current = true
    } else if (event.key === 'Tab' && !command && !event.altKey) {
      // Tab belongs to the text here, so the keyboard needs another way out: Escape, then Tab.
      if (wasLeaving) return
      event.preventDefault()
      const edit = indent(area.value, from, to, event.shiftKey)
      if (edit) apply(area, edit)
    } else if (event.key === 'Enter' && !command && !event.altKey && !event.shiftKey) {
      const edit = newLine(area.value, from, to)
      if (!edit) return
      event.preventDefault()
      apply(area, edit)
    }
  }

  return (
    <div className="sb-studio-code">
      <div className="sb-studio-sheet">
        <textarea
          className="sb-studio-editor"
          aria-label={label}
          aria-describedby={keysHint}
          value={value}
          disabled={disabled}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => (leaving.current = false)}
        />
        <div className="sb-studio-colours" aria-hidden="true">
          {coloured.rows.map((pieces, index) => (
            <Line key={index} pieces={pieces} />
          ))}
        </div>
      </div>
      <p id={keysHint} hidden>
        Tab indents. To move on with the keyboard, press Escape and then Tab.
      </p>
    </div>
  )
}
