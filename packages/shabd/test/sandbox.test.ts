/** Live sandboxes: what a snippet may import, and how a snippet becomes a component. */
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { compileSnippet } from '../src/client/sandbox/compile.js'
import { collectProblems, type Problem } from '../src/node/check.js'
import { resolveConfig } from '../src/node/config/load.js'
import { createContext } from '../src/node/context.js'
import { SnippetError, transformSnippet } from '../src/shared/snippet.js'
import { KEYWORD_SEARCH, temporaryBuilds } from './helpers/build.js'
import { failure, temporarySites } from './helpers/site.js'

const site = temporarySites()

describe('features.sandbox.modules', () => {
  it('names packages the site has installed, and files of its own under a name', async () => {
    const dir = await site({
      'shabd.config.yaml': '',
      'node_modules/date-fns/package.json': '{"name":"date-fns"}',
      'node_modules/@acme/ui/package.json': '{"name":"@acme/ui"}',
      'components/charts.ts': 'export const bar = 1\n',
    })
    const { sandboxModules, config } = resolveConfig(
      dir,
      `${dir}/shabd.config.yaml`,
      'site:\n  title: Docs\nfeatures:\n  sandbox:\n    modules:\n      - date-fns\n      - date-fns/locale\n      - "@acme/ui/button"\n      - { name: charts, file: ./components/charts.ts }\n',
    )
    expect(config.features.sandbox.enabled).toBe(true)
    expect(sandboxModules).toEqual([
      { name: 'date-fns', from: 'date-fns' },
      // A path inside a package is that package's to answer.
      { name: 'date-fns/locale', from: 'date-fns/locale' },
      { name: '@acme/ui/button', from: '@acme/ui/button' },
      { name: 'charts', from: `${dir}/components/charts.ts` },
    ])
    expect(resolveConfig(dir, `${dir}/shabd.config.yaml`, 'site:\n  title: Docs\n').sandboxModules).toEqual([])
  })

  it('says, where it is written, which name leads nowhere', () => {
    const load = (modules: string) => failure(() => resolveConfig('/site', '/site/shabd.config.yaml', `site:\n  title: Docs\nfeatures:\n  sandbox:\n    modules:\n${modules}`))

    const missing = load('      - left-pad\n      - "@acme/ui/button"\n')
    expect(missing.issues.map((issue) => [issue.path.join('.'), issue.line])).toEqual([
      ['features.sandbox.modules.0', 6],
      ['features.sandbox.modules.1', 7],
    ])
    expect(missing.issues[0]?.message).toContain('The package "left-pad" is not installed where this site can find it. Add it with: npm install left-pad')
    // The package is what is installed, whatever path inside it the snippet names.
    expect(missing.issues[1]?.message).toContain('npm install @acme/ui')

    expect(load('      - { name: charts, file: ./nowhere.ts }\n').issues[0]?.message).toContain('File not found: ./nowhere.ts')
    expect(load('      - react\n').issues[0]?.message).toContain('"react" is there for every snippet already')
    expect(load('      - { name: shabd/client, file: ./x.ts }\n').issues[0]?.message).toContain('is there for every snippet already')
    const twice = load('      - { name: charts, file: ./a.ts }\n      - { name: charts, file: ./b.ts }\n')
    expect(twice.issues.some((issue) => issue.message === '"charts" is listed twice' && issue.path.join('.') === 'features.sandbox.modules.1')).toBe(true)
  })
})

