/**
 * A page's text shared between editors (src/client/studio/draft.ts): what
 * two people type at once is both kept, and editors that begin with
 * documents of their own end up holding one.
 *
 * The editors here are strings, and the network is a queue that is run when
 * the test says so. Messages are in flight until then, which is how two
 * things are made to happen at the same time.
 */
import { describe, expect, it } from 'vitest'
import type { Replacement } from '../src/client/editor/text.js'
import { fromBase64, SharedDraft, toBase64, yields, type DraftMessage, type DraftMeta, type Link } from '../src/client/studio/draft.js'

interface Delivery {
  message: DraftMessage
  to: Editor
  by: Link
}

class Net {
  queue: Delivery[] = []
  /** Messages delivered, by their kind: to see that editors do not talk without end. */
  count = 0
  /** Deliver everything in flight, and what that sets off, until it is quiet. */
  run(): void {
    let limit = 2000
    while (this.queue.length > 0) {
      if (limit-- === 0) throw new Error('the editors did not stop talking')
      const { message, to, by } = this.queue.shift()!
      this.count++
      to.draft.receive(message, by)
    }
  }
  /** Lose what is in flight. */
  drop(): void {
    this.queue = []
  }
}

/** Editors that hear one another: the tabs of a browser, or two people. */
class Bus {
  members: Editor[] = []
  constructor(
    readonly name: Link,
    readonly net: Net,
  ) {}
  post(message: DraftMessage, from: Editor): void {
    for (const to of this.members) if (to !== from) this.net.queue.push({ message, to, by: this.name })
  }
}

let clock = 1000

class Editor {
  /** What is on screen: changed only as the draft says it changed, the way the Studio changes its editor. */
  screen: string
  draft: SharedDraft
  unsaved = false
  links: Bus[] = []

  constructor(
    readonly name: string,
    source: string,
  ) {
    this.screen = source
    this.draft = this.#begin(source)
  }

  #begin(source: string, replacing?: SharedDraft): SharedDraft {
    return new SharedDraft({
      page: 'guide/intro.md',
      source,
      peer: this.name,
      replacing,
      now: () => clock++,
      unsaved: () => this.unsaved,
      send: (message, where) => {
        for (const bus of this.links) {
          if ('only' in where ? bus.name === where.only : bus.name !== where.except) bus.post(message, this)
        }
      },
      changed: (changes, text) => {
        this.screen = applied(this.screen, changes)
        // The changes an editor is given must add up to the text it is told there is.
        expect(this.screen, `${this.name}: changes that do not make the text`).toBe(text)
      },
    })
  }

  join(bus: Bus): this {
    this.links.push(bus)
    bus.members.push(this)
    this.draft.greet(bus.name)
    return this
  }

  /** Type: put `insert` in place of what is from `from` to `to`. */
  type(from: number, insert: string, to = from): void {
    const change = { from, to, insert }
    this.screen = applied(this.screen, [change])
    this.draft.typed([change], this.screen)
  }

  /** The file changed on disk and was read again. */
  reload(source: string): void {
    this.screen = source
    this.draft = this.#begin(source, this.draft)
    this.draft.greet()
  }
}

/** Changes made to a text, each given by where the text was before any of them. */
function applied(text: string, changes: readonly Replacement[]): string {
  let out = text
  for (const change of [...changes].sort((a, b) => b.from - a.from)) out = out.slice(0, change.from) + change.insert + out.slice(change.to)
  return out
}

function together(source: string, ...names: string[]): { net: Net; bus: Bus; editors: Editor[] } {
  const net = new Net()
  const bus = new Bus('tabs', net)
  const editors = names.map((name) => new Editor(name, source).join(bus))
  net.run()
  return { net, bus, editors }
}

const agree = (...editors: Editor[]) => {
  for (const editor of editors) {
    expect(editor.draft.text, `${editor.name} holds`).toBe(editors[0]!.draft.text)
    expect(editor.screen, `${editor.name} shows`).toBe(editor.draft.text)
    expect(editor.draft.meta.draft, `${editor.name}'s document`).toBe(editors[0]!.draft.meta.draft)
  }
}

