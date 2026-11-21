/**
 * Where two Studios find each other.
 *
 * Two browsers that are to talk directly (WebRTC) first have to tell each
 * other how they can be reached: one makes an offer, the other answers it.
 * With nowhere to leave those two notes, each is a long code that a person
 * copies to the other by hand.
 *
 * The dev server is somewhere to leave them, for anyone who can reach it.
 * The one who invites leaves their offer here under a name made up for it,
 * and sends the other a link with that name in it. The other's Studio reads
 * the offer from the link and leaves its answer in the same place.
 *
 * Only the two notes pass through here. No draft does: once the browsers
 * have each other's note, they talk to each other and not to this server.
 */
import { randomInt } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

/** How long an invitation waits for its answer. */
export const ROOM_LIFETIME_MS = 10 * 60_000
/** How many invitations may wait at once. A person makes one at a time. */
const MOST_ROOMS = 32
/** A note is a session description with its network candidates: a few thousand characters. */
export const NOTE_LIMIT = 64_000
/** How long a request for the answer is held before it is told to ask again. */
const HELD_MS = 25_000

/** No 0, O, 1 or I: a name can be read out. Twelve of these are sixty bits, which nobody guesses in ten minutes. */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const NAME_LENGTH = 12
const NAME = new RegExp(`^[${ALPHABET}]{${NAME_LENGTH}}$`)

/** What a note is made of: the alphabet of base64, which is how a session description is written down. */
const NOTE = /^[A-Za-z0-9+/=]+$/

interface Room {
  offer: string
  answer?: string
  until: number
  /** Whoever is waiting for the answer. */
  waiting: Set<(answer: string | undefined) => void>
}

export class SignalRooms {
  #rooms = new Map<string, Room>()
  #now: () => number

  constructor(now: () => number = Date.now) {
    this.#now = now
  }

