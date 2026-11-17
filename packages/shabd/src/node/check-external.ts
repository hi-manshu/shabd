/**
 * Do the links that leave the site lead anywhere?
 *
 * Each address is asked for once, however many pages link to it. The answer
 * is one of three things, because the network is not a file system: the
 * address answers, it does not, or it would not say to a program what it
 * says to a browser (a login wall, a limit on requests), in which case
 * nothing is known and nothing is claimed.
 */
import { VERSION } from '../shared/version.js'

export type ExternalVerdict =
  | { state: 'ok' }
  /** The address does not answer, or answers that nothing is there. */
  | { state: 'broken'; detail: string }
  /** The address answered, but not in a way that says whether a reader would get the page. */
  | { state: 'unknown'; detail: string }
  /** An address that is in the docs to be read, not followed. */
  | { state: 'skipped' }

export interface ExternalOptions {
  /** How long an address has to answer, in milliseconds. */
  timeout?: number
  /** How many addresses are asked for at once. */
  concurrency?: number
  /** In place of the global `fetch`, for tests. */
  fetch?: typeof fetch
}

/**
 * Names set aside for examples and tests (RFC 2606, RFC 6761). A page that
 * links to https://docs.example.com is showing what a link looks like.
 */
const RESERVED = /(?:^|\.)(?:example\.(?:com|org|net)|example|test|invalid|localhost)$/i

/** Answers that mean "not for you", which says nothing about a reader with a browser. */
const REFUSALS = new Set([401, 403, 407, 429, 999])

async function ask(url: URL, options: Required<Pick<ExternalOptions, 'timeout'>> & { fetch: typeof fetch }): Promise<ExternalVerdict> {
  const request = (method: 'HEAD' | 'GET') =>
    options.fetch(url, {
      method,
      redirect: 'follow',
      signal: AbortSignal.timeout(options.timeout),
      headers: { 'user-agent': `shabd-check/${VERSION}`, accept: 'text/html,*/*;q=0.8' },
    })

  try {
    // HEAD spares the other side the page. Some servers refuse it, or answer it wrongly, so a HEAD that
    // fails is asked again as a GET before anything is concluded.
    let response = await request('HEAD')
    if (!response.ok) {
      await response.body?.cancel()
      response = await request('GET')
    }
    await response.body?.cancel()
    if (response.ok) return { state: 'ok' }
    if (REFUSALS.has(response.status)) return { state: 'unknown', detail: `answers ${response.status} to a program` }
    return { state: 'broken', detail: `answers ${response.status}` }
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause?.code
    const timedOut = (error as Error).name === 'TimeoutError'
    if (timedOut) return { state: 'broken', detail: `did not answer within ${Math.round(options.timeout / 1000)} seconds` }
    return { state: 'broken', detail: cause === 'ENOTFOUND' ? 'has no such host' : `could not be reached${cause ? ` (${cause})` : ''}` }
  }
}

/** Ask for every address once. The result has an entry for each address given, as it was given. */
export async function checkExternalLinks(urls: Iterable<string>, options: ExternalOptions = {}): Promise<Map<string, ExternalVerdict>> {
  const settings = { timeout: options.timeout ?? 10_000, fetch: options.fetch ?? fetch }
  const verdicts = new Map<string, ExternalVerdict>()
  /** Addresses that differ only after a `#` are one request. */
  const pending = new Map<string, Promise<ExternalVerdict>>()
  const queue = [...new Set(urls)]

  const next = async (): Promise<void> => {
    for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        verdicts.set(url, { state: 'broken', detail: 'is not an address' })
        continue
      }
      if (RESERVED.test(parsed.hostname)) {
        verdicts.set(url, { state: 'skipped' })
        continue
      }
      parsed.hash = ''
      let asked = pending.get(parsed.href)
      if (!asked) pending.set(parsed.href, (asked = ask(parsed, settings)))
      verdicts.set(url, await asked)
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, options.concurrency ?? 8) }, next))
  return verdicts
}