describe('a live snippet', () => {
  const render = async (source: string, loaders: Record<string, () => Promise<Record<string, unknown>>> = {}) =>
    renderToStaticMarkup(createElement(await compileSnippet(source, {}, {}, loaders)))

  it('is a module with a default export, or one element', async () => {
    expect(await render('export default function Hello() {\n  return <p>Hello</p>\n}')).toBe('<p>Hello</p>')
    expect(await render('<strong>Bare</strong>')).toBe('<strong>Bare</strong>')
    await expect(render('const a = 1')).rejects.toThrow('either a single JSX element, or a module')
    await expect(render('   ')).rejects.toThrow('The snippet is empty.')
  })

  it('imports what the site says it may, fetched when the snippet names it and not before', async () => {
    const asked: string[] = []
    const loaders = {
      // As a module comes from `import()`: its exports, the default among them.
      'date-fns': async () => (asked.push('date-fns'), { format: (day: string) => `on ${day}`, default: { name: 'date-fns' } }),
      charts: async () => (asked.push('charts'), { default: () => createElement('svg') }),
    }

    expect(await render("import { format } from 'date-fns'\nexport default () => <p>{format('Monday')}</p>", loaders)).toBe('<p>on Monday</p>')
    // The one the snippet named, and not the other.
    expect(asked).toEqual(['date-fns'])

    expect(await render("import Chart from 'charts'\nimport dates, * as all from 'date-fns'\nexport default () => <div><Chart />{dates.name} {typeof all.format}</div>", loaders)).toBe(
      '<div><svg></svg>date-fns function</div>',
    )

    // What nobody said it may import is refused, with what there is.
    await expect(render("import pad from 'left-pad'\nexport default () => <p>{pad('a')}</p>", loaders)).rejects.toThrow(
      'Live snippets cannot import "left-pad". Available: react, date-fns, charts.',
    )
  })

  it('says which module could not be fetched', async () => {
    const loaders = { charts: () => Promise.reject(new Error('Failed to fetch dynamically imported module')) }
    await expect(render("import Chart from 'charts'\nexport default () => <Chart />", loaders)).rejects.toThrow('"charts" could not be loaded: Failed to fetch dynamically imported module')
  })

  it('is transformed to a script that says what it needs, for whoever runs it', async () => {
    const { code, needs } = await transformSnippet("import { format } from 'date-fns'\nimport { useState } from 'react'\nexport default () => <p>{format('x')}{useState(0)[0]}</p>")
    expect(needs).toEqual(['date-fns', 'react'])
    expect(code).toContain('require(')
    expect(code).not.toContain('import ')
  })

  it('needs what it imports to run, and not what it imports for its types or only mentions', async () => {
    const { needs } = await transformSnippet(
      [
        "import type { Locale } from 'date-fns/locale'",
        "import { Props } from './types'",
        'import {',
        '  format,',
        '} from "date-fns"',
        "import 'side-effect'",
        'const said = "call require(\'fs\') first"',
        'export default (props: Props) => <p>{format(said)}</p>',
      ].join('\n'),
    )
    // The first two are gone once the types are: nothing is left that would use them.
    expect(needs).toEqual(['date-fns', 'side-effect'])
  })

  it('says which line of the snippet it could not read, as the snippet was written', async () => {
    const lineOf = async (source: string) => {
      const error = await transformSnippet(source).then(
        () => undefined,
        (problem: unknown) => problem,
      )
      expect(error).toBeInstanceOf(SnippetError)
      return (error as SnippetError).line
    }
    expect(await lineOf('export default function A() {\n  return <p>\n}')).toBe(3)
    // A bare element is wrapped, on its own first and last lines.
    expect(await lineOf('<div>\n  {1 +}\n</div>')).toBe(2)
    expect(await lineOf('<div>\n  <p>one\n</div>')).toBe(3)
    // Empty lines before the first line are taken off, and counted.
    expect(await lineOf('\n\nexport default function A() {\n  return <<p />\n}')).toBe(4)
    // What is wrong with the whole snippet is on no line.
    expect(await lineOf('const a = 1')).toBeUndefined()
  })

  it('reaches nothing by a name every object has', async () => {
    await expect(render("import x from 'constructor'\nexport default () => <p>{String(x)}</p>")).rejects.toThrow('Live snippets cannot import "constructor"')
  })
})

