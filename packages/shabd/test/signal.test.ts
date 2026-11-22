/**
 * Where two Studios find each other (src/node/vite/signal.ts): an offer is
 * left under a name, read by whoever is sent the name, and answered once.
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { readBody } from '../src/node/http.js'
import { handleSignal, isNote, NOTE_LIMIT, ROOM_LIFETIME_MS, SignalRooms } from '../src/node/vite/signal.js'

const OFFER = Buffer.from(JSON.stringify({ type: 'offer', sdp: 'v=0' })).toString('base64')
const ANSWER = Buffer.from(JSON.stringify({ type: 'answer', sdp: 'v=0' })).toString('base64')

describe('invitations', () => {
  it('keep an offer under a name nobody would guess, and give it to whoever has the name', () => {
    const rooms = new SignalRooms()
    const name = rooms.open(OFFER)!
    expect(name).toMatch(/^[2-9A-HJ-NP-Z]{12}$/)
    expect(rooms.offer(name)).toBe(OFFER)
    expect(rooms.offer('AAAAAAAAAAAA')).toBeUndefined()
    expect(rooms.open(OFFER)).not.toBe(name)
  })

  it('take one answer, and hand it to whoever waits for it', async () => {
    const rooms = new SignalRooms()
    const name = rooms.open(OFFER)!
    const waiting = rooms.waitForAnswer(name, 5000)
    expect(rooms.answer(name, ANSWER)).toBe('taken')
    expect(await waiting).toBe(ANSWER)
    // An invitation that has given its answer has done what it was for.
    expect(rooms.offer(name)).toBeUndefined()
    expect(rooms.answer(name, ANSWER)).toBe('gone')
    expect(await rooms.waitForAnswer(name, 10)).toBeUndefined()

    // An answer that came before anyone waited is there when they do, and a second one is turned away.
    const other = rooms.open(OFFER)!
    expect(rooms.answer(other, ANSWER)).toBe('taken')
    expect(rooms.answer(other, OFFER)).toBe('answered')
    expect(await rooms.waitForAnswer(other, 10)).toBe(ANSWER)
  })

  it('say that there is no answer yet, so that the one waiting asks again', async () => {
    const rooms = new SignalRooms()
    const name = rooms.open(OFFER)!
    expect(await rooms.waitForAnswer(name, 10)).toBeNull()
    expect(rooms.offer(name)).toBe(OFFER)
  })

  it('run out, and are gone for whoever waits when they are taken back', async () => {
    let now = 1_000
    const rooms = new SignalRooms(() => now)
    const name = rooms.open(OFFER)!
    now += ROOM_LIFETIME_MS - 1
    expect(rooms.offer(name)).toBe(OFFER)
    now += 1
    expect(rooms.offer(name)).toBeUndefined()
    expect(rooms.answer(name, ANSWER)).toBe('gone')

    const taken = rooms.open(OFFER)!
    const waiting = rooms.waitForAnswer(taken, 5000)
    rooms.close(taken)
    expect(await waiting).toBeUndefined()
  })

  it('are not kept without end', () => {
    const rooms = new SignalRooms()
    const names = Array.from({ length: 40 }, () => rooms.open(OFFER))
    expect(names.filter((name) => name !== undefined)).toHaveLength(32)
    // One that is taken back makes room for another.
    rooms.close(names[0]!)
    expect(rooms.open(OFFER)).toBeDefined()
  })

  it('take a note for what it is: base64, and not without end', () => {
    expect(isNote(OFFER)).toBe(true)
    expect(isNote('')).toBe(false)
    expect(isNote('<script>')).toBe(false)
    expect(isNote({ offer: OFFER })).toBe(false)
    expect(isNote('A'.repeat(NOTE_LIMIT))).toBe(true)
    expect(isNote('A'.repeat(NOTE_LIMIT + 1))).toBe(false)
  })
})

describe('the routes two Studios find each other by', () => {
  let server: Server | undefined
  afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())))

  /** A server with the routes on it. A request with the header `x-own` is taken for the Studio of this site. */
  async function serve(): Promise<string> {
    const rooms = new SignalRooms()
    server = createServer((req, res) => {
      const rest = (req.url ?? '').replace(/^\/signal\/?/, '')
      void handleSignal(req, res, rest, {
        rooms,
        ownStudio: (request) => request.headers['x-own'] === 'yes',
        addresses: () => ({ local: ['http://localhost:4321/'], network: ['http://192.168.1.5:4321/'] }),
        readBody: (request) => readBody(request, NOTE_LIMIT + 1024),
      })
    })
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}/signal`
  }
  const own = { 'x-own': 'yes' }

  it('carry an offer one way and its answer the other', async () => {
    const at = await serve()
    const opened = await fetch(at, { method: 'POST', headers: own, body: JSON.stringify({ offer: OFFER }) })
    expect(opened.status).toBe(201)
    const { room, local, network } = (await opened.json()) as { room: string; local: string[]; network: string[] }
    // Where the other person can reach this server is told with it: a link is made of that and the name.
    expect({ local, network }).toEqual({ local: ['http://localhost:4321/'], network: ['http://192.168.1.5:4321/'] })

    // The one who invited waits. Nothing yet is told as nothing yet.
    const waiting = fetch(`${at}/${room}/answer`, { headers: own })

    // The other person's Studio is a page of another site: it may read the offer and leave the answer.
    const read = await fetch(`${at}/${room}`, { headers: { origin: 'http://localhost:9999' } })
    expect(read.status).toBe(200)
    expect(read.headers.get('access-control-allow-origin')).toBe('*')
    expect(await read.json()).toEqual({ offer: OFFER })
    const left = await fetch(`${at}/${room}`, { method: 'POST', headers: { origin: 'http://localhost:9999' }, body: ANSWER })
    expect(left.status).toBe(204)
    expect(left.headers.get('access-control-allow-origin')).toBe('*')

    const answered = await waiting
    expect(answered.status).toBe(200)
    expect(await answered.json()).toEqual({ answer: ANSWER })
    // The invitation is used up.
    expect((await fetch(`${at}/${room}`)).status).toBe(404)
    expect((await fetch(`${at}/${room}`, { method: 'POST', body: ANSWER })).status).toBe(404)
  })

  it('let only the Studio of this site make an invitation, wait on it or take it back', async () => {
    const at = await serve()
    expect((await fetch(at, { method: 'POST', body: JSON.stringify({ offer: OFFER }) })).status).toBe(403)
    const { room } = (await (await fetch(at, { method: 'POST', headers: own, body: JSON.stringify({ offer: OFFER }) })).json()) as { room: string }
    expect((await fetch(`${at}/${room}/answer`)).status).toBe(403)
    expect((await fetch(`${at}/${room}`, { method: 'DELETE' })).status).toBe(403)
    expect((await fetch(`${at}/${room}`)).status).toBe(200)
    expect((await fetch(`${at}/${room}`, { method: 'DELETE', headers: own })).status).toBe(204)
    expect((await fetch(`${at}/${room}`)).status).toBe(404)
    expect((await fetch(`${at}/${room}/answer`, { headers: own })).status).toBe(404)
  })

  it('turn away what is not an offer, not an answer, or not a name', async () => {
    const at = await serve()
    expect((await fetch(at, { method: 'POST', headers: own, body: 'not json' })).status).toBe(400)
    expect((await fetch(at, { method: 'POST', headers: own, body: JSON.stringify({ offer: '<b>' }) })).status).toBe(400)
    expect((await fetch(at, { headers: own })).status).toBe(404)
    const { room } = (await (await fetch(at, { method: 'POST', headers: own, body: JSON.stringify({ offer: OFFER }) })).json()) as { room: string }
    expect((await fetch(`${at}/${room}`, { method: 'POST', body: '{"answer":1}' })).status).toBe(400)
    expect((await fetch(`${at}/${room}`, { method: 'POST', body: 'A'.repeat(NOTE_LIMIT + 10) })).status).toBe(400)
    expect((await fetch(`${at}/${room.toLowerCase()}`)).status).toBe(404)
    expect((await fetch(`${at}/${room}/answer/more`, { headers: own })).status).toBe(404)
    expect((await fetch(`${at}/..%2F..%2Fetc`)).status).toBe(404)
    // A second answer is told that someone was there first.
    expect((await fetch(`${at}/${room}`, { method: 'POST', body: ANSWER })).status).toBe(204)
    expect((await fetch(`${at}/${room}`, { method: 'POST', body: ANSWER })).status).toBe(409)
    // A browser that asks first whether it may is told that it may read and answer.
    const asked = await fetch(`${at}/${room}`, { method: 'OPTIONS' })
    expect(asked.status).toBe(204)
    expect(asked.headers.get('access-control-allow-methods')).toBe('GET, POST')
  })
})
