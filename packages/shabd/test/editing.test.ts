import { describe, expect, it } from 'vitest'
import { indent, newLine, wrap, type Edit } from '../src/client/studio/editing.js'

/** Text with its selection written in: `a|b` is a caret between a and b, `a[b]c` has b selected. */
function marked(text: string): { value: string; from: number; to: number } {
  const caret = text.indexOf('|')
  if (caret !== -1) return { value: text.replace('|', ''), from: caret, to: caret }
  const from = text.indexOf('[')
  const to = text.indexOf(']') - 1
  return { value: text.replace('[', '').replace(']', ''), from, to }
}

/** The text after an edit, with the new selection written in the same way. */
function applied(value: string, edit: Edit): string {
  const text = value.slice(0, edit.from) + edit.text + value.slice(edit.to)
  const [from, to] = edit.select
  return from === to ? `${text.slice(0, from)}|${text.slice(from)}` : `${text.slice(0, from)}[${text.slice(from, to)}]${text.slice(to)}`
}

const press = (act: (value: string, from: number, to: number) => Edit | null, text: string): string | null => {
  const { value, from, to } = marked(text)
  const edit = act(value, from, to)
  return edit && applied(value, edit)
}

const tab = (text: string) => press((value, from, to) => indent(value, from, to, false), text)
const shiftTab = (text: string) => press((value, from, to) => indent(value, from, to, true), text)
const enter = (text: string) => press(newLine, text)

describe('Tab', () => {
  it('types two spaces where the selection is on one line', () => {
    expect(tab('a|b')).toBe('a  |b')
    expect(tab('a[bc]d')).toBe('a  |d')
  })

  it('moves each selected line in, and keeps the same text selected', () => {
    expect(tab('[one\ntwo]')).toBe('  [one\n  two]')
    expect(tab('a\nb[c\n\nd]e\nf')).toBe('a\n  b[c\n\n  d]e\nf')
  })

  it('leaves out a line the selection only touches the start of', () => {
    expect(tab('[one\n]two')).toBe('  [one\n]two')
  })
})

describe('Shift+Tab', () => {
  it('moves the line of the caret out', () => {
    expect(shiftTab('    a|b')).toBe('  a|b')
    expect(shiftTab(' a|b')).toBe('a|b')
    expect(shiftTab('\ta|b')).toBe('a|b')
  })

  it('moves each selected line out, as far as it is indented', () => {
    expect(shiftTab('[  one\n two\nthree]')).toBe('[one\ntwo\nthree]')
  })

  it('does not put the caret before the start of its line', () => {
    expect(shiftTab(' |a')).toBe('|a')
  })

  it('changes nothing where nothing is indented', () => {
    expect(shiftTab('a|b')).toBeNull()
    expect(shiftTab('[one\ntwo]')).toBeNull()
  })
})

describe('Enter', () => {
  it('goes on with the next item of a list', () => {
    expect(enter('- one|')).toBe('- one\n- |')
    expect(enter('* one|')).toBe('* one\n* |')
    expect(enter('  + one|')).toBe('  + one\n  + |')
    expect(enter('- one|two')).toBe('- one\n- |two')
  })

  it('counts on in a numbered list, with the same full stop or bracket', () => {
    expect(enter('3. three|')).toBe('3. three\n4. |')
    expect(enter('9) nine|')).toBe('9) nine\n10) |')
  })

  it('starts the next task unticked', () => {
    expect(enter('- [x] done|')).toBe('- [x] done\n- [ ] |')
  })

  it('ends the list on an item with nothing in it', () => {
    expect(enter('- one\n- |')).toBe('- one\n|')
    expect(enter('- one\n  - |')).toBe('- one\n  |')
    expect(enter('1. |')).toBe('|')
    expect(enter('- [ ] |')).toBe('|')
  })

  it('goes on with a quote, and ends it on an empty line of it', () => {
    expect(enter('> one|')).toBe('> one\n> |')
    expect(enter('> [!NOTE] Title|')).toBe('> [!NOTE] Title\n> |')
    expect(enter('> one\n> |')).toBe('> one\n|')
    expect(enter('> - one|')).toBe('> - one\n> - |')
    expect(enter('> - |')).toBe('> |')
  })

  it('keeps the indentation of any other line', () => {
    expect(enter('  key: value|')).toBe('  key: value\n  |')
    expect(enter('\tcode|more')).toBe('\tcode\n\t|more')
  })

  it('is an ordinary line break where there is nothing to add', () => {
    expect(enter('plain|')).toBeNull()
    expect(enter('-not a list|')).toBeNull()
    expect(enter('1.5 is a number|')).toBeNull()
    // With text selected, Enter replaces it, as it does everywhere.
    expect(enter('- [one]')).toBeNull()
  })
})

describe('bold and italic', () => {
  const bold = (text: string) => press((value, from, to) => wrap(value, from, to, '**'), text)

  it('puts the marker on both sides of the selection', () => {
    expect(bold('a [word] here')).toBe('a **[word]** here')
    expect(press((value, from, to) => wrap(value, from, to, '_'), 'a [word] here')).toBe('a _[word]_ here')
  })

  it('leaves the caret between the markers when nothing is selected', () => {
    expect(bold('a | here')).toBe('a **|** here')
  })

  it('takes the marker away where it is there already', () => {
    expect(bold('a **[word]** here')).toBe('a [word] here')
  })
})
