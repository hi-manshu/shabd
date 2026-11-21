/**
 * "Try it": send the request an API page describes, and show the answer.
 *
 * The request goes from the reader's browser straight to the API. Nothing
 * passes through the docs site, which has no server to pass it through. So
 * it works only for an API that lets other sites call it (CORS), and what
 * the reader types here, a token included, is seen by nobody but the API.
 */
import { useId, useState, type FormEvent } from 'react'
import { fillPath, pathParameters, readHeaders, requestUrl } from '../../../shared/api.js'
import type { Frontmatter } from '../../../shared/schema.js'

type Api = NonNullable<Frontmatter['api']>

/** How much of an answer is shown. More than this is a download, not something to read on a docs page. */
const LIMIT = 100_000
const TIMEOUT = 30_000

/** The answers that are text, by their type. Anything else is described, not shown. */
const TEXT = /^text\/|json|xml|javascript|urlencoded/i

/**
 * The address and the headers a reader typed, for each API of the site (by
 * the `baseUrl` its pages give). An API reference is many pages, and a token
 * typed on one should not have to be typed again on the next.
 *
 * It is kept here, in memory, and nowhere else: a token does not belong in
 * the browser's storage. Reloading the page forgets it. And it is kept per
 * API, so that a token typed for one is never offered to another.
 */
const typed = new Map<string, { base: string; headers: string }>()

type Outcome =
  | { state: 'idle' }
  | { state: 'sending' }
  | { state: 'answered'; ok: boolean; line: string; body: string; note: string }
  | { state: 'failed'; message: string }

