/** Variables: `{{name}}` in a page, filled in from `vars:` in the config. */
import { describe, expect, it } from 'vitest'
import { collectProblems } from '../src/node/check.js'
import { resolveConfig } from '../src/node/config/load.js'
import { flattenVars, substituteVars } from '../src/node/content/vars.js'
import { compilePage, createContext } from '../src/node/context.js'
import { pageMarkdown } from '../src/node/llms/markdown.js'
import { renderCompiled } from './helpers/render.js'
import { failure, temporarySites } from './helpers/site.js'

const site = temporarySites()
const load = (yaml: string) => resolveConfig('/site', '/site/shabd.config.yaml', yaml)

describe('variables', () => {
  const vars = { version: '2.1.0', 'product.name': 'Acme', 'min-node': '22' }

  it('are written as a flat table, a group as `group.name`, and every value as text', () => {
    expect(flattenVars({ version: '2.1.0', stable: true, product: { name: 'Acme', ports: { http: 8080 } } })).toEqual({
      version: '2.1.0',
      stable: 'true',
      'product.name': 'Acme',
      'product.ports.http': '8080',
    })
    expect(load('site:\n  title: Docs\nvars:\n  version: 2.1.0\n  product: { name: Acme }\n').vars).toEqual({
      version: '2.1.0',
      'product.name': 'Acme',
    })
  })

  it('fill in the names the config defines, with or without spaces inside the braces', () => {
    const { text, notes } = substituteVars('Install {{product.name}} {{ version }} on Node {{min-node}}.', vars)
    expect(text).toBe('Install Acme 2.1.0 on Node 22.')
    expect(notes).toEqual([])
  })

  it('leave alone braces that are not a variable, and say so when the name is nearly one', () => {
    const source = ['A {{ template }} of another kind.', 'Now at {{verison}}.', 'Escaped: \\{{version}}.'].join('\n')
    const { text, notes } = substituteVars(source, vars)
    expect(text).toBe(source)
    expect(notes).toEqual([{ line: 2, message: '{{verison}} is not a variable. Did you mean {{version}}?' }])
  })

  it('reach code samples too, unless the sample says `noVars`', () => {
    const source = ['```sh', 'npm install acme@{{version}}', '```', '', '```md noVars', 'Write {{version}} in a page.', '```', '', 'After: {{version}}'].join('\n')
    expect(substituteVars(source, vars).text).toBe(
      ['```sh', 'npm install acme@2.1.0', '```', '', '```md noVars', 'Write {{version}} in a page.', '```', '', 'After: 2.1.0'].join('\n'),
    )
  })

  it('refuse a name that could not be written in a page', () => {
    const error = failure(() => load('site:\n  title: Docs\nvars:\n  2fast: yes\n'))
    expect(error.issues[0]).toMatchObject({ path: ['vars', '2fast'], line: 4 })
    expect(error.issues[0]?.message).toContain('A variable name is letters, digits')
  })

  it('reach everything that is made from a page: its title, its body, its Markdown copy and what is searched', async () => {
    const dir = await site({
      'shabd.config.yaml': 'site:\n  title: Docs\nvars:\n  version: 2.1.0\n  product: { name: Acme }\n',
      'content/install.mdx': [
        '---',
        'title: Install {{product.name}}',
        'description: Version {{version}}.',
        '---',
        '',
        'Get **{{product.name}}** `{{version}}`:',
        '',
        '```sh',
        'npm install acme@{{version}}',
        '```',
        '',
        'An expression of MDX is left to MDX: {1 + 1}.',
      ].join('\n'),
    })
    const context = await createContext(dir, { dev: false })
    const page = context.store.byPath('/install')!
    expect(page.title).toBe('Install Acme')
    expect(page.description).toBe('Version 2.1.0.')
    expect(pageMarkdown(page)).toContain('Get **Acme** `2.1.0`:')

    const compiled = await compilePage(context, page)
    const html = await renderCompiled(compiled.code)
    expect(html).toContain('<strong>Acme</strong> <code>2.1.0</code>')
    expect(html).toContain('An expression of MDX is left to MDX: 2.')
    expect(compiled.sections.map((section) => section.text).join(' ')).toContain('npm install acme@2.1.0')
  })

  it('have a mistyped name reported by `shabd check`, on its line', async () => {
    const dir = await site({
      'shabd.config.yaml': 'site:\n  title: Docs\nvars:\n  version: 2.1.0\n',
      'content/index.md': '# Home\n\nNow at {{versoin}}.\n',
    })
    const { problems } = await collectProblems(await createContext(dir, { dev: false }))
    expect(problems).toEqual([
      { level: 'warning', rule: 'variable', file: 'content/index.md', line: 3, message: '{{versoin}} is not a variable. Did you mean {{version}}?' },
    ])
  })
})
