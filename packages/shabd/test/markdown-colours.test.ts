import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { colourLine, colourSource, START, type Piece } from '../src/client/studio/markdown-colours.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.join(here, '..', '..', '..')

/** A line's pieces as `part:text`, plain text as it is. */
const read = (line: string, options: { state?: string; mdx?: boolean; first?: boolean } = {}) =>
  colourLine(line, options.state ?? START, { mdx: options.mdx ?? false }, options.first ?? false).pieces.map((piece) =>
    piece.part ? `${piece.part}:${piece.text}` : piece.text,
  )

/** The lines of a source as `part:text` lists. */
const readAll = (source: string, mdx = false) =>
  colourSource(source, { mdx }).rows.map((row) => row.map((piece) => (piece.part ? `${piece.part}:${piece.text}` : piece.text)))

function pagesUnder(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const file = path.join(folder, name)
    if (statSync(file).isDirectory()) return name === 'node_modules' || name.startsWith('.') ? [] : pagesUnder(file)
    return /\.mdx?$/.test(name) ? [file] : []
  })
}

describe('the pieces of a line', () => {
  // The colours are drawn behind the text being typed. A character more or less would put them under the wrong letters.
  it('are the line, character for character, in every page of this repository', () => {
    const files = [...pagesUnder(path.join(REPO, 'docs')), ...pagesUnder(path.join(REPO, 'e2e', 'site')), path.join(REPO, 'README.md'), path.join(REPO, 'ROADMAP.md')]
    expect(files.length).toBeGreaterThan(30)
    let coloured = 0
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      const { rows } = colourSource(source, { mdx: file.endsWith('.mdx') })
      const lines = source.split('\n')
      expect(rows.length, file).toBe(lines.length)
      rows.forEach((row: Piece[], index) => {
        expect(row.map((piece) => piece.text).join(''), `${file}:${index + 1}`).toBe(lines[index])
        expect(row.every((piece) => piece.text !== ''), `${file}:${index + 1}`).toBe(true)
        if (row.some((piece) => piece.part)) coloured++
      })
    }
    // And it found something to colour: the check above would also pass if every line came back plain.
    expect(coloured).toBeGreaterThan(1000)
  })

  it('are the line for text that is not well-formed', () => {
    const odd = ['**', '*', '`', '``` ` ```', '[', '[a](', '[a](b', '![', '<', '<a', '<a b="', '<!--', '-->', '{', '{a', '\\', '\\*', '~~', '~~a', '> ', '>>', '- [', '1.', '|', '---x', '#', '####### x', 'http://', 'a_b_c', '_', '__', '* * *x', '\t- x', '  ']
    for (const line of odd) {
      for (const state of [START, 'yaml', 'comment', '```']) {
        for (const mdx of [false, true]) {
          const { pieces } = colourLine(line, state, { mdx }, state === START)
          expect(pieces.map((piece) => piece.text).join(''), JSON.stringify({ line, state, mdx })).toBe(line)
        }
      }
    }
  })

  it('does not slow down on a line of thousands of brackets and asterisks', () => {
    const line = '[*`<{'.repeat(8000)
    const started = performance.now()
    const { pieces } = colourLine(line, START, { mdx: true })
    expect(pieces.map((piece) => piece.text).join('')).toBe(line)
    expect(performance.now() - started).toBeLessThan(500)
  })
})

describe('frontmatter', () => {
  it('is the block between the two rules at the top, with its keys named', () => {
    expect(readAll('---\ntitle: "A: B" # the title\nbadges: [Beta]\nsidebar:\n  - label: Short\n# a comment\n---\n# After')).toEqual([
      ['mark:---'],
      ['key:title', 'mark::', ' "A: B" ', 'meta:# the title'],
      ['key:badges', 'mark::', ' [Beta]'],
      ['key:sidebar', 'mark::'],
      ['  ', 'mark:- ', 'key:label', 'mark::', ' Short'],
      ['meta:# a comment'],
      ['mark:---'],
      ['mark:#', 'heading: After'],
    ])
  })

  it('is only at the top: a rule further down is a rule', () => {
    expect(readAll('Text\n\n---\ntitle: not a key')).toEqual([['Text'], [], ['mark:---'], ['title: not a key']])
  })

  it('keeps a # inside quotes as part of the value', () => {
    expect(read('colour: "#fff"', { state: 'yaml' })).toEqual(['key:colour', 'mark::', ' "#fff"'])
  })
})

describe('blocks', () => {
  it('names headings, list items, tasks, quotes and callouts by what opens them', () => {
    expect(read('## Hello *world*')).toEqual(['mark:##', 'heading: Hello *world*'])
    expect(read('#hashtag')).toEqual(['#hashtag'])
    expect(read('- [x] done')).toEqual(['mark:-', ' ', 'mark:[x]', ' done'])
    expect(read('  12. twelfth')).toEqual(['  ', 'mark:12.', ' twelfth'])
    expect(read('> [!NOTE] Take care')).toEqual(['mark:>', ' ', 'meta:[!NOTE]', ' Take care'])
    expect(read('> > nested')).toEqual(['mark:>', ' ', 'mark:>', ' nested'])
    expect(read('- - -')).toEqual(['mark:- - -'])
    expect(read('| a | b |')).toEqual(['mark:|', ' a ', 'mark:|', ' b ', 'mark:|'])
  })

  it('does not take a line that starts with emphasis for a list', () => {
    expect(read('*emphasis* first')).toEqual(['mark:*', 'em:emphasis', 'mark:*', ' first'])
    expect(read('**bold** first')).toEqual(['mark:**', 'strong:bold', 'mark:**', ' first'])
  })

  it('reads a code block to the run that closes it, and nothing inside it as Markdown', () => {
    expect(readAll('```ts title="a.ts"\nconst a = *b*\n``\n````\ntext')).toEqual([
      ['mark:```', 'meta:ts title="a.ts"'],
      ['code:const a = *b*'],
      // Two backticks do not close three.
      ['code:``'],
      ['mark:````'],
      ['text'],
    ])
    expect(readAll('~~~\n```\n~~~\n*em*')).toEqual([['mark:~~~'], ['code:```'], ['mark:~~~'], ['mark:*', 'em:em', 'mark:*']])
  })

  it('reads a code block under a list item, indented as far as the item', () => {
    expect(readAll('1. Run it\n\n      ```bash\n      npm i *\n      ```\n   after')).toEqual([
      ['mark:1.', ' Run it'],
      [],
      ['      ', 'mark:```', 'meta:bash'],
      ['code:      npm i *'],
      ['mark:      ```'],
      ['   after'],
    ])
  })

  it('reads an HTML comment over as many lines as it has', () => {
    expect(readAll('a <!-- one\ntwo *x*\nthree --> **b**')).toEqual([
      ['a ', 'meta:<!-- one'],
      ['meta:two *x*'],
      ['meta:three -->', ' ', 'mark:**', 'strong:b', 'mark:**'],
    ])
  })
})