describe('a draft shared by two editors', () => {
  it('keeps what both type at the same moment, each where it was typed', () => {
    const { net, editors } = together('The quick fox jumps.\n', 'a', 'b')
    const [a, b] = editors as [Editor, Editor]
    agree(a, b)

    // Both type before either has heard from the other.
    a.type(4, 'very ')
    b.type(19, ' high')
    expect(a.screen).toBe('The very quick fox jumps.\n')
    expect(b.screen).toBe('The quick fox jumps high.\n')
    net.run()
    agree(a, b)
    expect(a.screen).toBe('The very quick fox jumps high.\n')
  })

  it('keeps both of two words typed at the same place, in the same order on both sides', () => {
    const { net, editors } = together('ab', 'a', 'b')
    const [a, b] = editors as [Editor, Editor]
    a.type(1, 'XX')
    b.type(1, 'yy')
    net.run()
    agree(a, b)
    expect(['aXXyyb', 'ayyXXb']).toContain(a.screen)
  })

  it('agrees when one deletes what the other is typing in, and when both delete the same', () => {
    const { net, editors } = together('one two three four', 'a', 'b')
    const [a, b] = editors as [Editor, Editor]
    a.type(4, '', 13)
    b.type(7, '!')
    net.run()
    agree(a, b)
    // The word typed into the deleted part is not lost with it.
    expect(a.screen).toBe('one ! four')

    a.type(0, '', 4)
    b.type(0, '', 5)
    net.run()
    agree(a, b)
    expect(a.screen).toBe(' four')
  })

  it('counts a character outside the basic plane as the two units an editor counts it as', () => {
    const { net, editors } = together('snow', 'a', 'b')
    const [a, b] = editors as [Editor, Editor]
    a.type(4, ' ☃️😀')
    net.run()
    b.type(b.screen.length, '!')
    a.type(0, '🙂 ')
    net.run()
    agree(a, b)
    expect(a.screen).toBe('🙂 snow ☃️😀!')
  })

  it('makes up the difference when it is not told what was typed, or is told wrongly', () => {
    const { net, editors } = together('first line\nsecond line\n', 'a', 'b')
    const [a, b] = editors as [Editor, Editor]
    a.screen = 'first line\nA new line\nsecond line\n'
    a.draft.typed(undefined, a.screen)
    net.run()
    agree(a, b)
    // Changes that do not fit the text, or do not add up to it.
    b.screen = 'first line\nA new line\nsecond line, longer\n'
    b.draft.typed([{ from: 900, to: 901, insert: 'x' }], b.screen)
    net.run()
    agree(a, b)
    a.screen = 'First line\nA new line\nsecond line, longer\n'
    a.draft.typed([{ from: 3, to: 3, insert: 'not what happened' }], a.screen)
    net.run()
    agree(a, b)
    expect(b.screen).toBe('First line\nA new line\nsecond line, longer\n')
  })

  it('says nothing when nothing was typed', () => {
    const { net, editors } = together('same', 'a', 'b')
    const before = net.count
    editors[0]!.draft.typed([], 'same')
    editors[0]!.draft.typed(undefined, 'same')
    net.run()
    expect(net.count).toBe(before)
    expect(editors[0]!.draft.meta.edited).toBe(false)
  })
})