export default function ApiTry({ api }: { api: Api }) {
  const id = useId()
  const names = pathParameters(api.path)
  const key = api.baseUrl ?? ''
  const [base, setBase] = useState(() => typed.get(key)?.base ?? api.baseUrl ?? '')
  const [headers, setHeaders] = useState(() => typed.get(key)?.headers ?? '')
  const [values, setValues] = useState<Record<string, string>>({})
  const [query, setQuery] = useState('')
  const [body, setBody] = useState(() =>
    // Text is the body as the author wrote it. Anything else was written as YAML, and is sent as JSON.
    api.body === undefined ? '' : typeof api.body === 'string' ? api.body : JSON.stringify(api.body, null, 2),
  )
  const [outcome, setOutcome] = useState<Outcome>({ state: 'idle' })

  const takesBody = api.method !== 'GET' && api.method !== 'HEAD'
  const signsIn = api.auth !== undefined && api.auth.trim().toLowerCase() !== 'none'

  const keep = (next: { base?: string; headers?: string }) => typed.set(key, { base, headers, ...next })

  const send = async (event: FormEvent) => {
    event.preventDefault()
    const read = readHeaders(headers)
    if ('problem' in read) return setOutcome({ state: 'failed', message: read.problem })
    const payload = takesBody && body.trim() ? body : undefined
    if (payload !== undefined) {
      try {
        JSON.parse(payload)
      } catch (error) {
        // Sent as it is, the API would answer with an error of its own that says less.
        return setOutcome({ state: 'failed', message: `The body is not JSON: ${(error as Error).message}` })
      }
    }
    const sent = new Headers(read.headers)
    if (payload !== undefined && !sent.has('content-type')) sent.set('content-type', 'application/json')

    setOutcome({ state: 'sending' })
    const started = performance.now()
    try {
      const response = await fetch(requestUrl(base, fillPath(api.path, values), query), {
        method: api.method,
        headers: sent,
        ...(payload !== undefined ? { body: payload } : {}),
        signal: AbortSignal.timeout(TIMEOUT),
      })
      const bytes = await response.arrayBuffer()
      const ms = Math.round(performance.now() - started)
      const type = response.headers.get('content-type') ?? ''
      let text = ''
      let note = ''
      if (bytes.byteLength > 0 && (type === '' || TEXT.test(type))) {
        text = new TextDecoder().decode(bytes)
        if (/json/i.test(type)) {
          try {
            text = JSON.stringify(JSON.parse(text), null, 2)
          } catch {
            // Said to be JSON and is not: shown as it came.
          }
        }
        if (text.length > LIMIT) {
          text = text.slice(0, LIMIT)
          note = 'The answer is longer than is shown here.'
        }
      } else if (bytes.byteLength > 0) {
        note = `The answer is ${bytes.byteLength.toLocaleString('en')} bytes of ${type.split(';')[0]}, which is not text.`
      }
      setOutcome({
        state: 'answered',
        ok: response.ok,
        line: `${response.status} ${response.statusText}`.trim(),
        body: text,
        note: `${ms} ms${note ? `. ${note}` : ''}`,
      })
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === 'TimeoutError'
      setOutcome({
        state: 'failed',
        message: timedOut
          ? `The API did not answer within ${TIMEOUT / 1000} seconds.`
          : // A browser does not say why a request to another site failed, only that it did.
            'The request got no answer. The API may not allow requests from other sites (CORS), or it could not be reached.',
      })
    }
  }

  let host = ''
  try {
    host = new URL(base).host
  } catch {
    // No address yet, or not one: the field itself says so when the form is sent.
  }

  return (
    <form className="sb-api-try" onSubmit={send}>
      <div className="sb-api-fields">
        <label htmlFor={`${id}-base`}>Address</label>
        <input
          id={`${id}-base`}
          type="url"
          required
          placeholder="https://api.example.com"
          value={base}
          onChange={(event) => {
            setBase(event.target.value)
            keep({ base: event.target.value })
          }}
        />
        {names.map((name, index) => (
          <Parameter
            key={name}
            id={`${id}-p${index}`}
            name={name}
            value={values[name] ?? ''}
            onChange={(value) => setValues((all) => ({ ...all, [name]: value }))}
          />
        ))}
        <label htmlFor={`${id}-query`}>Query</label>
        <input id={`${id}-query`} placeholder="limit=10&sort=name" value={query} onChange={(event) => setQuery(event.target.value)} />
        <label htmlFor={`${id}-headers`}>Headers</label>
        <textarea
          id={`${id}-headers`}
          rows={2}
          spellCheck={false}
          autoComplete="off"
          placeholder={signsIn ? 'Authorization: Bearer …' : 'Accept: application/json'}
          value={headers}
          onChange={(event) => {
            setHeaders(event.target.value)
            keep({ headers: event.target.value })
          }}
        />
        {takesBody && (
          <>
            <label htmlFor={`${id}-body`}>Body</label>
            <textarea id={`${id}-body`} rows={6} spellCheck={false} value={body} onChange={(event) => setBody(event.target.value)} />
          </>
        )}
      </div>

      <p className="sb-api-send">
        <button type="submit" className="sb-button" disabled={outcome.state === 'sending'}>
          {outcome.state === 'sending' ? 'Sending…' : `Send ${api.method}`}
        </button>
        <span className="sb-api-note">
          Sent from your browser straight to {host || 'the API'}. Nothing passes through this site.
        </span>
      </p>

      {/* Only the line that says how it went is announced. The answer itself can be long, and is there to be read. */}
      <p className="sb-api-status" role="status" data-state={outcome.state}>
        {outcome.state === 'answered' && (
          <>
            <strong data-ok={outcome.ok ? '' : undefined}>{outcome.line}</strong> in {outcome.note}
          </>
        )}
        {outcome.state === 'failed' && outcome.message}
      </p>
      {outcome.state === 'answered' && outcome.body && (
        <pre className="sb-api-answer" tabIndex={0} role="region" aria-label="Answer">
          {outcome.body}
        </pre>
      )}
    </form>
  )
}

/** A parameter of the path, labelled with its name as the path writes it. */
function Parameter({ id, name, value, onChange }: { id: string; name: string; value: string; onChange: (value: string) => void }) {
  return (
    <>
      <label htmlFor={id}>
        <code>{name}</code>
      </label>
      <input id={id} required autoComplete="off" value={value} onChange={(event) => onChange(event.target.value)} />
    </>
  )
}