describe('a build of a site whose snippets may import', () => {
  const buildSite = temporaryBuilds()

  it('puts each module in a file of its own, which no page asks for until a snippet does', async () => {
    const built = await buildSite({
      'shabd.config.yaml': `site:\n  title: Docs\n${KEYWORD_SEARCH}  sandbox:\n    modules:\n      - github-slugger\n      - { name: charts, file: ./components/charts.tsx }\n`,
      'components/charts.tsx': 'export default function Chart() {\n  return <svg data-chart="the-chart-of-this-site" />\n}\n',
      'content/index.mdx': "# Home\n\n```tsx live\nimport Chart from 'charts'\nexport default () => <Chart />\n```\n",
    })

    const dist = path.join(built.dir, 'dist')
    const scripts = (await readdir(dist, { recursive: true })).filter((file) => file.endsWith('.js')).map((file) => file.split(path.sep).join('/'))
    const holding = async (text: string) => {
      const found: string[] = []
      for (const file of scripts) if ((await built.read(file)).includes(text)) found.push(file)
      return found
    }

    // The file of the site's own, and the package: each in one script, and neither with the sandbox itself.
    const [chart, ...others] = await holding('the-chart-of-this-site')
    expect(others).toEqual([])
    const sandbox = await holding('sb-sandbox-editor')
    expect(sandbox).toHaveLength(1)
    expect(sandbox).not.toContain(chart)
    // github-slugger keeps the slugs it has given out in `occurrences`.
    const slugger = (await holding('occurrences')).filter((file) => !sandbox.includes(file))
    expect(slugger.length).toBeGreaterThan(0)
    expect(slugger).not.toContain(chart)

    // The sandbox knows where each is, and the page does not ask for either.
    const names = (file: string) => path.posix.basename(file)
    const sandboxScript = await built.read(sandbox[0]!)
    expect(sandboxScript).toContain(names(chart!))
    const home = await built.read('index.html')
    expect(home).not.toContain(names(chart!))
    for (const file of slugger) expect(home).not.toContain(names(file))
  })
})

describe('shabd check', () => {
  const lines = (problems: Problem[]) =>
    problems.filter((problem) => problem.rule === 'snippet').map(({ level, file, line, message }) => `${level} ${file}:${line ?? ''} ${message}`)

  const PAGE = [
    '---',
    'title: Play',
    'description: Snippets.',
    '---',
    '',
    '```tsx live', // line 6
    "import { format } from 'date-fns'",
    "import Chart from 'charts'",
    "import type { Locale } from 'somewhere-else'",
    'export default () => <Chart>{format(1)}</Chart>',
    '```',
    '',
    '```tsx live', // line 13
    'export default function Broken() {',
    '  return <<p />',
    '}',
    '```',
    '',
    '```tsx live', // line 19
    'const nothing = 1',
    '```',
    '',
    // Not live: nobody runs it, so nothing is asked of it.
    '```tsx',
    "import x from 'anything'",
    '```',
    '',
  ].join('\n')

  it('finds a snippet that imports what the site has not named, and one that cannot run', async () => {
    const dir = await site({
      'shabd.config.yaml': 'site:\n  title: Docs\nfeatures:\n  sandbox:\n    modules:\n      - { name: charts, file: ./charts.tsx }\n',
      'charts.tsx': 'export default () => null\n',
      'content/play.mdx': PAGE,
    })
    const { problems } = await collectProblems(await createContext(dir, { dev: false }))
    expect(lines(problems)).toEqual([
      'error content/play.mdx:6 This live snippet imports "date-fns", and a snippet can import only what the site says it may. Name it under features.sandbox.modules in shabd.config.yaml.',
      'error content/play.mdx:15 This live snippet cannot run: Unexpected token',
      'error content/play.mdx:19 This live snippet cannot run: A live snippet is either a single JSX element, or a module with `export default` for its component.',
    ])
  })

  it('asks nothing of a fence that is only shown, on a site with sandboxes off', async () => {
    const dir = await site({ 'shabd.config.yaml': 'site:\n  title: Docs\nfeatures:\n  sandbox: false\n', 'content/play.mdx': PAGE })
    const { problems } = await collectProblems(await createContext(dir, { dev: false }))
    expect(lines(problems)).toEqual([])
  })
})
