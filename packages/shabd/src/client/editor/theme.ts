/**
 * The editor's look: its own stylesheet, and the colours of what it parses.
 *
 * No colour is named here. Every one is a custom property generated from
 * the site's theme (src/node/config/theme-css.ts), for two reasons:
 *
 *   - The editor follows the page. Switching between light and dark, or
 *     picking another palette from the theme menu, changes those properties
 *     on the root element, and the editor changes with everything else. It
 *     is never told which mode it is in.
 *   - It is readable wherever the page is. test/presets.test.ts holds every
 *     preset, in both modes, to a contrast floor against both the page and
 *     the surface colour: 7:1 for `text`, 4.5:1 for `muted`, `accent` and the
 *     five callout colours. Those eight are the only colours text is drawn
 *     in here, so no syntax theme needs checking against twenty-three
 *     palettes: the palettes are already checked.
 *
 * That holds only while two things stay true. The editor has to sit on the
 * page or the surface colour: it has no background of its own, and whatever
 * holds it supplies one of those two. And nothing may be tinted behind
 * text, which is why the matching bracket gets an outline where CodeMirror
 * would give it a background. Selected text is the page's own `::selection`.
 */
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'

const text = 'var(--sb-text)'
const muted = 'var(--sb-muted)'
const accent = 'var(--sb-accent)'
const note = 'var(--sb-note)'
const tip = 'var(--sb-tip)'
const success = 'var(--sb-success)'
const caution = 'var(--sb-caution)'
const danger = 'var(--sb-danger)'

/**
 * The font, its size and the padding come from `.sb-editor` in
 * styles/overlays.css, so that the plain text shown while CodeMirror loads
 * is laid out exactly as the editor will be. CodeMirror's own stylesheet is
 * not in a cascade layer and so outranks ours; what it sets has to be
 * answered from here.
 */
const frame = EditorView.theme({
  '&': {
    color: text,
    backgroundColor: 'transparent',
  },
  // The frame around the editor shows focus (`.sb-editor:focus-within`).
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: 'inherit',
  },
  '.cm-content': {
    padding: 'var(--sb-editor-padding)',
    caretColor: text,
  },
  '.cm-line': {
    padding: '0',
  },
  // Where something dragged over the text would land.
  '.cm-dropCursor': {
    borderLeftColor: text,
  },
  '&.cm-focused .cm-matchingBracket': {
    backgroundColor: 'transparent',
    outline: `1px solid ${muted}`,
  },
  '&.cm-focused .cm-nonmatchingBracket': {
    backgroundColor: 'transparent',
    outline: `1px solid ${danger}`,
  },
})

const colours = HighlightStyle.define([
  // Markdown.
  { tag: tags.heading, fontWeight: '700' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: accent },
  { tag: tags.url, color: muted, textDecoration: 'underline' },
  { tag: tags.monospace, color: tip },
  // The marks that make Markdown: #, *, >, the backticks of a fence, the dashes around frontmatter.
  { tag: [tags.processingInstruction, tags.contentSeparator, tags.meta], color: muted },
  { tag: tags.comment, color: muted, fontStyle: 'italic' },

  // Code, and the YAML of frontmatter.
  { tag: tags.keyword, color: accent },
  { tag: [tags.string, tags.attributeValue], color: success },
  { tag: [tags.number, tags.bool, tags.null, tags.atom, tags.self, tags.character, tags.escape, tags.regexp], color: caution },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.definition(tags.propertyName)], color: note },
  { tag: [tags.attributeName, tags.labelName], color: note },
  { tag: [tags.typeName, tags.className, tags.namespace, tags.tagName], color: tip },
  { tag: tags.invalid, color: danger },
])

export const editorTheme: Extension = [frame, syntaxHighlighting(colours)]