describe('editors that begin with documents of their own', () => {
  it('end up with one, and the page opened a moment ago takes the one that was there', () => {
    const net = new Net()
    const bus = new Bus('tabs', net)
    const first = new Editor('first', 'Saved text.').join(bus)
    net.run()
    first.type(11, ' And a draft.')
    net.run()
    // The second editor opens the page from the file, which does not have the draft yet.
    const second = new Editor('second', 'Saved text.').join(bus)
    expect(second.draft.meta.draft).not.toBe(first.draft.meta.draft)
    net.run()
    agree(first, second)
    expect(second.screen).toBe('Saved text. And a draft.')

    // From then on what both type is kept.
    first.type(0, '> ')
    second.type(second.screen.length, ' More.')
    net.run()
    agree(first, second)
    expect(first.screen).toBe('> Saved text. And a draft. More.')
  })

  it('keep the one that has been typed in over one that has not, whichever was opened first', () => {
    const net = new Net()
    const bus = new Bus('peer', net)
    const older = new Editor('older', 'Text on one machine.')
    const younger = new Editor('younger', 'Text on the other machine.')
    younger.type(0, 'Edited: ')
    older.join(bus)
    younger.join(bus)
    net.run()
    agree(older, younger)
    expect(older.screen).toBe('Edited: Text on the other machine.')
  })

  it('keep the one opened first when both have been typed in, and say so the same way on both sides', () => {
    const net = new Net()
    const bus = new Bus('peer', net)
    const host = new Editor('host', 'The host has this.')
    const guest = new Editor('guest', 'The guest has that.')
    host.type(0, '1 ')
    guest.type(0, '2 ')
    guest.join(bus)
    host.join(bus)
    net.run()
    agree(host, guest)
    expect(guest.screen).toBe('1 The host has this.')
  })

  it('hold the same text already more often than not, and then nothing on screen changes', () => {
    const net = new Net()
    const bus = new Bus('tabs', net)
    const a = new Editor('a', 'The same file.').join(bus)
    const b = new Editor('b', 'The same file.').join(bus)
    let changed = 0
    for (const editor of [a, b]) {
      const screen = editor.screen
      Object.defineProperty(editor, 'screen', { get: () => screen, set: () => changed++ })
    }
    net.run()
    expect(a.draft.meta.draft).toBe(b.draft.meta.draft)
    expect(changed).toBe(0)
  })

  it('decide which of two is kept so that exactly one of them gives way', () => {
    const metas: DraftMeta[] = []
    for (const edited of [false, true]) for (const born of [1, 2]) for (const draft of ['a', 'b']) metas.push({ draft: `${draft}${born}${edited}`, born, edited, replaces: [] })
    for (const mine of metas) {
      for (const theirs of metas) {
        if (mine === theirs) continue
        expect(yields(mine, theirs, false), `${mine.draft} and ${theirs.draft}`).toBe(!yields(theirs, mine, false))
      }
    }
    // A document read again from the file takes the place of the one it was begun from, typed in or not.
    const old: DraftMeta = { draft: 'old', born: 1, edited: true, replaces: [] }
    const read: DraftMeta = { draft: 'read', born: 9, edited: false, replaces: ['mid', 'old'] }
    expect(yields(old, read, false)).toBe(true)
    expect(yields(read, old, false)).toBe(false)
    // Not while something typed in the old one is unsaved.
    expect(yields(old, read, true)).toBe(false)
  })
})

describe('a file that changes on disk', () => {
  it('is read again by one editor, and the others take what it read', () => {
    const { net, editors } = together('Before the pull.', 'a', 'b')
    const [a, b] = editors as [Editor, Editor]
    a.type(0, 'Typed. ')
    net.run()
    agree(a, b)
    a.reload('After the pull.')
    net.run()
    agree(a, b)
    expect(b.screen).toBe('After the pull.')
  })

  it('is read again by every editor that saves to it, and they agree without saying it twice', () => {
    const { net, editors } = together('Before.', 'a', 'b', 'c')
    const [a, b, c] = editors as [Editor, Editor, Editor]
    a.reload('After.')
    b.reload('After.')
    c.reload('After.')
    net.run()
    agree(a, b, c)
    expect(a.screen).toBe('After.')
  })

  it('does not take away what is typed and unsaved in another editor, until that is saved', () => {
    const { net, editors } = together('Before.', 'a', 'b')
    const [a, b] = editors as [Editor, Editor]
    b.type(7, ' Being typed.')
    b.unsaved = true
    net.run()
    a.reload('After.')
    net.run()
    // Each keeps its own for now: one has the file, the other has what was typed.
    expect(a.screen).toBe('After.')
    expect(b.screen).toBe('Before. Being typed.')

    b.unsaved = false
    b.draft.settled()
    net.run()
    agree(a, b)
    expect(b.screen).toBe('After.')
  })

  it('leaves the old document behind: a change to it that arrives late is not put into the new one', () => {
    const { net, editors } = together('Before.', 'a', 'b')
    const [a, b] = editors as [Editor, Editor]
    b.type(0, 'Late. ')
    // The change is in flight when the file is read again.
    a.reload('After.')
    net.run()
    agree(a, b)
    expect(a.screen).toBe('After.')
  })
})

