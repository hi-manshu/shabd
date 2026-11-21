/**
 * The text of a page while it is being edited, in a form that several
 * editors can change at once.
 *
 * The text is a Yjs document (a CRDT). What is typed in one editor is sent
 * to the others as the change it was, not as the whole text, and changes
 * made at the same moment in two editors are both kept: each lands where its
 * author put it, whatever the other did meanwhile.
 *
 * That only works between editors that hold the same document. Each editor
 * begins one of its own from the file it read, so when two meet, one of them
 * takes the other's. Which one is decided the same way on both sides:
 *
 *   - A document that was begun because the file was read again (it changed
 *     on disk) takes the place of the one it was begun from, in every editor
 *     that has nothing unsaved in the old one.
 *   - Otherwise one that has been typed in is kept over one that has not.
 *   - Between two alike, the one that was begun first is kept.
 *
 * The editor that gives its own up loses what only it had. That is a page
 * opened a moment ago, in all but one case: two people who had each typed in
 * the page before they connected. Then the text of the one who opened the
 * page first replaces the other's.
 *
 * Nothing here touches the page, the editor or the network, so it is tested
 * without a browser. The Studio hands it what is typed and what arrives, and
 * is told what to send and what to change in the editor.
 */
import * as Y from 'yjs'
import { replacement, type Replacement } from '../editor/text.js'

/** What one document is told apart from another by, and what decides which of two is kept. */
export interface DraftMeta {
  /** Which document this is. Editors that have taken it from one another hold the same. */
  draft: string
  /** When it was begun, by the clock of the editor that began it. */
  born: number
  /** Whether anything has been typed in it since it was begun from a file. */
  edited: boolean
  /** The documents it took the place of when a file was read again, the last one first. */
  replaces: string[]
}

interface Addressed {
  page: string
  /** The editor that sent it. */
  peer: string
  /** The one editor it is for. Left out, it is for every editor on the link. */
  to?: string
}

export type DraftMessage =
  /** "This is the document I hold of this page, and how much of it I have." */
  | (Addressed & DraftMeta & { type: 'hello'; vector: string; reply?: true })
  /** A change to a document, or the part of it that the editor it is sent to lacks. */
  | (Addressed & { type: 'update'; draft: string; update: string })
  /** A document entire, for an editor that is to take it in place of its own. */
  | (Addressed & DraftMeta & { type: 'whole'; update: string })

const KINDS: ReadonlySet<unknown> = new Set(['hello', 'update', 'whole'])
const isText = (value: unknown): value is string => typeof value === 'string'

/** Is this something an editor may have sent? What arrives from another browser is looked at before it is used. */
export function isDraftMessage(value: unknown): value is DraftMessage {
  if (typeof value !== 'object' || value === null) return false
  const message = value as Record<string, unknown>
  if (!KINDS.has(message.type) || !isText(message.page) || !isText(message.peer) || !isText(message.draft)) return false
  if (message.to !== undefined && !isText(message.to)) return false
  if (message.type === 'update') return isText(message.update)
  if (!isText(message.type === 'hello' ? message.vector : message.update)) return false
  return typeof message.born === 'number' && typeof message.edited === 'boolean' && Array.isArray(message.replaces) && message.replaces.every(isText)
}

/** A way to other editors: the tabs of this browser, or another person's browser. */
export type Link = string

export interface DraftOptions {
  page: string
  /** The file's text, its lines ending in a line feed. */
  source: string
  /** This editor, among the others. */
  peer: string
  /** The draft this one takes the place of: the same page, whose file was read again. */
  replacing?: SharedDraft | undefined
  /** Send a message: to every link but `except`, or down the one link `only`. */
  send(message: DraftMessage, where: { only: Link } | { except?: Link | undefined }): void
  /**
   * Other editors changed the text. `changes` say how, each by where the text
   * was before any of them, and `text` is what it is now.
   */
  changed(changes: Replacement[], text: string): void
  /** Is something typed here not yet in the file? While it is, this editor's document is not given up for the file's. */
  unsaved(): boolean
  now?: () => number
}

/** How many documents back one remembers having taken the place of. A file is not read again that often between two saves. */
const MOST_REPLACED = 8
/** The one text in the document. */
const TEXT = 'page'

const makeId = () => Math.random().toString(36).slice(2, 12)

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  // In pieces: the arguments of one call are limited, and a long page is longer than the limit.
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  return btoa(binary)
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at)
  return bytes
}

