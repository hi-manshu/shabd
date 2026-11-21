/**
 * Draft sync: share what is being typed before it is saved.
 *
 * A StudioChannel carries the messages of a shared draft (draft.ts) between
 * editors. Two transports:
 *
 *   tabChannel   BroadcastChannel. Other tabs and windows of the same browser.
 *   PeerChannel  a WebRTC data channel. Another person's browser, directly:
 *                the two exchange an invite and a reply, and from then on
 *                drafts travel peer to peer with no server between.
 *
 * What travels is each change as it was typed, and the editors merge them:
 * see draft.ts for how, and for what happens when two editors meet that
 * each hold a text of their own.
 */
import { isDraftMessage, type DraftMessage } from './draft.js'

export interface StudioChannel {
  send(message: DraftMessage): void
  /** Returns an unsubscribe function. */
  subscribe(listener: (message: DraftMessage) => void): () => void
  close(): void
}

/** This editor, among the others it talks to. */
export const peerId = Math.random().toString(36).slice(2, 10)

export function tabChannel(name: string): StudioChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  const channel = new BroadcastChannel(name)
  return {
    send: (message) => channel.postMessage(message),
    subscribe(listener) {
      const onMessage = (event: MessageEvent<unknown>) => {
        if (isDraftMessage(event.data)) listener(event.data)
      }
      channel.addEventListener('message', onMessage)
      return () => channel.removeEventListener('message', onMessage)
    },
    close: () => channel.close(),
  }
}

/* ───────────────────────────── WebRTC ────────────────────────────── */

/** STUN only tells each browser its public address; no draft passes through it. */
const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]

const encode = (description: RTCSessionDescriptionInit) => btoa(JSON.stringify(description))
const decode = (code: string): RTCSessionDescriptionInit => JSON.parse(atob(code.trim())) as RTCSessionDescriptionInit

/** How long candidates must stop arriving before the list is taken as final. */
const QUIET_MS = 500
/** Longest wait for candidates. STUN answers normally arrive within a tenth of a second. */
const GATHER_LIMIT_MS = 3000
/** How many times to gather when a connection comes up with no usable candidate, and the pause before each retry. */
const GATHER_ATTEMPTS = 4
const RETRY_PAUSE_MS = 500

/**
 * Wait until the connection has its network candidates, so that one pasted
 * code can carry all of them.
 *
 * `iceGatheringState` alone cannot be trusted for this. Measured in Firefox
 * 159: it usually never reports "complete" (the candidates are all there
 * after about 50 ms and the state stays "gathering"), so waiting for it
 * means always waiting out the limit. This waits for the end-of-candidates
 * signal, or for candidates to go quiet, whichever comes first.
 */
function gathered(connection: RTCPeerConnection): Promise<void> {
  if (connection.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    let quiet: ReturnType<typeof setTimeout> | undefined
    const done = () => {
      clearTimeout(quiet)
      clearTimeout(limit)
      connection.removeEventListener('icecandidate', onCandidate)
      connection.removeEventListener('icegatheringstatechange', onState)
      resolve()
    }
    const onCandidate = (event: RTCPeerConnectionIceEvent) => {
      if (!event.candidate) return done()
      clearTimeout(quiet)
      quiet = setTimeout(done, QUIET_MS)
    }
    const onState = () => connection.iceGatheringState === 'complete' && done()
    const limit = setTimeout(done, GATHER_LIMIT_MS)
    connection.addEventListener('icecandidate', onCandidate)
    connection.addEventListener('icegatheringstatechange', onState)
  })
}

/**
 * Can the other side reach this description at all? Data channels run over
 * UDP. Now and then a browser gathers nothing but a TCP candidate and calls
 * it complete; a code built from that can never connect. Measured in Firefox
 * 159: this happened to one gathering roughly every twelve seconds, and a
 * gathering started 700 ms later was fine. Hence the pause between attempts.
 */
function hasUsableCandidate(description: RTCSessionDescription | null): boolean {
  return /^a=candidate:\S+ \d+ udp /im.test(description?.sdp ?? '')
}

/** A problem worth showing to the person as it is. */
export class PeerError extends Error {}

/*
 * An invitation by link. The one who invites leaves their offer with their own dev server
 * (src/node/vite/signal.ts), and the link is where. Whoever is sent the link reads the offer from it and
 * leaves the answer there, so neither has a code to copy back. The link leads to the other person's dev
 * server, which this browser has to be able to reach.
 */

/** What such a link looks like: a dev server's address, the route, and the name the offer was left under. */
const INVITE_LINK = /^https?:\/\/\S+\/_shabd\/studio\/signal\/[2-9A-HJ-NP-Z]{12}$/

export const isInviteLink = (text: string): boolean => INVITE_LINK.test(text.trim())

const NOT_REACHED =
  'That link could not be opened from this machine. It leads to the other person\'s dev server, which has to be reachable from here. Ask them for the code instead.'

