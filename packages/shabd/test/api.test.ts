/** API pages: how a request line is read, and what "Try it" needs from a page. */
import { describe, expect, it } from 'vitest'
import { fillPath, pathParameters, pathParts, readHeaders, requestUrl } from '../src/shared/api.js'
import { FrontmatterSchema } from '../src/shared/schema.js'
import { KEYWORD_SEARCH, temporaryBuilds } from './helpers/build.js'

const build = temporaryBuilds()

describe('the path of a request', () => {
  it('is cut where its parameters are, written in braces or with a colon', () => {
    expect(pathParts('/v1/ping/{region}')).toEqual([{ text: '/v1/ping/' }, { text: '{region}', parameter: 'region' }])
    expect(pathParts('/users/:id/notes/:note_id')).toEqual([
      { text: '/users/' },
      { text: ':id', parameter: 'id' },
      { text: '/notes/' },
      { text: ':note_id', parameter: 'note_id' },
    ])
    expect(pathParts('/health')).toEqual([{ text: '/health' }])
    // Two in one segment, as some APIs write a range.
    expect(pathParameters('/compare/{base}...{head}')).toEqual(['base', 'head'])
    // Named twice, asked for once.
    expect(pathParameters('/{org}/members/{org}')).toEqual(['org'])
  })

  it('takes a colon inside a segment as text: it names an action, not a parameter', () => {
    expect(pathParameters('/v1/topics/{topic}:publish')).toEqual(['topic'])
    expect(pathParameters('/v1/files:batchDelete')).toEqual([])
    expect(fillPath('/v1/topics/{topic}:publish', { topic: 'news' })).toBe('/v1/topics/news:publish')
  })

  it('takes the values a reader gives, encoded so that each stays in its segment', () => {
    expect(fillPath('/users/:id/files/{name}', { id: '42', name: 'a b/c?.txt' })).toBe('/users/42/files/a%20b%2Fc%3F.txt')
    // A parameter without a value stays as it is written, so the address shows what is missing.
    expect(fillPath('/users/:id/files/{name}', { id: '42' })).toBe('/users/42/files/{name}')
    expect(fillPath('/users/:id', { id: '' })).toBe('/users/:id')
  })

  it('is joined to the address of the API, and to a query when there is one', () => {
    expect(requestUrl('https://api.example.com', '/v1/users')).toBe('https://api.example.com/v1/users')
    // One slash between the two, however the address was typed.
    expect(requestUrl(' https://api.example.com/v2/ ', '/users')).toBe('https://api.example.com/v2/users')
    expect(requestUrl('https://api.example.com', '/users', 'limit=10&sort=name')).toBe('https://api.example.com/users?limit=10&sort=name')
    expect(requestUrl('https://api.example.com', '/users', ' ?limit=10 ')).toBe('https://api.example.com/users?limit=10')
    expect(requestUrl('https://api.example.com', '/users', '  ')).toBe('https://api.example.com/users')
  })
})

describe('headers a reader types', () => {
  it('are read one to a line, as a name, a colon and a value', () => {
    expect(readHeaders('Authorization: Bearer abc\n\n  X-Trace:1  \nAccept: text/html; q=0.8')).toEqual({
      headers: [
        ['Authorization', 'Bearer abc'],
        ['X-Trace', '1'],
        // Only the first colon divides: the rest of the line is the value.
        ['Accept', 'text/html; q=0.8'],
      ],
    })
    expect(readHeaders('')).toEqual({ headers: [] })
    expect(readHeaders('X-Empty:')).toEqual({ headers: [['X-Empty', '']] })
  })

  it('are refused with the line that is wrong, before a browser refuses them without saying which', () => {
    expect(readHeaders('Authorization Bearer abc')).toEqual({
      problem: 'A header is written "Name: value". This line is not: Authorization Bearer abc',
    })
    expect(readHeaders(': value')).toMatchObject({ problem: expect.stringContaining('This line is not: : value') })
    expect(readHeaders('Accept: text/html\nMy Header: 1')).toEqual({ problem: '"My Header" is not a name a header can have.' })
    expect(readHeaders('X-Name: José 😀')).toEqual({ problem: 'The value of X-Name holds a character a header cannot carry.' })
    // Latin letters with accents fit in a byte, and are sent.
    expect(readHeaders('X-Name: José')).toEqual({ headers: [['X-Name', 'José']] })
  })
})

describe('`api` in frontmatter', () => {
  const api = (more: Record<string, unknown>) => FrontmatterSchema.parse({ api: { method: 'POST', path: '/v1/notes', ...more } }).api

  it('does not offer the request to be tried unless the page says so', () => {
    expect(api({})).toEqual({ method: 'POST', path: '/v1/notes', deprecated: false, try: false })
    expect(api({ try: true })?.try).toBe(true)
  })

  it('takes a body of any shape, as it is written in YAML', () => {
    expect(api({ body: { text: 'Hello', tags: ['a', 'b'], pinned: false } })?.body).toEqual({ text: 'Hello', tags: ['a', 'b'], pinned: false })
    expect(api({ body: [1, 2] })?.body).toEqual([1, 2])
    expect(api({ body: '{"text": "Hello"}' })?.body).toBe('{"text": "Hello"}')
  })

  it('still refuses a key it does not know', () => {
    expect(() => api({ tryIt: true })).toThrow()
  })
})

describe('a built API page', () => {
  it('has the button when the page offers the request to be tried, and no form until it is pressed', async () => {
    const page = (title: string, more: string) =>
      `---\ntitle: ${title}\nlayout: api\napi:\n  method: GET\n  path: /v1/things/{id}\n  baseUrl: https://api.example.com\n${more}---\n\nText.\n`
    const built = await build({
      'shabd.config.yaml': `site:\n  title: Docs\n${KEYWORD_SEARCH}`,
      'content/index.md': '# Home\n',
      'content/read.md': page('Read', ''),
      'content/try.md': page('Try', '  try: true\n'),
    })

    const offered = await built.read('try/index.html')
    expect(offered).toMatch(/<button type="button" class="sb-api-try-toggle" aria-expanded="false" aria-controls="[^"]+">Try it<\/button>/)
    // The place the form goes is there for the button to name, and it is empty.
    expect(offered).toMatch(/<div id="[^"]+" hidden=""><\/div>/)
    expect(offered).not.toContain('sb-api-try"')

    const plain = await built.read('read/index.html')
    expect(plain).toContain('class="sb-api-param">{id}</span>')
    expect(plain).not.toContain('Try it')
    expect(plain).not.toContain('sb-api-try')
  })
})