describe('three editors on two links', () => {
  /** Two tabs of one browser, and another person connected to the first of them. */
  function three(tabSource: string, peerSource: string) {
    const net = new Net()
    const tabs = new Bus('tabs', net)
    const peers = new Bus('peer', net)
    const first = new Editor('first tab', tabSource).join(tabs)
    const second = new Editor('second tab', tabSource).join(tabs)
    net.run()
    const other = new Editor('other person', peerSource)
    return { net, tabs, peers, first, second, other }
  }

  it('pass on what is typed, in both directions', () => {
    const { net, peers, first, second, other } = three('Shared.', 'Shared.')
    first.join(peers)
    other.join(peers)
    net.run()
    agree(first, second, other)

    other.type(7, ' From the other person.')
    second.type(0, 'From the second tab. ')
    net.run()
    agree(first, second, other)
    expect(first.screen).toBe('From the second tab. Shared. From the other person.')
  })

  it('all take the document that is kept, whichever link it came by', () => {
    const { net, peers, first, second, other } = three('What the tabs have.', 'What the other person typed.')
    other.type(0, '* ')
    first.join(peers)
    other.join(peers)
    net.run()
    agree(first, second, other)
    expect(second.screen).toBe('* What the other person typed.')

    // And the other way: the tabs' is the one typed in.
    const again = three('What the tabs have.', 'What the other person has.')
    again.second.type(0, '* ')
    again.net.run()
    again.first.join(again.peers)
    again.other.join(again.peers)
    again.net.run()
    agree(again.first, again.second, again.other)
    expect(again.other.screen).toBe('* What the tabs have.')
  })
})

describe('messages', () => {
  it('for another page, or addressed to another editor, are not acted on', () => {
    const { net, editors } = together('Text.', 'a', 'b')
    const [a, b] = editors as [Editor, Editor]
    const before = a.draft.meta
    const whole = { type: 'whole', page: 'guide/other.md', peer: 'b', draft: 'zzz', born: 0, edited: true, replaces: [], update: '' } as DraftMessage
    a.draft.receive(whole, 'tabs')
    a.draft.receive({ ...whole, page: 'guide/intro.md', to: 'someone-else' } as DraftMessage, 'tabs')
    // Its own words coming back down a link are not news either.
    a.draft.receive({ ...whole, page: 'guide/intro.md', peer: 'a' } as DraftMessage, 'tabs')
    net.run()
    expect(a.draft.meta).toEqual(before)
    agree(a, b)
  })

  it('that are lost are made up for the next time something arrives', () => {
    const { net, editors } = together('0123456789', 'a', 'b')
    const [a, b] = editors as [Editor, Editor]
    a.type(10, ' first')
    net.drop()
    a.type(16, ' second')
    net.run()
    agree(a, b)
    expect(b.screen).toBe('0123456789 first second')
  })

  it('carry a long page as text and get it back byte for byte', () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, index) => (index * 31) % 256)
    expect(fromBase64(toBase64(bytes))).toEqual(bytes)
    expect(toBase64(new Uint8Array())).toBe('')
  })

  it('do not go round without end between editors that will not take each other\'s document', () => {
    const { net, editors } = together('Before.', 'a', 'b')
    const [a, b] = editors as [Editor, Editor]
    b.type(0, 'x')
    b.unsaved = true
    net.run()
    a.reload('After.')
    net.run()
    const quiet = net.count
    // What the one with unsaved text types is still told, and answered once.
    b.type(0, 'y')
    net.run()
    expect(net.count - quiet).toBeLessThan(6)
  })
})