/** The offer that was left at a link. */
export async function offerAt(link: string): Promise<string> {
  const response = await fetch(link.trim()).catch(() => {
    throw new PeerError(NOT_REACHED)
  })
  const body = (await response.json().catch(() => ({}))) as { offer?: string; error?: string }
  if (!response.ok || !body.offer) throw new PeerError(body.error ?? 'That link does not lead to an invitation.')
  return body.offer
}

/** Leave the answer where the offer was. It is sent as plain text, which a page of another site may send without asking first. */
export async function answerAt(link: string, answer: string): Promise<void> {
  const response = await fetch(link.trim(), { method: 'POST', body: answer }).catch(() => {
    throw new PeerError(NOT_REACHED)
  })
  if (response.ok) return
  const body = (await response.json().catch(() => ({}))) as { error?: string }
  throw new PeerError(body.error ?? 'The answer could not be left at that link.')
}

/**
 *   idle       nothing started
 *   waiting    a code was made; the other side has not connected yet
 *   connected  drafts are flowing
 *   failed     the two browsers could not reach each other, or the link dropped
 */
export type PeerState = 'idle' | 'waiting' | 'connected' | 'failed'

/**
 * A two-person WebRTC channel. The two browsers each need a note from the other before they can talk:
 *
 *   host:   const invite = await channel.invite()        → the guest is given it
 *   guest:  const reply  = await channel.join(invite)    → the host is given that
 *   host:   await channel.accept(reply)                  → connected
 *
 * How a note gets across is the caller's business: left with the host's dev server and read from a
 * link (above), or copied and pasted by the two people.
 */
export class PeerChannel implements StudioChannel {
  #iceServers: RTCIceServer[]
  #connection: RTCPeerConnection | null = null
  #data: RTCDataChannel | null = null
  #listeners = new Set<(message: DraftMessage) => void>()
  #stateListeners = new Set<(state: PeerState) => void>()
  state: PeerState = 'idle'

  constructor(iceServers: RTCIceServer[] = ICE_SERVERS) {
    this.#iceServers = iceServers
  }

  invite(): Promise<string> {
    return this.#describe(async (connection) => {
      this.#attach(connection.createDataChannel('shabd-studio'))
      await connection.setLocalDescription(await connection.createOffer())
    })
  }

  join(invite: string): Promise<string> {
    const offer = decode(invite)
    return this.#describe(async (connection) => {
      await connection.setRemoteDescription(offer)
      await connection.setLocalDescription(await connection.createAnswer())
    })
  }

  async accept(reply: string): Promise<void> {
    if (!this.#connection) throw new PeerError('Create an invite before pasting a reply.')
    await this.#connection.setRemoteDescription(decode(reply))
  }

  send(message: DraftMessage): void {
    if (this.#data?.readyState === 'open') this.#data.send(JSON.stringify(message))
  }

  subscribe(listener: (message: DraftMessage) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  onState(listener: (state: PeerState) => void): () => void {
    this.#stateListeners.add(listener)
    return () => this.#stateListeners.delete(listener)
  }

  close(): void {
    this.#stateListeners.clear()
    this.#data?.close()
    this.#connection?.close()
    this.#connection = null
  }

  /** Open a connection, negotiate, and return the local description as a code once it can be reached. */
  async #describe(negotiate: (connection: RTCPeerConnection) => Promise<void>): Promise<string> {
    for (let attempt = 1; attempt <= GATHER_ATTEMPTS; attempt++) {
      this.#connection?.close()
      if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, RETRY_PAUSE_MS))
      const connection = this.#open()
      await negotiate(connection)
      await gathered(connection)
      if (hasUsableCandidate(connection.localDescription)) {
        this.#setState('waiting')
        return encode(connection.localDescription!)
      }
    }
    this.#connection?.close()
    this.#connection = null
    throw new PeerError('This browser found no network route to offer the other person. Check the connection and try again.')
  }

  #open(): RTCPeerConnection {
    const connection = new RTCPeerConnection({ iceServers: this.#iceServers })
    this.#connection = connection
    connection.addEventListener('datachannel', (event) => this.#attach(event.channel))
    connection.addEventListener('connectionstatechange', () => {
      // "disconnected" can recover by itself; only "failed" is final.
      if (connection === this.#connection && connection.connectionState === 'failed') this.#setState('failed')
    })
    return connection
  }

  #attach(channel: RTCDataChannel): void {
    this.#data = channel
    channel.addEventListener('open', () => this.#data === channel && this.#setState('connected'))
    channel.addEventListener('close', () => this.#data === channel && this.state === 'connected' && this.#setState('failed'))
    channel.addEventListener('message', (event) => {
      try {
        const message: unknown = JSON.parse(String(event.data))
        if (isDraftMessage(message)) for (const listener of this.#listeners) listener(message)
      } catch {
        // Not a draft message: ignore it.
      }
    })
  }

  #setState(state: PeerState): void {
    if (this.state === state) return
    this.state = state
    for (const listener of this.#stateListeners) listener(state)
  }
}