  /** Leave an offer. The name it is left under is what the other person is sent. */
  open(offer: string): string | undefined {
    this.#sweep()
    if (this.#rooms.size >= MOST_ROOMS) return undefined
    let name: string
    do name = Array.from({ length: NAME_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
    while (this.#rooms.has(name))
    this.#rooms.set(name, { offer, until: this.#now() + ROOM_LIFETIME_MS, waiting: new Set() })
    return name
  }

  offer(name: string): string | undefined {
    this.#sweep()
    return this.#rooms.get(name)?.offer
  }

  /** Leave the answer. An invitation is for one person: the first answer is the one it gets. */
  answer(name: string, answer: string): 'taken' | 'gone' | 'answered' {
    this.#sweep()
    const room = this.#rooms.get(name)
    if (!room) return 'gone'
    if (room.answer !== undefined) return 'answered'
    room.answer = answer
    for (const tell of room.waiting) tell(answer)
    room.waiting.clear()
    return 'taken'
  }

  /**
   * The answer, once there is one. `null` when the wait ran out with none yet,
   * and `undefined` when the invitation is gone. An invitation that has given
   * its answer has done what it was for, and is gone too.
   */
  waitForAnswer(name: string, heldMs = HELD_MS): Promise<string | null | undefined> {
    this.#sweep()
    const room = this.#rooms.get(name)
    if (!room) return Promise.resolve(undefined)
    if (room.answer !== undefined) {
      this.#rooms.delete(name)
      return Promise.resolve(room.answer)
    }
    return new Promise((resolve) => {
      const tell = (answer: string | undefined) => {
        clearTimeout(timer)
        if (answer !== undefined) this.#rooms.delete(name)
        resolve(answer)
      }
      const timer = setTimeout(() => {
        room.waiting.delete(tell)
        resolve(this.#rooms.has(name) ? null : undefined)
      }, heldMs)
      // A request that is held does not keep the dev server from stopping.
      timer.unref?.()
      room.waiting.add(tell)
    })
  }

  close(name: string): void {
    const room = this.#rooms.get(name)
    if (!room) return
    this.#rooms.delete(name)
    for (const tell of room.waiting) tell(undefined)
  }

  /** Every invitation, taken back: the dev server is stopping. */
  closeAll(): void {
    for (const name of [...this.#rooms.keys()]) this.close(name)
  }

  #sweep(): void {
    const now = this.#now()
    for (const [name, room] of this.#rooms) if (room.until <= now) this.close(name)
  }
}

export const isNote = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= NOTE_LIMIT && NOTE.test(value)

export interface SignalHandlerOptions {
  rooms: SignalRooms
  /** Is the request from a page this server sent, with the token such a page is given? Opening an invitation takes that. */
  ownStudio(req: IncomingMessage): boolean
  /** Where this server can be reached: `http://192.168.1.5:4321/` and the like, each ending in the site's base. */
  addresses(): { local: string[]; network: string[] }
  readBody(req: IncomingMessage): Promise<string>
}

/**
 * The routes under `/_shabd/studio/signal`. `rest` is what follows that in the
 * address: empty, a name, or a name and `/answer`.
 *
 *   POST   signal                 the Studio of this server leaves an offer   → { room, local, network }
 *   GET    signal/<room>          anyone with the name reads the offer         → { offer }
 *   POST   signal/<room>          and leaves the answer, as the request's text → 204
 *   GET    signal/<room>/answer   the Studio of this server waits for it       → { answer }, or 204 to ask again
 *   DELETE signal/<room>          and takes the invitation back                → 204
 *
 * The two in the middle are for the other person's Studio, which another dev
 * server sent: they are open to a page of any site. What such a page can do
 * with them is read an offer whose name it was given, and answer it.
 */
export async function handleSignal(req: IncomingMessage, res: ServerResponse, rest: string, options: SignalHandlerOptions): Promise<void> {
  const { rooms } = options
  const method = req.method ?? 'GET'
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => {
    res.statusCode = status
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value)
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify(body))
  }
  const empty = (status: number, headers: Record<string, string> = {}) => {
    res.statusCode = status
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value)
    res.setHeader('Cache-Control', 'no-store')
    res.end()
  }
  const refused = () => json({ error: 'An invitation is made, waited on and taken back by the Studio of this site.' }, 403)

  if (rest === '') {
    if (method !== 'POST') return json({ error: 'Not found.' }, 404)
    if (!options.ownStudio(req)) return refused()
    let offer: unknown
    try {
      offer = (JSON.parse(await options.readBody(req)) as { offer?: unknown }).offer
    } catch {
      offer = undefined
    }
    if (!isNote(offer)) return json({ error: 'Expected { offer }.' }, 400)
    const room = rooms.open(offer)
    if (!room) return json({ error: 'Too many invitations are waiting. Take one back, or wait for one to run out.' }, 429)
    return json({ room, ...options.addresses() }, 201)
  }

  const [name = '', part, ...more] = rest.split('/')
  if (!NAME.test(name) || more.length > 0) return json({ error: 'Not found.' }, 404)

  if (part === 'answer') {
    if (method !== 'GET') return json({ error: 'Not found.' }, 404)
    if (!options.ownStudio(req)) return refused()
    const answer = await rooms.waitForAnswer(name)
    if (answer === undefined) return json({ error: 'This invitation has run out, or was taken back.' }, 404)
    return answer === null ? empty(204) : json({ answer })
  }
  if (part !== undefined) return json({ error: 'Not found.' }, 404)

  if (method === 'DELETE') {
    if (!options.ownStudio(req)) return refused()
    rooms.close(name)
    return empty(204)
  }

  // From here on, a page of any site may ask: the other person's Studio is one.
  const open = { 'Access-Control-Allow-Origin': '*' }
  if (method === 'OPTIONS') {
    return empty(204, { ...open, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Max-Age': '600' })
  }
  if (method === 'GET') {
    const offer = rooms.offer(name)
    return offer === undefined ? json({ error: 'This invitation has run out, or was taken back. Ask for a new one.' }, 404, open) : json({ offer }, 200, open)
  }
  if (method === 'POST') {
    // Too long to be an answer is refused while it is read. It is told so here, where a page of any site may hear it.
    const answer = await options.readBody(req).then(
      (text) => text.trim(),
      () => undefined,
    )
    if (!isNote(answer)) return json({ error: 'Expected the answer as the text of the request.' }, 400, open)
    const result = rooms.answer(name, answer)
    if (result === 'gone') return json({ error: 'This invitation has run out, or was taken back. Ask for a new one.' }, 404, open)
    if (result === 'answered') return json({ error: 'Someone has answered this invitation already. Ask for a new one.' }, 409, open)
    return empty(204, open)
  }
  return json({ error: 'Not found.' }, 404, open)
}