/** Is `mine` given up for `theirs`? Both editors ask this of the same two, and get opposite answers. */
export function yields(mine: DraftMeta, theirs: DraftMeta, unsaved: boolean): boolean {
  // The file was read again, and theirs is what was read. What is typed here and not saved is not thrown away for it.
  if (theirs.replaces.includes(mine.draft)) return !unsaved
  if (mine.replaces.includes(theirs.draft)) return false
  if (mine.edited !== theirs.edited) return theirs.edited
  if (mine.born !== theirs.born) return theirs.born < mine.born
  return theirs.draft < mine.draft
}

/** Changes that touch are made into one: an editor takes a list of changes that do not overlap. */
function joined(changes: Replacement[]): Replacement[] {
  const out: Replacement[] = []
  for (const change of changes) {
    const last = out.at(-1)
    if (last && last.to >= change.from) {
      last.to = Math.max(last.to, change.to)
      last.insert += change.insert
    } else out.push({ ...change })
  }
  return out
}

export class SharedDraft {
  readonly page: string
  #options: DraftOptions
  #doc: Y.Doc
  #text: Y.Text
  #meta: DraftMeta
  /** Another editor holds a document this one would not take, and that editor would not take this one. Asked again once saved. */
  #waiting = false

  constructor(options: DraftOptions) {
    this.#options = options
    this.page = options.page
    this.#doc = new Y.Doc()
    this.#text = this.#doc.getText(TEXT)
    this.#text.insert(0, options.source)
    const replaced = options.replacing?.meta
    this.#meta = {
      draft: makeId(),
      born: (options.now ?? Date.now)(),
      edited: false,
      replaces: replaced ? [replaced.draft, ...replaced.replaces].slice(0, MOST_REPLACED) : [],
    }
  }

  get text(): string {
    return this.#text.toString()
  }

  get meta(): DraftMeta {
    return { ...this.#meta, replaces: [...this.#meta.replaces] }
  }

  /**
   * Something was typed here. `changes` is what the editor did, each change
   * by where the text was before any of them; `text` is what the text is now.
   * Left without changes, the difference from what the text was is worked out.
   */
  typed(changes: readonly Replacement[] | undefined, text: string): void {
    const update = this.#transact(() => {
      const length = this.#text.length
      // Changes that do not fit the text held here were made to another text. The difference is worked out instead.
      const fitting = (changes ?? []).every((change) => change.from >= 0 && change.from <= change.to && change.to <= length) ? (changes ?? []) : []
      // From the last to the first, so that none moves the place of another.
      for (const change of [...fitting].sort((a, b) => b.from - a.from)) this.#replace(change)
      // The editor's word for what the text is now is the last one. Changes that do not add up to it are made up for.
      const now = this.#text.toString()
      if (now !== text) this.#replace(replacement(now, text))
    })
    if (!update) return
    this.#meta.edited = true
    this.#send({ type: 'update', draft: this.#meta.draft, update: toBase64(update) }, {})
  }

  /** Tell the editors on a link, or on every link, which document is held here. They answer with what is missing, either way. */
  greet(only?: Link, to?: string, reply = false): void {
    this.#send(
      { type: 'hello', ...this.meta, vector: toBase64(Y.encodeStateVector(this.#doc)), ...(reply ? { reply: true as const } : {}), ...(to ? { to } : {}) },
      only === undefined ? {} : { only },
    )
  }

  /** What was typed here has been saved. An editor that was waiting for that is asked again. */
  settled(): void {
    if (!this.#waiting) return
    this.#waiting = false
    this.greet()
  }

  /** A message from another editor. One that cannot be read is dropped: what it carries is not text an editor wrote. */
  receive(message: DraftMessage, from: Link): void {
    if (message.page !== this.page || message.peer === this.#options.peer) return
    if (message.to !== undefined && message.to !== this.#options.peer) return
    try {
      this.#receive(message, from)
    } catch {
      // Not a change this document can take.
    }
  }

  #receive(message: DraftMessage, from: Link): void {
    const same = message.draft === this.#meta.draft

    if (message.type === 'update') {
      if (same) this.#take(fromBase64(message.update), from, message.peer)
      // A change to a document that is not the one held here: the two editors are not in step, and say what they hold.
      else this.greet(from, message.peer)
      return
    }

    if (message.type === 'hello') {
      if (same) {
        // What they lack of it. Deletions are not counted in what they said they have, so this is sent whatever they said.
        const lacking = Y.encodeStateAsUpdate(this.#doc, fromBase64(message.vector))
        this.#send({ type: 'update', draft: this.#meta.draft, update: toBase64(lacking), to: message.peer }, { only: from })
        // And they are asked for what is lacking here, unless this is their answer to being asked.
        if (!message.reply) this.greet(from, message.peer, true)
      } else if (this.#yieldsTo(message)) {
        // Theirs is the one to keep: they are told what is held here, and send theirs for it.
        if (!message.reply) this.greet(from, message.peer, true)
      } else {
        this.#send({ type: 'whole', ...this.meta, update: toBase64(Y.encodeStateAsUpdate(this.#doc)), to: message.peer }, { only: from })
      }
      return
    }

    // A whole document.
    if (same) {
      this.#take(fromBase64(message.update), from, message.peer)
      return
    }
    if (!this.#yieldsTo(message)) return
    const before = this.text
    const doc = new Y.Doc()
    Y.applyUpdate(doc, fromBase64(message.update))
    this.#doc.destroy()
    this.#doc = doc
    this.#text = doc.getText(TEXT)
    this.#meta = { draft: message.draft, born: message.born, edited: message.edited, replaces: [...message.replaces] }
    this.#waiting = false
    const after = this.text
    if (after !== before) this.#options.changed([replacement(before, after)], after)
    // The editors on the other links held what was held here. They are told what is held now.
    this.#send({ type: 'hello', ...this.meta, vector: toBase64(Y.encodeStateVector(this.#doc)) }, { except: from })
  }

  #yieldsTo(theirs: DraftMeta): boolean {
    const unsaved = this.#options.unsaved()
    const gives = yields(this.#meta, theirs, unsaved)
    // Theirs would be taken but for what is unsaved here. Once that is saved, they are asked again.
    if (!gives && unsaved && theirs.replaces.includes(this.#meta.draft)) this.#waiting = true
    return gives
  }

  /** Take a change that another editor made, tell the editor here what it did to the text, and pass it on. */
  #take(update: Uint8Array, from: Link, sender: string): void {
    const changes: Replacement[] = []
    const news: Uint8Array[] = []
    const observe = (event: Y.YTextEvent) => {
      let at = 0
      for (const part of event.delta) {
        if (part.retain !== undefined) at += part.retain
        else if (part.delete !== undefined) {
          changes.push({ from: at, to: at + part.delete, insert: '' })
          at += part.delete
        } else if (typeof part.insert === 'string') changes.push({ from: at, to: at, insert: part.insert })
      }
    }
    const heard = (made: Uint8Array) => news.push(made)
    this.#text.observe(observe)
    this.#doc.on('update', heard)
    try {
      Y.applyUpdate(this.#doc, update, 'remote')
    } finally {
      this.#text.unobserve(observe)
      this.#doc.off('update', heard)
    }
    // Part of it rests on changes that have not arrived: the editor it came from is asked for what is missing.
    if (this.#doc.store.pendingStructs) this.greet(from, sender)
    if (news.length === 0) return
    if (changes.length > 0) this.#options.changed(joined(changes), this.text)
    // What was news here is news to the editors on the other links.
    const made = news.length === 1 ? news[0]! : Y.mergeUpdates(news)
    this.#send({ type: 'update', draft: this.#meta.draft, update: toBase64(made) }, { except: from })
  }

  #replace(change: Replacement): void {
    if (change.to > change.from) this.#text.delete(change.from, change.to - change.from)
    if (change.insert) this.#text.insert(change.from, change.insert)
  }

  /** Make changes to the document, and get them back in the form they are sent in. Nothing, if nothing changed. */
  #transact(run: () => void): Uint8Array | null {
    const made: Uint8Array[] = []
    const heard = (update: Uint8Array) => made.push(update)
    this.#doc.on('update', heard)
    try {
      this.#doc.transact(run)
    } finally {
      this.#doc.off('update', heard)
    }
    return made.length === 0 ? null : made.length === 1 ? made[0]! : Y.mergeUpdates(made)
  }

  #send(message: DistributiveOmit<DraftMessage, 'page' | 'peer'>, where: { only: Link } | { except?: Link | undefined }): void {
    this.#options.send({ ...message, page: this.page, peer: this.#options.peer } as DraftMessage, where)
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
