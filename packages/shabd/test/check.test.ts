/** `shabd check`: the rules a site can tune, links that leave the site, and how the result is printed. */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { checkExternalLinks } from '../src/node/check-external.js'
import { check, collectProblems, githubAnnotation, toReport, type Problem } from '../src/node/check.js'
import { createContext } from '../src/node/context.js'
import { temporarySites } from './helpers/site.js'

const site = temporarySites()
const lines = (problems: Problem[]) => problems.map(({ level, rule, file, line, message }) => `${level} ${rule} ${file}:${line ?? ''} ${message}`)

/** A server that answers the way the sites a page links to might. */
let server: Server
let origin: string
const asked: string[] = []

beforeAll(async () => {
  server = createServer((request, response) => {
    asked.push(`${request.method} ${request.url}`)
    const route = request.url ?? '/'
    if (route === '/ok') response.writeHead(200).end('fine')
    else if (route === '/moved') response.writeHead(301, { location: '/ok' }).end()
    else if (route === '/gone') response.writeHead(404).end('nothing')
    else if (route === '/login') response.writeHead(403).end('not for you')
    // A server that refuses HEAD, as some do, but has the page.
    else if (route === '/get-only') response.writeHead(request.method === 'HEAD' ? 405 : 200).end('fine')
    else if (route === '/slow') setTimeout(() => response.writeHead(200).end('late'), 2_000)
    else response.writeHead(500).end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise((resolve) => server.close(resolve)))

describe('the rules a site sets', () => {
  const PAGES = {
    'content/index.md': '---\ntitle: Home\ndescription: Where it starts.\n---\n\n![](./plain.png)\n\n![A chart of builds per day](./chart.png)\n',
    'content/bare.md': '# Bare\n\nNo description here.\n',
  }

  it('warn about a picture with no alternative text, on its line, and say nothing of descriptions', async () => {
    const dir = await site({ 'shabd.config.yaml': 'site:\n  title: Docs\n', ...PAGES })
    const { problems } = await collectProblems(await createContext(dir, { dev: false }))
    expect(lines(problems.filter((problem) => problem.rule !== 'sidebar'))).toEqual([
      'warning alt-text content/index.md:6 The picture ./plain.png has no alternative text, so it says nothing to a reader who cannot see it. Write it between the square brackets.',
    ])
  })

  it('are as serious as the config says, or off', async () => {
    const dir = await site({
      'shabd.config.yaml': 'site:\n  title: Docs\ncheck:\n  altText: off\n  descriptions: error\n',
      ...PAGES,
    })
    const { problems } = await collectProblems(await createContext(dir, { dev: false }))
    expect(lines(problems.filter((problem) => problem.rule !== 'sidebar'))).toEqual([
      'error description content/bare.md: This page has no description. Search results, llms.txt and links shared to other sites show one where there is one.',
    ])
  })

  it('warn about a component in a .md page, where it is an element the browser does not know', async () => {
    const dir = await site({
      'shabd.config.yaml': 'site:\n  title: Docs\n',
      'content/index.md': '# Home\n\n<Tabs>\n<Tab label="npm">Use npm.</Tab>\n</Tabs>\n\nPress <kbd>Ctrl</kbd>.\n',
    })
    const { problems } = await collectProblems(await createContext(dir, { dev: false }))
    expect(lines(problems)).toEqual([
      'warning component content/index.md:3 <Tabs> is written like a component, and components only work in .mdx pages. Here it is an HTML element the browser does not know. Name the file .mdx.',
      'warning component content/index.md:4 <Tab> is written like a component, and components only work in .mdx pages. Here it is an HTML element the browser does not know. Name the file .mdx.',
    ])
  })

  it('say where a broken link is written', async () => {
    const dir = await site({
      'shabd.config.yaml': 'site:\n  title: Docs\n',
      'content/index.md': '# Home\n\nText.\n\nSee [the guide](./guide.md) and\n[its steps](./index.md#steps).\n\n## Not steps\n',
    })
    const { problems } = await collectProblems(await createContext(dir, { dev: false }))
    expect(lines(problems)).toEqual([
      'error link content/index.md:5 Broken link: no page at /guide',
      'error link content/index.md:6 Broken link: / has no heading "#steps"',
    ])
  })
})

describe('links to other sites', () => {
  it('are asked for once each, and sorted into what answers, what does not and what will not say', async () => {
    asked.length = 0
    const urls = ['/ok', '/moved', '/gone', '/gone#part', '/login', '/get-only', '/broken'].map((route) => `${origin}${route}`)
    const verdicts = await checkExternalLinks([...urls, 'https://docs.example.com/guide', 'https://api.fixture.test', 'not an address'])
    expect(Object.fromEntries(verdicts)).toEqual({
      [`${origin}/ok`]: { state: 'ok' },
      [`${origin}/moved`]: { state: 'ok' },
      [`${origin}/gone`]: { state: 'broken', detail: 'answers 404' },
      [`${origin}/gone#part`]: { state: 'broken', detail: 'answers 404' },
      [`${origin}/login`]: { state: 'unknown', detail: 'answers 403 to a program' },
      [`${origin}/get-only`]: { state: 'ok' },
      [`${origin}/broken`]: { state: 'broken', detail: 'answers 500' },
      // Names set aside for examples are in a page to be read, not followed.
      'https://docs.example.com/guide': { state: 'skipped' },
      'https://api.fixture.test': { state: 'skipped' },
      'not an address': { state: 'broken', detail: 'is not an address' },
    })
    // The two links to /gone, which differ after the `#`, were one request. A HEAD that failed was asked again as a GET.
    expect(asked.filter((request) => request === 'HEAD /gone')).toHaveLength(1)
    expect(asked).toContain('GET /get-only')
  })

  it('give up on an address that takes too long, and one whose host does not exist', async () => {
    const verdicts = await checkExternalLinks([`${origin}/slow`, 'http://127.0.0.1:1/nothing-listens-here'], { timeout: 300 })
    expect(verdicts.get(`${origin}/slow`)).toEqual({ state: 'broken', detail: 'did not answer within 0 seconds' })
    expect(verdicts.get('http://127.0.0.1:1/nothing-listens-here')?.state).toBe('broken')
  })

  it('are checked only when asked, and then reported on the line of each link', async () => {
    const dir = await site({
      'shabd.config.yaml': 'site:\n  title: Docs\n',
      'content/index.md': `# Home\n\n[Fine](${origin}/ok), [gone](${origin}/gone)\nand [walled](${origin}/login).\n`,
    })
    const context = await createContext(dir, { dev: false })
    expect((await collectProblems(context)).problems).toEqual([])

    const { problems } = await collectProblems(context, { external: true })
    expect(lines(problems)).toEqual([
      `warning external-link content/index.md:3 ${origin}/gone answers 404`,
      `note external-link content/index.md:4 ${origin}/login answers 403 to a program, so it could not be checked`,
    ])
  })
})

describe('the report', () => {
  const problem: Problem = { level: 'error', rule: 'link', file: 'content/guide/a b.md', line: 7, message: 'Broken link: no page at /x' }

  it('is written for GitHub as an annotation on the line, with the path from where the command runs', () => {
    expect(githubAnnotation(problem, '/repo/docs', '/repo')).toBe(
      '::error file=docs/content/guide/a b.md,line=7,title=shabd check%3A link::Broken link: no page at /x',
    )
    expect(githubAnnotation({ ...problem, level: 'note', line: undefined, message: 'Two\nlines, 100%' }, '/repo/docs', '/repo')).toBe(
      '::notice file=docs/content/guide/a b.md,title=shabd check%3A link::Two%0Alines, 100%25',
    )
  })

  it('counts what was found, with a page that does not compile among the errors', async () => {
    const dir = await site({
      'shabd.config.yaml': 'site:\n  title: Docs\n',
      'content/index.md': '---\nlayout: nonesuch\n---\n\n# Home\n',
      'content/other.md': '# Other\n\n![](./x.png)\n',
    })
    const context = await createContext(dir, { dev: false })
    const report = toReport(2, await collectProblems(context), context.config.root)
    expect(report).toMatchObject({ pages: 2, errors: 1, warnings: 1 })
    expect(report.problems[0]).toMatchObject({ level: 'error', rule: 'page', file: 'content/index.md', line: 2 })
    expect(report.problems[0]?.message).toContain('Layout "nonesuch" does not exist')
  })

  it('is printed as JSON and nothing else when asked, and fails the check on an error', async () => {
    const dir = await site({ 'shabd.config.yaml': 'site:\n  title: Docs\n', 'content/index.md': '# Home\n\n[Gone](./gone.md)\n' })
    const printed: string[] = []
    const log = vi.spyOn(console, 'log').mockImplementation((text: string) => void printed.push(text))
    try {
      expect(await check(dir, { format: 'json' })).toBe(false)
    } finally {
      log.mockRestore()
    }
    expect(printed).toHaveLength(1)
    expect(JSON.parse(printed[0]!)).toEqual({
      pages: 1,
      errors: 1,
      warnings: 0,
      notes: 0,
      problems: [{ level: 'error', rule: 'link', file: 'content/index.md', line: 3, message: 'Broken link: no page at /gone' }],
    })
  })
})
