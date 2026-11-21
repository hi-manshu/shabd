import { describe, expect, it } from 'vitest'
import { endsLinesWithCrLf, replacement, toCrLf, toLineFeeds } from '../src/client/editor/text.js'

/** `before` with the replacement made: what the editor's document becomes. */
const applied = (before: string, after: string) => {
  const { from, to, insert } = replacement(before, after)
  return before.slice(0, from) + insert + before.slice(to)
}

describe('text that replaces what is in the editor', () => {
  it('changes only the part that differs, so a cursor elsewhere stays where it is', () => {
    const before = '# Setting up\n\nInstall the thing.\n\n## Second step\n'
    const after = '# Setting up\n\nChanged in another editor.\n\n## Second step\n'
    const change = replacement(before, after)
    expect(change).toEqual({ from: 14, to: 31, insert: 'Changed in another editor' })
    // Everything from the full stop on is untouched, and that is where the second heading is.
    expect(before.slice(change.to)).toBe('.\n\n## Second step\n')
  })

  it('reads a text added or taken away at either end as only that', () => {
    expect(replacement('one two', 'one two three')).toEqual({ from: 7, to: 7, insert: ' three' })
    expect(replacement('one two', 'zero one two')).toEqual({ from: 0, to: 0, insert: 'zero ' })
    expect(replacement('alpha beta gamma', 'alpha gamma')).toEqual({ from: 6, to: 11, insert: '' })
    expect(replacement('', 'all new')).toEqual({ from: 0, to: 0, insert: 'all new' })
    expect(replacement('all gone', '')).toEqual({ from: 0, to: 8, insert: '' })
    expect(replacement('same', 'same')).toEqual({ from: 4, to: 4, insert: '' })
  })

  it('does not count the same characters twice when a text repeats itself', () => {
    expect(replacement('aaa', 'aa')).toEqual({ from: 2, to: 3, insert: '' })
    expect(replacement('aa', 'aaa')).toEqual({ from: 2, to: 2, insert: 'a' })
    expect(replacement('abab', 'ab')).toEqual({ from: 2, to: 4, insert: '' })
  })

  it('never cuts a character in two', () => {
    // Two emoji that share their first half, and two that share their second.
    expect(replacement('a😀b', 'a😁b')).toEqual({ from: 1, to: 3, insert: '😁' })
    expect(replacement('a\u{1F600}b', 'a\u{1FA00}b')).toEqual({ from: 1, to: 3, insert: '\u{1FA00}' })
    expect(replacement('😀', '😀😀')).toEqual({ from: 2, to: 2, insert: '😀' })
  })

  it('always leads from the old text to the new one', () => {
    const texts = ['', 'a', 'ab', 'ba', 'aXb', 'aXYb', 'abcabc', 'abc', 'line\nline\n', 'line\nother\nline\n', '😀😁', '😁😀', 'x😀', '😀x']
    for (const before of texts) {
      for (const after of texts) expect(applied(before, after), `${JSON.stringify(before)} → ${JSON.stringify(after)}`).toBe(after)
    }
  })
})

describe('line endings in the editor', () => {
  it('holds every kind of line ending as a line feed', () => {
    expect(toLineFeeds('one\r\ntwo\rthree\nfour')).toBe('one\ntwo\nthree\nfour')
    expect(toLineFeeds('no line endings')).toBe('no line endings')
  })

  it('gives a file from Windows its line endings back', () => {
    const file = '# Title\r\n\r\nA paragraph.\r\n'
    expect(endsLinesWithCrLf(file)).toBe(true)
    expect(toCrLf(toLineFeeds(file))).toBe(file)
    expect(endsLinesWithCrLf('# Title\n\nA paragraph.\n')).toBe(false)
  })
})