describe('within a line', () => {
  it('names code, emphasis and what a link points at', () => {
    expect(read('Use `npm i` or ``a ` b``.')).toEqual(['Use ', 'mark:`', 'code:npm i', 'mark:`', ' or ', 'mark:``', 'code:a ` b', 'mark:``', '.'])
    expect(read('**bold**, *em*, _em_ and ~~gone~~')).toEqual([
      'mark:**', 'strong:bold', 'mark:**', ', ', 'mark:*', 'em:em', 'mark:*', ', ', 'mark:_', 'em:em', 'mark:_', ' and ', 'mark:~~', 'gone', 'mark:~~',
    ])
    expect(read('See [the **guide**](../guide.md#top) and ![a picture](a.png).')).toEqual([
      // Pieces of one kind that touch are one piece: the `**` that closes and the `](` after it.
      'See ', 'mark:[', 'the ', 'mark:**', 'strong:guide', 'mark:**](', 'link:../guide.md#top', 'mark:)', ' and ', 'mark:![', 'a picture', 'mark:](', 'link:a.png', 'mark:)', '.',
    ])
    expect(read('[text][ref] and [not a link]')).toEqual(['mark:[', 'text', 'mark:][', 'link:ref', 'mark:]', ' and [not a link]'])
  })

  it('leaves alone what only looks like emphasis', () => {
    expect(read('snake_case_name and 2 * 3 * 4')).toEqual(['snake_case_name and 2 * 3 * 4'])
    expect(read('\\*not emphasis\\*')).toEqual(['\\*not emphasis\\*'])
    expect(read('an *unclosed run')).toEqual(['an *unclosed run'])
    // An asterisk in code does not close emphasis that was opened before it.
    expect(read('*a `*` b*')).toEqual(['mark:*', 'em:a ', 'mark:`', 'code:*', 'mark:`', 'em: b', 'mark:*'])
  })

  it('names addresses, with and without brackets', () => {
    expect(read('At <https://example.com> or https://example.com/a?b=1.')).toEqual([
      'At ', 'mark:<', 'link:https://example.com', 'mark:>', ' or ', 'link:https://example.com/a?b=1', '.',
    ])
  })

  it('names tags, their attributes and the values', () => {
    expect(read('<Tab label="One" active>')).toEqual(['mark:<', 'tag:Tab', ' ', 'key:label', 'mark:=', 'code:"One"', ' ', 'key:active', 'mark:>'])
    expect(read('</Tabs> and <Icon name="x" />')).toEqual(['mark:</', 'tag:Tabs', 'mark:>', ' and ', 'mark:<', 'tag:Icon', ' ', 'key:name', 'mark:=', 'code:"x"', ' ', 'mark:/>'])
    expect(read('a Map<string, number> and 1 < 2 > 0')).toEqual(['a Map<string, number> and 1 < 2 > 0'])
  })

  it('reads expressions and imports as code in MDX, and as text in Markdown', () => {
    expect(read('Hello {props.name}!', { mdx: true })).toEqual(['Hello ', 'code:{props.name}', '!'])
    expect(read('Hello {props.name}!')).toEqual(['Hello {props.name}!'])
    expect(read("import Chart from './Chart.tsx'", { mdx: true })).toEqual(["code:import Chart from './Chart.tsx'"])
    expect(read("import Chart from './Chart.tsx'")).toEqual(["import Chart from './Chart.tsx'"])
  })
})

describe('a whole source', () => {
  it('hands back the same list for a line that did not change, so that it is not drawn again', () => {
    const before = colourSource('# Title\n\nOne *line*.\n\nAnother.', { mdx: false })
    const after = colourSource('# Title\n\nOne *line*, changed.\n\nAnother.', { mdx: false }, before)
    expect(after.rows[0]).toBe(before.rows[0])
    expect(after.rows[4]).toBe(before.rows[4])
    expect(after.rows[2]).not.toBe(before.rows[2])
    expect(after.rows[2]!.map((piece) => piece.text).join('')).toBe('One *line*, changed.')
  })

  it('reads a line again when what it is in the middle of changed', () => {
    const before = colourSource('```\n*code*\n```', { mdx: false })
    expect(before.rows[1]).toEqual([{ text: '*code*', part: 'code' }])
    // The first line no longer opens a code block, so the second is emphasis now.
    const after = colourSource('text\n*code*\n```', { mdx: false }, before)
    expect(after.rows[1]).toEqual([{ text: '*', part: 'mark' }, { text: 'code', part: 'em' }, { text: '*', part: 'mark' }])
  })
})
